import {
    PublicKey,
    Connection,
    Keypair,
    AccountMeta,
    TransactionInstruction,
    TransactionMessage,
    VersionedTransaction,
} from '@solana/web3.js';
import { Buffer } from 'buffer';
import chalk from 'chalk';
import express from 'express';
import https from 'https';
import fs from 'fs';
import { combine } from 'shamir-secret-sharing';
import path from 'path';

// Cloak SDK imports
import {
    CLOAK_PROGRAM_ID,
    NATIVE_SOL_MINT,
    transact,
    createUtxo,
    deserializeUtxo,
    serializeUtxo,
    Utxo,
} from '@cloak.dev/sdk-devnet';

// Local utilities
import {
    SEED_PREFIX,
    SEED_MULTISIG,
    SEED_TRANSACTION,
    SEED_PROPOSAL,
    SEED_VAULT,
    PROGRAM_ID,
    PROPOSAL_HEADER_SIZE,
    bigIntToLittleEndianBytes,
    accountsForTransactionExecute,
} from '../utils';
import { fetchAndDecryptShare, decryptShareFromMember } from '../shareCrypto';
//import { reconstructSecret } from 'shamir-secret-sharing';

// ────────────────────────────────────────────────────────────
// Constants (MUST match Rust program)
// ────────────────────────────────────────────────────────────
const VAULT_TRANSACTION_HEADER_SIZE = 73; // 32+32+8+1
const PRIVATE_TRANSFER_META_SIZE = 32 + 8 + 32; // commitment(32) + amount(8) + recipient(32)
const ENCRYPTED_SHARE_SIZE = 32 + 105; // member pubkey(32) + nacl box output(105)
const MULTISIG_HEADER_SIZE = 128;

// Proposal status enum (match Rust)
const PROPOSAL_STATUS_ACTIVE = 0;
const PROPOSAL_STATUS_APPROVED = 1;
const PROPOSAL_STATUS_EXECUTED = 2;

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────
interface ShareSubmission {
    memberPubkey: string; // base58
    decryptedShare: Uint8Array; // 32 bytes
    signature?: string; // optional: member's signature for auth
}

interface PrivateProposalMetadata {
    utxoCommitment: bigint;
    amount: bigint;
    recipient: PublicKey;
}

// ────────────────────────────────────────────────────────────
// HTTPS Share Collector Server
// ────────────────────────────────────────────────────────────
class ShareCollectorServer {
    private app: express.Application;
    private server: https.Server | null = null;
    private collectedShares = new Map<string, Uint8Array>();
    private resolveShares: ((value: Uint8Array[]) => void) | null = null;
    private rejectShares: ((reason: any) => void) | null = null;
    private threshold: number;
    private timeoutMs: number;
    private timeoutHandle: NodeJS.Timeout | null = null;

    constructor(
        private port: number,
        threshold: number,
        timeoutMs = 120_000, // 2 minutes default
        private certPath?: string,
        private keyPath?: string
    ) {
        this.app = express();
        this.app.use(express.json({ limit: '1mb' }));
        this.threshold = threshold;
        this.timeoutMs = timeoutMs;
        this.setupRoutes();
    }

