import {
    generateUtxoKeypair, getNkFromUtxoPrivateKey
} from '@cloak.dev/sdk-devnet'
import { split } from 'shamir-secret-sharing'
import path from 'path';
import nacl from 'tweetnacl'
import { readFile } from 'fs/promises';
import { convertPublicKey, convertSecretKey } from 'ed2curve';
import {
    PublicKey,
    TransactionInstruction,
    SystemProgram,
    Transaction,
    Connection,
    Keypair,
    TransactionMessage,
    VersionedTransaction
} from '@solana/web3.js'
import { encryptShare } from '../test_shamir';
import bs58 from "bs58";
import chalk from 'chalk';
import { sign } from 'crypto';


import { SEED_MULTISIG, SEED_PREFIX, TREASURY, SEED_TRANSACTION, SEED_PROPOSAL, PROGRAM_ID, DISCRIMINATOR_APPROVE_PROPOSAL, PROPOSAL_HEADER_SIZE, bigIntToLittleEndianBytes } from '../utils';
// ─── constants ───────────────────────────────────────────
// shares are secretLen+1 bytes (33 for 32-byte secret)
export const SHARE_RAW_SIZE = 33
// nacl.box output: 32 (ephemeral) + 24 (nonce) + (33 + 16) (box) = 105
export const SHARE_CIPHERTEXT_SIZE = 32 + 24 + SHARE_RAW_SIZE + 16  // 105
export const ENCRYPTED_SHARE_SIZE = 32 + SHARE_CIPHERTEXT_SIZE  // member pubkey + ciphertext
import { combine } from 'shamir-secret-sharing';

export class CreateMultisigIxData {
    discriminator: number;        // 1 byte (u8)
    threshold: number;            // 2 bytes (u16 LE)
    rentCollector: PublicKey;     // 32 bytes
    members: PublicKey[];         // 4 bytes (u32 len) + N*32 bytes
    encryptedShares: {
        member: PublicKey;
        ciphertext: Uint8Array;   // Fixed 105 bytes
    }[];
    treasuryUtxoPubkey: Uint8Array; // 32 bytes

    constructor(data: {
        threshold: number;
        rentCollector: PublicKey;
        members: PublicKey[];
        encryptedShares: { member: PublicKey; ciphertext: Uint8Array }[];
        treasuryUtxoPubkey: Uint8Array;
    }) {
        this.discriminator = 0;
        this.threshold = data.threshold;
        this.rentCollector = data.rentCollector;
        this.members = data.members;
        this.encryptedShares = data.encryptedShares;
        this.treasuryUtxoPubkey = data.treasuryUtxoPubkey;
    }

    serialize(): Buffer {
        // 1. Discriminator (1 byte)
        const discriminatorBuf = Buffer.from([this.discriminator]);

        // 2. Threshold (2 bytes)
        const thresholdBuf = Buffer.alloc(2);
        thresholdBuf.writeUInt16LE(this.threshold);

        // 3. Rent Collector (32 bytes)
        const rentCollectorBuf = Buffer.from(this.rentCollector.toBytes());

        // 4. Members
        const membersLenBuf = Buffer.alloc(4);
        membersLenBuf.writeUInt32LE(this.members.length);
        const membersBytes = Buffer.concat(this.members.map(m => Buffer.from(m.toBytes())));

        // 5. Shares
        const sharesLenBuf = Buffer.alloc(4);
        sharesLenBuf.writeUInt32LE(this.encryptedShares.length);

        const sharesBytes = Buffer.concat(
            this.encryptedShares.map(({ member, ciphertext }) => {
                if (ciphertext.length !== 105) {
                    throw new Error(`Ciphertext length mismatch: ${ciphertext.length}`);
                }
                // [32 Pubkey][105 Ciphertext] = 137 bytes
                return Buffer.concat([
                    Buffer.from(member.toBytes()),
                    Buffer.from(ciphertext)
                ]);
            })
        );

        // 6. Treasury Pubkey
        const treasuryPubkeyBuf = Buffer.from(this.treasuryUtxoPubkey);

        return Buffer.concat([
            discriminatorBuf,
            thresholdBuf,
            rentCollectorBuf,
            membersLenBuf,
            membersBytes,
            sharesLenBuf,
            sharesBytes,
            treasuryPubkeyBuf,
        ]);
    }
}

export function bytes32ToBigint(bytes: Uint8Array): bigint {
    if (bytes.length !== 32) throw new Error(`Expected 32 bytes, got ${bytes.length}`)
    let result = 0n
    for (let i = 31; i >= 0; i--) {
        result = (result << 8n) | BigInt(bytes[i])
    }
    return result
}
export async function createMultisig(
    members: PublicKey[],
    threshold: number,
    rentCollector: PublicKey,
    creatorKey: Keypair,
    connection: Connection,
) {
    // ────────────────────────────────────────────────────────
    // 1. Validation
    // ────────────────────────────────────────────────────────
    if (members.length === 0) throw new Error('At least one member required');
    if (threshold <= 0 || threshold > members.length) {
        throw new Error(`Invalid threshold ${threshold} for ${members.length} members`);
    }

    console.log(chalk.yellow('🏗️  Initializing FortisX Multisig...'));
    console.log(chalk.blue('Members:'), members.length);
    console.log(chalk.blue('Threshold:'), threshold);

    // ────────────────────────────────────────────────────────
    // 2. Generate Treasury UTXO & Split Shares
    // ────────────────────────────────────────────────────────
    const treasuryKp = await generateUtxoKeypair();

    // ⚠️ SECURITY WARNING: Do NOT log the Viewing Key (nk) in production.
    // Only log it if explicitly requested via a --show-viewing-key flag.
    // For now, we log a truncated hash so users know it was generated.
    const viewingKeyNk = getNkFromUtxoPrivateKey(treasuryKp.privateKey);
    const nkHash = bs58.encode(viewingKeyNk).slice(0, 8) + '...';
    console.log(chalk.dim('🔑 Treasury Viewing Key (nk) generated:'), nkHash);
    console.log(chalk.dim('   ⚠️  Save this key securely! It is required for compliance scanning.'));

    console.log(chalk.blue('Treasury UTXO Public Key:'), treasuryKp.publicKey);

    // Split private key into Shamir shares
    const treasuryPkBytesBE = bigIntToLittleEndianBytes(treasuryKp.privateKey, 32).reverse(); // Convert to BE for Shamir if needed
    console.log(chalk.yellow('🧩 Splitting treasury key into Shamir shares...'));

    const shares = await split(treasuryPkBytesBE, members.length, threshold);

    // Encrypt shares for each member
    console.log(chalk.yellow('🔐 Encrypting shares for members...'));
    const encryptedSharesPromises = members.map(async (member, i) => {
        const encrypted = await encryptShare(shares[i], member);
        console.log(chalk.dim(`   Member ${i + 1} (${member.toBase58().slice(0, 6)}...): Encrypted (${encrypted.length} bytes)`));
        return { member, ciphertext: encrypted };
    });

    const encryptedShares = await Promise.all(encryptedSharesPromises);
    console.log(chalk.green('✅ Shares encrypted successfully'));

    // ────────────────────────────────────────────────────────
    // 3. Derive PDA & Build Transaction
    // ────────────────────────────────────────────────────────
    const [multisigPda] = PublicKey.findProgramAddressSync(
        [SEED_PREFIX, SEED_MULTISIG, creatorKey.publicKey.toBytes()],
        PROGRAM_ID
    );
    console.log(chalk.blue('Multisig PDA:'), multisigPda.toBase58());

    const ixData = new CreateMultisigIxData({
        threshold,
        rentCollector,
        members,
        encryptedShares,
        treasuryUtxoPubkey: bigIntToLittleEndianBytes(treasuryKp.publicKey, 32),
    });

    const ix = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: TREASURY, isSigner: false, isWritable: true },
            { pubkey: multisigPda, isSigner: false, isWritable: true },
            { pubkey: creatorKey.publicKey, isSigner: true, isWritable: false },
            { pubkey: creatorKey.publicKey, isSigner: true, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: ixData.serialize(),
    });

    // ────────────────────────────────────────────────────────
    // 4. Secure Wipe of Sensitive Data (Before Sending)
    // ────────────────────────────────────────────────────────
    // Wipe raw bytes and bigint from memory ASAP
    treasuryPkBytesBE.fill(0);
    shares.forEach(s => s.fill(0));
    treasuryKp.privateKey = 0n;

    // ────────────────────────────────────────────────────────
    // 5. Send Transaction
    // ────────────────────────────────────────────────────────
    const { blockhash } = await connection.getLatestBlockhash();
    const msg = new TransactionMessage({
        payerKey: creatorKey.publicKey,
        recentBlockhash: blockhash,
        instructions: [ix],
    }).compileToV0Message();

    const tx = new VersionedTransaction(msg);
    tx.sign([creatorKey]);

    console.log(chalk.yellow('📤 Sending multisig creation transaction...'));

    try {
        const signature = await connection.sendTransaction(tx, {
            skipPreflight: false,
            maxRetries: 3,
            preflightCommitment: 'confirmed',
        });

        console.log(chalk.green('✅ Multisig Created Successfully!'));
        console.log(chalk.blue('Signature:'), signature);
        console.log(chalk.blue('Multisig Address:'), multisigPda.toBase58());

        // ⚠️ FINAL WARNING: Remind user to save the Viewing Key
        console.log(chalk.red.bold('\n⚠️  IMPORTANT:'));
        console.log(chalk.red('   Save your Treasury Viewing Key (nk) now!'));
        console.log(chalk.red('   It was generated during setup and is NOT stored on-chain.'));
        console.log(chalk.red('   Without it, you cannot scan compliance history.'));
        console.log(chalk.dim(`   Key (nk): ${bs58.encode(viewingKeyNk)}\n`));

        return { signature, multisigPda, treasuryPublicKey: treasuryKp.publicKey };

    } catch (error: any) {
        console.error(chalk.red('❌ Transaction Failed:'), error.message);
        throw error;
    }
}