    private setupRoutes(): void {
        // Health check
        this.app.get('/health', (_req, res) => {
            res.json({ status: 'ok', collected: this.collectedShares.size, threshold: this.threshold });
        });

        // Member submits decrypted share
        this.app.post('/api/submit-share', (req, res) => {
            try {
                const { memberPubkey, decryptedShare, signature } = req.body as ShareSubmission;

                // Validate input
                if (!memberPubkey || !decryptedShare) {
                    return res.status(400).json({ error: 'Missing memberPubkey or decryptedShare' });
                }

                const shareBytes = Uint8Array.from(decryptedShare);
                if (shareBytes.length !== 33) {
                    return res.status(400).json({ error: 'Invalid share length: expected 32 bytes' });
                }

                // Optional: verify signature if provided
                if (signature) {
                    // TODO: Implement signature verification using member's public key
                    // This prevents unauthorized share submissions
                }

                // Store the share
                this.collectedShares.set(memberPubkey, shareBytes);
                console.log(chalk.green(`✅ Received share from ${memberPubkey.slice(0, 8)}...`));

                // Check if threshold reached
                if (this.collectedShares.size >= this.threshold && this.resolveShares) {
                    const shares = Array.from(this.collectedShares.values());
                    this.resolveShares(shares);
                    this.cleanup();
                }

                res.json({ success: true, collected: this.collectedShares.size });
            } catch (error: any) {
                console.error('❌ Error processing share submission:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Admin: check status
        this.app.get('/api/status', (_req, res) => {
            res.json({
                collected: this.collectedShares.size,
                threshold: this.threshold,
                members: Array.from(this.collectedShares.keys()),
            });
        });
    }

    async start(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.certPath && this.keyPath) {
                // HTTPS with custom cert
                const options = {
                    key: fs.readFileSync(this.keyPath),
                    cert: fs.readFileSync(this.certPath),
                };
                this.server = https.createServer(options, this.app);
            } else {
                // HTTP for local testing (NOT for production)
                this.server = this.app.listen(this.port, () => {
                    console.log(chalk.yellow(`🔓 Share collector running on http://localhost:${this.port}`));
                    console.log(chalk.yellow('⚠️  WARNING: Using HTTP - only for local testing!'));
                    resolve();
                });
                return;
            }

            this.server.listen(this.port, () => {
                console.log(chalk.green(`🔐 Share collector running on https://localhost:${this.port}`));
                resolve();
            });

            this.server.on('error', reject);
        });
    }

    async waitForShares(): Promise<Uint8Array[]> {
        return new Promise((resolve, reject) => {
            this.resolveShares = resolve;
            this.rejectShares = reject;

            // Set timeout
            this.timeoutHandle = setTimeout(() => {
                if (this.rejectShares) {
                    this.rejectShares(new Error(
                        `Timeout waiting for ${this.threshold} shares. ` +
                        `Collected: ${this.collectedShares.size}`
                    ));
                    this.cleanup();
                }
            }, this.timeoutMs);
        });
    }

    private cleanup(): void {
        if (this.timeoutHandle) clearTimeout(this.timeoutHandle);
        if (this.server) {
            this.server.close(() => {
                console.log(chalk.blue('🔚 Share collector server stopped'));
            });
        }
        this.resolveShares = null;
        this.rejectShares = null;
    }

    stop(): void {
        this.cleanup();
    }
}

// ────────────────────────────────────────────────────────────
// Main Function: executePrivateProposal
// ────────────────────────────────────────────────────────────
export async function executePrivateProposal(
    memberKeypair: Keypair,
    multisigAddress: PublicKey,
    proposalNumber: bigint,
    options?: {
        // Server config
        shareCollectorPort?: number;
        shareCollectorCert?: string;
        shareCollectorKey?: string;
        shareTimeoutMs?: number;

        // DAO DB config
        daoDbPath?: string;

        // Cloak config
        cloakProgramId?: PublicKey;
        connection?: Connection;
    }
) {
    const {
        shareCollectorPort = 3456,
        shareCollectorCert,
        shareCollectorKey,
        shareTimeoutMs = 120_000,
        daoDbPath = './dao_utxo_db.json',
        cloakProgramId = CLOAK_PROGRAM_ID,
        connection = new Connection('https://api.devnet.solana.com', 'confirmed'),
    } = options || {};

    console.log(chalk.yellow('🔐 Starting private proposal execution...'));

    // ────────────────────────────────────────────────────────
    // 1. Derive PDAs for proposal and vault_transaction
    // ────────────────────────────────────────────────────────
    const nextTxIndexBytes = bigIntToLittleEndianBytes(proposalNumber, 8);

    const [proposalPda] = PublicKey.findProgramAddressSync(
        [SEED_PREFIX, multisigAddress.toBytes(), SEED_TRANSACTION, nextTxIndexBytes, SEED_PROPOSAL],
        PROGRAM_ID
    );

    const [txPda] = PublicKey.findProgramAddressSync(
        [SEED_PREFIX, multisigAddress.toBytes(), SEED_TRANSACTION, nextTxIndexBytes],
        PROGRAM_ID
    );

    console.log(chalk.blue('Proposal PDA:'), proposalPda.toBase58());
    console.log(chalk.blue('Transaction PDA:'), txPda.toBase58());

    // ────────────────────────────────────────────────────────
    // 2. Verify proposal is approved
    // ────────────────────────────────────────────────────────
    const proposalAccount = await connection.getAccountInfo(proposalPda);
    if (!proposalAccount) {
        throw new Error(`Proposal account not found: ${proposalPda.toBase58()}`);
    }

    const proposalStatus = proposalAccount.data[56]; // offset from ProposalHeader
    if (proposalStatus !== PROPOSAL_STATUS_APPROVED) {
        throw new Error(
            `Proposal not approved for execution. Status: ${proposalStatus} (expected ${PROPOSAL_STATUS_APPROVED})`
        );
    }
    console.log(chalk.green('✅ Proposal is approved'));

    // ────────────────────────────────────────────────────────
    // 3. Fetch vault_transaction account and parse private metadata
    // ────────────────────────────────────────────────────────
    const txAccount = await connection.getAccountInfo(txPda);
    if (!txAccount) {
        throw new Error('Transaction account not found');
    }



    const VAULT_TRANSACTION_HEADER_SIZE = 73; // ✅ MUST BE 73

    const metaOffset = VAULT_TRANSACTION_HEADER_SIZE;

    // Check if data is long enough
    if (txAccount.data.length < metaOffset + 72) {
        throw new Error("Account data too short for private transfer metadata");
    }

    const utxoCommitmentBytes = txAccount.data.slice(metaOffset, metaOffset + 32);
    const amountBytes = txAccount.data.slice(metaOffset + 32, metaOffset + 40);
    const recipientBytes = txAccount.data.slice(metaOffset + 40, metaOffset + 72);


    // Ensure bytes32ToBigint handles the byte order correctly for your use case
    // If it's a hash, you might just want to keep it as a Uint8Array or Hex string
    const utxoCommitmentHex = Buffer.from(utxoCommitmentBytes).toString('hex');
    const utxoCommitment = bytes32ToBigint(utxoCommitmentBytes); // Only if you need math

    const transferAmount = amountBytes.readBigUInt64LE(0);
    const recipientPublicKey = new PublicKey(recipientBytes);

    const commitmentBytes = txAccount.data.slice(metaOffset, metaOffset + 32);
    console.log('Commitment bytes read (hex):', Buffer.from(commitmentBytes).toString('hex'));
    console.log('Commitment bytes (first 8):', commitmentBytes.slice(0, 8).toString('hex'));

    console.log('Parsed commitment (bigint):', utxoCommitment.toString());
    console.log(chalk.blue('UTXO Commitment (Hex):'), utxoCommitmentHex.slice(0, 16) + '...');
    console.log(chalk.blue('Transfer Amount:'), transferAmount.toString(), 'lamports');
    console.log(chalk.blue('Recipient:'), recipientPublicKey.toBase58());
    const treasuryPrivateKey = 211686177891468104444359034735386504763692744799760882094635191488382041378n;

    /*
        // ────────────────────────────────────────────────────────
        // 4. Start HTTPS server and collect Shamir shares
        // ────────────────────────────────────────────────────────
        console.log(chalk.yellow(`🌐 Starting share collector on port ${shareCollectorPort}...`));
        console.log(chalk.yellow(`⏳ Waiting for threshold shares (timeout: ${shareTimeoutMs / 1000}s)...`));
    
        const collector = new ShareCollectorServer(
            shareCollectorPort,
            2, // TODO: Read threshold from on-chain multisig account
            shareTimeoutMs,
            shareCollectorCert,
            shareCollectorKey
        );
    
        await collector.start();
    
        // Instruct members to submit shares (print to console for demo)
        console.log(chalk.cyan('\n📢 Instruct members to submit their decrypted shares:'));
        console.log(chalk.cyan(`POST https://localhost:${shareCollectorPort}/api/submit-share`));
        console.log(chalk.cyan('Body: { "memberPubkey": "<base58>", "decryptedShare": [<32 bytes>] }\n'));
    
        // Wait for threshold shares
        let decryptedShares: Uint8Array[];
        try {
            decryptedShares = await collector.waitForShares();
            console.log(chalk.green(`✅ Collected ${decryptedShares.length} shares (threshold met)`));
        } catch (error: any) {
            collector.stop();
            throw new Error(`Failed to collect shares: ${error.message}`);
        }
    
        collector.stop();
    
        // ────────────────────────────────────────────────────────
        // 5. Reconstruct treasury private key from Shamir shares
        // ────────────────────────────────────────────────────────
        // In executePrivateProposal, after collecting shares:
        console.log(chalk.yellow('🔑 Reconstructing treasury private key...'));
        console.log(`Debug: Collected ${decryptedShares.length} shares`);
        decryptedShares.forEach((share, i) => {
            console.log(`  Share ${i}: ${share.length} bytes, first 8: ${Buffer.from(share.slice(0, 8)).toString('hex')}`);
        });
    
        const treasuryPrivateKeyBytes = await combine(decryptedShares);
        console.log(`Debug: combine() returned ${treasuryPrivateKeyBytes.length} bytes`);
        console.log(`Debug: Raw bytes (hex): ${Buffer.from(treasuryPrivateKeyBytes).toString('hex')}`);
    
        const treasuryPrivateKey = bytes32ToBigint(treasuryPrivateKeyBytes);
        console.log(chalk.green('✅ Treasury private key reconstructed'));
        console.log('Treasury Private Key (bigint):', treasuryPrivateKey);
    
        // Zero sensitive data
        treasuryPrivateKeyBytes.fill(0);
        decryptedShares.forEach(s => s.fill(0));
        */
    // ────────────────────────────────────────────────────────
    // 6. Load blinding factor from local DAO DB
    // ────────────────────────────────────────────────────────
    console.log(chalk.yellow('📦 Loading blinding factor from DAO DB...'));
    const daoDb = await loadDaoDb(daoDbPath);
    const utxoRecord = daoDb.find((r: Utxo) =>
        r.commitment === utxoCommitment.toString(16) ||
        r.commitment === utxoCommitment.toString()
    );

    if (!utxoRecord) {
        throw new Error(
            `UTXO record not found in DAO DB for commitment ${utxoCommitment.toString(16).slice(0, 16)}...`
        );
    }

    const blinding = BigInt(utxoRecord.blinding);
    console.log(chalk.blue('Blinding factor loaded'));

    // ────────────────────────────────────────────────────────
    // 7. Reconstruct full UTXO object for Cloak SDK
    // ────────────────────────────────────────────────────────
    const treasuryPublicKey = bytes32ToBigint(multisigAddress.toBytes());

    const utxoToSpend: Utxo = {
        amount: transferAmount,
        keypair: {
            publicKey: treasuryPublicKey,
            privateKey: treasuryPrivateKey,
        },
        blinding,
        mintAddress: NATIVE_SOL_MINT,
        commitment: utxoCommitment,
        // index and siblingCommitment are optional for proof generation
    };

    // ────────────────────────────────────────────────────────
    // 8. Prepare Cloak transaction outputs
    // ────────────────────────────────────────────────────────
    // Output 1: Recipient gets the transferred amount
    const recipientOutput = await createUtxo(transferAmount, {
        publicKey: bytes32ToBigint(recipientPublicKey.toBytes()),
        privateKey: 0n, // Recipient manages their own key
    }, NATIVE_SOL_MINT);

    // Note: For simplicity, this example assumes exact amount transfer (no change).
    // In production: calculate change and create a change output back to treasury.

    // ────────────────────────────────────────────────────────
    // 9. Execute Cloak transaction
    // ────────────────────────────────────────────────────────
    console.log(chalk.yellow('📤 Generating ZK proof and submitting transaction...'));

    const cloakResult = await transact(
        {
            inputUtxos: [utxoToSpend],
            outputUtxos: [recipientOutput],
            externalAmount: 0n, // Shield-to-shield transfer
        },
        {
            connection,
            programId: cloakProgramId,
            depositorKeypair: memberKeypair, // Fee payer
            walletPublicKey: memberKeypair.publicKey,
            useUniqueNullifiers: true,
            enforceViewingKeyRegistration: false,
            maxRootRetries: 5, // Retry if Merkle root changes
        }
    );

    console.log(chalk.green('✅ Cloak transaction submitted!'));
    console.log('Signature:', cloakResult.signature);

    // ────────────────────────────────────────────────────────
    // 10. Update DAO DB: mark UTXO as spent
    // ────────────────────────────────────────────────────────
    await markUtxoSpent(daoDbPath, utxoCommitment.toString(16));
    console.log('🗑️ UTXO marked as spent in DAO DB');

    // ────────────────────────────────────────────────────────
    // Return result
    // ────────────────────────────────────────────────────────
    return {
        signature: cloakResult.signature,
        proposalNumber,
        utxoCommitment,
        amount: transferAmount,
        recipient: recipientPublicKey,
    };

}
// src/utils/index.ts
export function bytes32ToBigint(bytes: Uint8Array): bigint {
    let normalized = bytes;

    // Handle 33-byte output from Shamir (sign byte at index 0)
    if (bytes.length === 33) {
        normalized = bytes.slice(1, 33); // Remove sign byte
    }

    if (normalized.length !== 32) {
        throw new Error(
            `Expected 32 bytes after normalization, got ${normalized.length}. ` +
            `Raw input: ${bytes.length} bytes, hex: ${Buffer.from(bytes).toString('hex')}`
        );
    }

    // ✅ normalized is BIG-ENDIAN (MSB at index 0) — read accordingly
    let result = 0n;
    for (let i = 0; i < 32; i++) {
        result = (result << 8n) | BigInt(normalized[i]);
    }
    return result;
}
// ────────────────────────────────────────────────────────────
// Helper: Load DAO UTXO Database
// ────────────────────────────────────────────────────────────
async function loadDaoDb(dbPath: string): Promise<any[]> {
    try {
        const content = await fs.promises.readFile(dbPath, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        console.warn('⚠️ Failed to load DAO DB:', error);
        return [];
    }
}

// ────────────────────────────────────────────────────────────
// Helper: Mark UTXO as Spent in DAO DB
// ────────────────────────────────────────────────────────────
async function markUtxoSpent(dbPath: string, commitmentHex: string): Promise<void> {
    try {
        const content = await fs.promises.readFile(dbPath, 'utf8');
        const db = JSON.parse(content);
        const record = db.find((r: any) => r.commitment === commitmentHex);
        if (record) {
            record.spent = true;
            record.spentAt = Date.now();
            await fs.promises.writeFile(dbPath, JSON.stringify(db, null, 2));
        }
    } catch (error) {
        console.warn('⚠️ Failed to update DAO DB:', error);
    }
}