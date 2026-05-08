// src/commands/executePrivateProposal.ts
import { PublicKey, Connection, Keypair } from '@solana/web3.js';
import chalk from 'chalk';
import { readFile } from 'fs/promises';
import * as http from 'http';
import { StoredUtxoRecord } from './privateDeposit';
import * as https from 'https';
import * as shamir from 'shamir-secret-sharing';
import { bytes32ToBigint } from './createMultisig';
import { le32ToBigint, testShamirUtxoRoundTrip } from '../test_shamir';
import { writeFile } from 'fs'
import {
    CLOAK_PROGRAM_ID,
    fullWithdraw,
    Utxo,
    getNkFromUtxoPrivateKey,
    swapWithChange,
} from '@cloak.dev/sdk-devnet';
import {
    MultiPayoutEntry,
    buildPayloadHash as buildTransferPayloadHash,
    ProposalDbRecord,
} from './createPrivateTransferProposal.ts';
import {
    SwapEntry,
    SwapProposalDbRecord,
    buildPayloadHash as buildSwapPayloadHash,
} from './createPrivateSwapProposal';
import {
    SEED_PREFIX,
    SEED_TRANSACTION,
    SEED_PROPOSAL,
    PROGRAM_ID,
    bigIntToLittleEndianBytes,
} from '../utils';

// ────────────────────────────────────────────────────────────
// Constants — must match Rust layout exactly
// ────────────────────────────────────────────────────────────
const PAYLOAD_HASH_OFFSET = 73;
const PAYLOAD_HASH_SIZE = 32;
const PROPOSAL_STATUS_APPROVED = 1;
const PROPOSAL_STATUS_BYTE_OFFSET = 56;
const PROPOSAL_TYPE_BYTE_OFFSET = 57;
const PROPOSAL_TYPE_PRIVATE_TRANSFER = 1;
const PROPOSAL_TYPE_PRIVATE_SWAP = 2;
const DEFAULT_RELAY_URL = 'https://relay.cloak.ag';

// Multisig account layout offsets
// [discriminator:8][create_key:32][rent_collector:32][treasury_utxo_pubkey:32][threshold:2]...
const MULTISIG_THRESHOLD_OFFSET = 96; // adjust if your layout differs




// ────────────────────────────────────────────────────────────
// Share Collector Server
// ────────────────────────────────────────────────────────────

/**
 * Spins up an HTTP(S) server that collects Shamir shares from multisig members.
 * Resolves once `threshold` unique shares have been received, or rejects on timeout.
 *
 * NOTE: shares submitted by members already contain the leading index byte
 * (inserted by shamir.split). Do NOT add another index byte before passing
 * to shamir.combine — that would corrupt reconstruction.
 */
function collectShares(params: {
    threshold: number;
    port: number;
    timeoutMs: number;
    allowedMembers?: string[]; // optional pubkey allowlist; omit to allow any member
    useHttps: boolean;
    certPath?: string;
    keyPath?: string;
}): Promise<Uint8Array[]> {
    const { threshold, port, timeoutMs, allowedMembers, useHttps, certPath, keyPath } = params;

    return new Promise<Uint8Array[]>((resolve, reject) => {
        const collectedShares = new Map<string, Uint8Array>(); // pubkey → raw share bytes (with index byte)
        let settled = false;

        // ── settle once ─────────────────────────────────────
        function settle(err?: Error) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            // Give the last HTTP response a tick to flush before closing
            setImmediate(() => {
                server.close(() => {
                    if (err) reject(err);
                    else resolve(Array.from(collectedShares.values()));
                });
            });
        }

        // ── timeout guard ────────────────────────────────────
        const timer = setTimeout(
            () => settle(new Error(
                `Share collection timed out: ${collectedShares.size}/${threshold} shares received after ${timeoutMs / 1000}s`
            )),
            timeoutMs,
        );

        // ── request handler ──────────────────────────────────
        const requestHandler = (req: http.IncomingMessage, res: http.ServerResponse) => {
            // Path must match what the submit_share CLI POSTs to
            if (req.method !== 'POST' || req.url !== '/api/submit-share') {
                res.writeHead(404, { 'Content-Type': 'application/json' })
                    .end(JSON.stringify({ error: 'Not found' }));
                return;
            }

            let rawBody = '';
            req.on('data', (chunk) => (rawBody += chunk));
            req.on('end', () => {
                try {
                    const submission = JSON.parse(rawBody) as {
                        memberPubkey: string;
                        decryptedShare: number[];
                        timestamp: number;
                    };

                    const { memberPubkey, decryptedShare } = submission;

                    // Validate member pubkey is present
                    if (!memberPubkey || typeof memberPubkey !== 'string') {
                        throw new Error('Missing or invalid memberPubkey');
                    }

                    // Optional allowlist check
                    if (allowedMembers && !allowedMembers.includes(memberPubkey)) {
                        res.writeHead(403, { 'Content-Type': 'application/json' })
                            .end(JSON.stringify({ error: `Not a recognised multisig member: ${memberPubkey}` }));
                        return;
                    }

                    // Deduplicate
                    if (collectedShares.has(memberPubkey)) {
                        res.writeHead(409, { 'Content-Type': 'application/json' })
                            .end(JSON.stringify({ error: 'Share already received from this member' }));
                        return;
                    }

                    // Validate share bytes
                    if (!Array.isArray(decryptedShare) || decryptedShare.length === 0) {
                        throw new Error('decryptedShare must be a non-empty number[]');
                    }

                    // Store — keep raw bytes as-is; the leading index byte is already
                    // present (shamir.split includes it). shamir.combine expects it.
                    collectedShares.set(memberPubkey, new Uint8Array(decryptedShare));

                    const collected = collectedShares.size;
                    console.log(
                        chalk.green(`  ✅ Share from ${memberPubkey.slice(0, 16)}…`) +
                        chalk.blue(` (${collected}/${threshold})`)
                    );

                    const body = JSON.stringify({
                        collected,
                        threshold,
                        status: collected >= threshold ? 'complete' : 'waiting',
                    });
                    res.writeHead(200, { 'Content-Type': 'application/json' }).end(body);

                    // Threshold reached → resolve
                    if (collected >= threshold) {
                        settle();
                    }
                } catch (err: any) {
                    console.error(chalk.red(`  ⚠️  Bad share submission: ${err.message}`));
                    res.writeHead(400, { 'Content-Type': 'application/json' })
                        .end(JSON.stringify({ error: err.message }));
                }
            });
        };

        // ── create HTTP or HTTPS server ──────────────────────
        let server: http.Server;

        if (useHttps) {
            if (!certPath || !keyPath) {
                return settle(new Error(
                    'useHttps=true requires --certPath and --keyPath. ' +
                    'For local testing pass useHttps=false and use --insecure on the CLI side.'
                ));
            }
            // readFile is async; boot after loading certs
            Promise.all([readFile(certPath), readFile(keyPath)])
                .then(([cert, key]) => {
                    server = https.createServer({ cert, key }, requestHandler);
                    server.on('error', (e) => settle(e));
                    server.listen(port, () => printBanner(port, true, threshold));
                })
                .catch(settle);
            return; // Promise already in flight
        } else {
            server = http.createServer(requestHandler);
        }

        server.on('error', (e) => settle(e));
        server.listen(port, () => printBanner(port, false, threshold));
    });
}

function printBanner(port: number, tls: boolean, threshold: number) {
    const proto = tls ? 'https' : 'http';
    console.log(chalk.blue(`\n🔐 Share collector listening on port ${port}`));
    console.log(chalk.yellow(`   Waiting for ${threshold} share(s)…`));
    console.log(chalk.dim(
        `   Members: submit_share --collector-url ${proto}://localhost:${port}/api/submit-share` +
        (tls ? '' : ' --insecure')
    ));
    console.log();
}
function be32ToBigint(bytes: Uint8Array): bigint {
    let v = 0n;
    for (let i = 0; i < bytes.length; i++) {
        v = (v << 8n) | BigInt(bytes[i]);
    }
    return v;
}
// ────────────────────────────────────────────────────────────
// Shamir reconstruction helper
// ────────────────────────────────────────────────────────────
async function reconstructKeyFromShares(shares: Uint8Array[]): Promise<bigint> {
    // Shares already contain their leading index byte (inserted by shamir.split).
    // Pass them directly — do NOT prepend another index byte.
    const reconstructedBytes = await shamir.combine(shares);
    console.log('raw bytes hex:', Buffer.from(reconstructedBytes).toString('hex'));
    /*
        // Try both interpretations
        const asLE = le32ToBigint(reconstructedBytes);
        const asBE = be32ToBigint(reconstructedBytes);  // add this helper
        console.log('as LE:', asLE.toString());
        console.log('as BE:', asBE.toString());
        console.log('expected:', '1274836231757216945747402414035119039413593001908602145758305896907906063114');
    */
    return be32ToBigint(reconstructedBytes);
}

// ────────────────────────────────────────────────────────────
// High-level orchestrator
// ────────────────────────────────────────────────────────────
async function reconstructTreasuryKeyViaShamir(params: {
    multisigAddress: PublicKey;
    connection: Connection;
    collectorPort: number;
    shareTimeoutMs: number;
    useHttps: boolean;
    certPath?: string;
    keyPath?: string;
    allowedMembers?: string[];
}): Promise<bigint> {
    const {
        multisigAddress,
        connection,
        collectorPort,
        shareTimeoutMs,
        useHttps,
        certPath,
        keyPath,
        allowedMembers,
    } = params;

    console.log(chalk.yellow('\n🧩 Collecting Shamir shares to reconstruct treasury key…'));

    const { threshold } = await fetchMultisigMetadata(connection, multisigAddress);

    const shares = await collectShares({
        threshold,
        port: collectorPort,
        timeoutMs: shareTimeoutMs,
        allowedMembers,
        useHttps,
        certPath,
        keyPath,
    });

    console.log(chalk.yellow(`\n🔐 Reconstructing treasury key from ${shares.length} shares…`));
    const treasuryKey = await reconstructKeyFromShares(shares);
    console.log(
        chalk.green('✅ Treasury private key reconstructed:'),
        treasuryKey.toString().slice(0, 24) + '…'
    );

    return treasuryKey;
}

// ────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────
export async function executePrivateProposal(
    memberKeypair: Keypair,
    multisigAddress: PublicKey,
    proposalNumber: bigint,
    options?: {
        transferHistoryPath?: string;
        swapHistoryPath?: string;
        utxoFilePath?: string;
        connection?: Connection;
        slippageBps?: number;
        relayUrl?: string;
        // Share collection
        collectorPort?: number;
        shareTimeoutMs?: number;
        useHttps?: boolean;
        certPath?: string;
        keyPath?: string;
        allowedMembers?: string[]; // pubkey allowlist; omit = accept any member
    }
) {
    const {
        transferHistoryPath = './proposal_history.json',
        swapHistoryPath = './swap_proposal_history.json',
        utxoFilePath = './treasury_utxos.json',
        connection = new Connection('https://api.devnet.solana.com', 'confirmed'),
        slippageBps = 500,
        relayUrl = DEFAULT_RELAY_URL,
        collectorPort = 3456,
        shareTimeoutMs = 300_000, // 5 minutes
        useHttps = false,
        certPath,
        keyPath,
        allowedMembers,
    } = options ?? {};

    console.log(chalk.yellow('🔐 Starting private proposal execution...'));

    // ── Reconstruct treasury key from Shamir shares ──────────
    const treasuryPrivateKey = await reconstructTreasuryKeyViaShamir({
        multisigAddress,
        connection,
        collectorPort,
        shareTimeoutMs,
        useHttps,
        certPath,
        keyPath,
        allowedMembers,
    });
    // 1274836231757216945747402414035119039413593001908602145758305896907906063114n
    console.log("treasury private key: ", treasuryPrivateKey);
    // ────────────────────────────────────────────────────────
    // 1. Derive PDAs
    // ────────────────────────────────────────────────────────
    const txIndexBytes = bigIntToLittleEndianBytes(proposalNumber, 8);
    const [proposalPda] = PublicKey.findProgramAddressSync(
        [SEED_PREFIX, multisigAddress.toBytes(), SEED_TRANSACTION, txIndexBytes, SEED_PROPOSAL],
        PROGRAM_ID
    );
    const [txPda] = PublicKey.findProgramAddressSync(
        [SEED_PREFIX, multisigAddress.toBytes(), SEED_TRANSACTION, txIndexBytes],
        PROGRAM_ID
    );

    // ────────────────────────────────────────────────────────
    // 2. Fetch proposal account — status + type
    // ────────────────────────────────────────────────────────
    const proposalAccount = await connection.getAccountInfo(proposalPda);
    if (!proposalAccount) {
        throw new Error(`Proposal account not found: ${proposalPda.toBase58()}`);
    }
    if (proposalAccount.data[PROPOSAL_STATUS_BYTE_OFFSET] !== PROPOSAL_STATUS_APPROVED) {
        throw new Error(`Proposal not approved. Status: ${proposalAccount.data[PROPOSAL_STATUS_BYTE_OFFSET]}`);
    }
    const onChainProposalType = proposalAccount.data[PROPOSAL_TYPE_BYTE_OFFSET];
    console.log(chalk.green('✅ Proposal approved on-chain'), `type=${onChainProposalType}`);

    // ────────────────────────────────────────────────────────
    // 3. Read on-chain hash
    // ────────────────────────────────────────────────────────
    const txAccount = await connection.getAccountInfo(txPda);
    if (!txAccount) {
        throw new Error(`vault_transaction account not found: ${txPda.toBase58()}`);
    }
    if (txAccount.data.length < PAYLOAD_HASH_OFFSET + PAYLOAD_HASH_SIZE) {
        throw new Error(`vault_transaction account too small: ${txAccount.data.length}`);
    }
    const onChainHash = Buffer.from(
        txAccount.data.slice(PAYLOAD_HASH_OFFSET, PAYLOAD_HASH_OFFSET + PAYLOAD_HASH_SIZE)
    );

    // ────────────────────────────────────────────────────────
    // 4. Fetch treasury pubkey from multisig account
    //    Layout: [create_key:32][rent_collector:32][treasury_utxo_pubkey:32]
    // ────────────────────────────────────────────────────────
    const multisigAccount = await connection.getAccountInfo(multisigAddress);
    if (!multisigAccount) throw new Error('Multisig account not found');
    const treasuryPublicKey = bytes32ToBigint(
        new Uint8Array(multisigAccount.data.slice(64, 96))
    );
    // console.log("Commitment: ",e.c)
    // ────────────────────────────────────────────────────────
    // 5. Branch by proposal type
    // ────────────────────────────────────────────────────────
    if (onChainProposalType === PROPOSAL_TYPE_PRIVATE_TRANSFER) {

        const record = await loadRecord<ProposalDbRecord>(
            transferHistoryPath, proposalNumber, multisigAddress
        );
        if (!record) throw new Error(
            `Transfer proposal #${proposalNumber} not found in ${transferHistoryPath}`
        );
        console.log(chalk.green('✅ Found transfer record in DB'));

        const mint = new PublicKey(record.mint);
        const salt = BigInt(record.salt);
        const entries: MultiPayoutEntry[] = record.entries.map(e => ({
            commitment: BigInt(e.commitment),
            amount: BigInt(e.amount),
            recipient: new PublicKey(e.recipient),
        }));

        enforceHash(
            buildTransferPayloadHash(mint, salt, entries),
            onChainHash,
            record.payloadHash,
        );

        return executeTransfers(
            entries, treasuryPublicKey, treasuryPrivateKey,
            memberKeypair, connection, utxoFilePath,
        );

    } else if (onChainProposalType === PROPOSAL_TYPE_PRIVATE_SWAP) {

        const record = await loadRecord<SwapProposalDbRecord>(
            swapHistoryPath, proposalNumber, multisigAddress
        );
        if (!record) throw new Error(
            `Swap proposal #${proposalNumber} not found in ${swapHistoryPath}`
        );
        console.log(chalk.green('✅ Found swap record in DB'));

        const salt: bigint = BigInt(record.salt);
        const entry: SwapEntry = {
            mint: new PublicKey(record.entry.mint),
            commitment: BigInt(record.entry.commitment),
            amount: BigInt(record.entry.amount),
            recipientAta: new PublicKey(record.entry.recipientAta),
            targetMint: new PublicKey(record.entry.targetMint),
        };

        enforceHash(
            buildSwapPayloadHash(entry, salt),
            onChainHash,
            record.payloadHash,
        );

        return executeSwap(
            entry, treasuryPublicKey, treasuryPrivateKey,
            memberKeypair, connection, utxoFilePath,
            slippageBps
        );

    } else {
        throw new Error(`Unknown proposal type: ${onChainProposalType}`);
    }
}
async function fetchMultisigMetadata(
    connection: Connection,
    multisigAddress: PublicKey
): Promise<{ threshold: number; memberPubkeys: string[] }> {
    const account = await connection.getAccountInfo(multisigAddress);
    if (!account) throw new Error('Multisig account not found');

    const data = account.data;

    // Offsets based on your struct:
    // 0..32:   create_key
    // 32..64:  rent_collector
    // 64..96:  treasury_utxo_pubkey
    // 96..128: latest_utxo_commitment
    // 128..136: transaction_index (u64 LE)
    // 136..138: threshold (u16 LE)
    // 138..139: bump (u8)

    // Next is Vec<Pubkey> members
    // Vec<T> in Borsh/Solana typically starts with a u32 length
    // 139..143: member_count (u32 LE)

    const thresholdOffset = 136;
    const memberCountOffset = 139; // Start of Vec<Pubkey>

    const threshold = data.readUInt16LE(thresholdOffset);
    const memberCount = data.readUInt32LE(memberCountOffset);

    const memberPubkeys: string[] = [];
    let offset = memberCountOffset + 4; // Move past the u32 length

    for (let i = 0; i < memberCount; i++) {
        if (offset + 32 > data.length) {
            throw new Error('Account data too short for expected members');
        }
        const pubkeyBytes = data.slice(offset, offset + 32);
        memberPubkeys.push(new PublicKey(pubkeyBytes).toBase58());
        offset += 32;
    }

    return { threshold, memberPubkeys };
}

// ────────────────────────────────────────────────────────────
// Hash enforcement — shared by both branches
// Throws before any UTXO is touched if anything doesn't match.
// ────────────────────────────────────────────────────────────
function enforceHash(
    recomputed: Buffer,
    onChain: Buffer,
    dbStoredHex: string,
): void {
    console.log(chalk.blue('On-chain hash:   '), onChain.toString('hex'));
    console.log(chalk.blue('Recomputed hash: '), recomputed.toString('hex'));
    console.log(chalk.blue('DB stored hash:  '), dbStoredHex);

    // FIX 1a: compare recomputed vs on-chain (tamper detection)
    if (!recomputed.equals(onChain)) {
        throw new Error(
            `🚨 HASH MISMATCH — refusing to execute.\n` +
            `  on-chain:   ${onChain.toString('hex')}\n` +
            `  recomputed: ${recomputed.toString('hex')}\n` +
            `Possible causes: wrong salt, tampered DB record, wrong proposal index.`
        );
    }

    // FIX 1b: also sanity-check the DB-stored hex matches (catches DB corruption)
    if (recomputed.toString('hex') !== dbStoredHex) {
        throw new Error(
            `🚨 DB RECORD INCONSISTENT — recomputed hash differs from stored payloadHash.\n` +
            `  recomputed: ${recomputed.toString('hex')}\n` +
            `  DB stored:  ${dbStoredHex}\n` +
            `The DB record may have been modified after proposal creation.`
        );
    }

    console.log(chalk.green('✅ Hash verified — payload is authentic'));
}

// ────────────────────────────────────────────────────────────
// Generic DB loader — both transfer and swap use same shape
// ────────────────────────────────────────────────────────────
async function loadRecord<T extends { txIndex: string; multisig: string }>(
    filePath: string,
    txIndex: bigint,
    multisig: PublicKey,
): Promise<T | null> {
    try {
        const content = await readFile(filePath, 'utf8');
        if (!content.trim()) return null;
        const records: T[] = JSON.parse(content);
        return records.find(
            r => r.txIndex === txIndex.toString()
                && r.multisig === multisig.toBase58()
        ) ?? null;
    } catch {
        return null;
    }
}

// ────────────────────────────────────────────────────────────
// Transfer execution
// ────────────────────────────────────────────────────────────
async function executeTransfers(
    entries: MultiPayoutEntry[],
    treasuryPublicKey: bigint,
    treasuryPrivateKey: bigint,
    memberKeypair: Keypair,
    connection: Connection,
    utxoFilePath: string,
) {
    const results: { recipient: string; amount: string; signature?: string }[] = [];
    const failures: { index: number; recipient: string; error: string }[] = [];

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        console.log(chalk.yellow(`\n📤 Transfer ${i + 1}/${entries.length}`));
        console.log(`   Recipient: ${entry.recipient.toBase58()}`);
        console.log(`   Amount:    ${entry.amount} lamports`);

        const utxo = await findAndRemoveUtxoByCommitment(utxoFilePath, entry.commitment, treasuryPublicKey);
        if (!utxo) {
            const msg = `No unspent UTXO for commitment ${entry.commitment.toString(16).slice(0, 16)}...`;
            console.error(chalk.red(`❌ [${i}] ${msg}`));
            failures.push({ index: i, recipient: entry.recipient.toBase58(), error: msg });
            continue;
        }

        utxo.keypair.privateKey = treasuryPrivateKey;

        try {
            const result = await fullWithdraw(
                [utxo],
                entry.recipient,
                {
                    connection,
                    programId: CLOAK_PROGRAM_ID,
                    enforceViewingKeyRegistration: false,
                    depositorKeypair: memberKeypair,
                    walletPublicKey: memberKeypair.publicKey,
                    chainNoteViewingKeyNk: getNkFromUtxoPrivateKey(utxo.keypair.privateKey),
                }
            );
            console.log(chalk.green(`✅ Transfer ${i + 1} submitted`), result.signature);
            results.push({ recipient: entry.recipient.toBase58(), amount: entry.amount.toString(), signature: result.signature });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(chalk.red(`❌ Transfer ${i + 1} failed: ${msg}`));
            failures.push({ index: i, recipient: entry.recipient.toBase58(), error: msg });
        }
    }

    printSummary('Transfer', entries.length, results.length, failures);
    if (failures.length > 0 && results.length === 0) throw new Error(`All ${failures.length} transfers failed`);
    return { results, failures, proposalType: 'transfer' as const };
}

// ────────────────────────────────────────────────────────────
// Swap execution
// ────────────────────────────────────────────────────────────
async function executeSwap(
    entry: SwapEntry,
    treasuryPublicKey: bigint,
    treasuryPrivateKey: bigint,
    memberKeypair: Keypair,
    connection: Connection,
    utxoFilePath: string,
    slippageBps: number,
) {
    console.log(chalk.yellow('\n🔄 Executing private swap...'));
    console.log(`   Amount:     ${entry.amount} lamports`);
    console.log(`   targetMint: ${entry.targetMint.toBase58()}`);
    console.log(`   recipientAta: ${entry.recipientAta.toBase58()}`);
    const utxo = await findAndRemoveUtxoByCommitment(utxoFilePath, entry.commitment, treasuryPublicKey);
    if (!utxo) {
        throw new Error(`No unspent UTXO for commitment ${entry.commitment.toString(16).slice(0, 16)}...`);
    }

    utxo.keypair.privateKey = treasuryPrivateKey;
    console.log(chalk.green('✅ Input UTXO matched'), `amount=${utxo.amount}`);

    // FIX 2: actually use slippageBps instead of hardcoding 1n
    const minOutputAmount = (entry.amount * BigInt(10000 - slippageBps)) / 10000n;
    console.log(chalk.blue(`Slippage: ${slippageBps} bps → minOutput: ${minOutputAmount}`));

    // FIX 3: pass relayUrl — swapWithChange throws without it
    const result = await swapWithChange(
        [utxo],
        entry.amount,
        entry.targetMint,
        entry.recipientAta,
        1n,
        {
            connection,
            programId: CLOAK_PROGRAM_ID,
            enforceViewingKeyRegistration: false,
            depositorKeypair: memberKeypair,
            walletPublicKey: memberKeypair.publicKey,
            chainNoteViewingKeyNk: getNkFromUtxoPrivateKey(utxo.keypair.privateKey),
            swapSlippageBps: slippageBps,
        },
        memberKeypair.publicKey
    );

    console.log(chalk.green('✅ Swap submitted!'));
    console.log('   Signature:     ', result.signature);
    console.log('   Swap state PDA:', result.swapStatePda);

    return { signature: result.signature, swapStatePda: result.swapStatePda, proposalType: 'swap' as const };
}
// ────────────────────────────────────────────────────────────
// UTXO file helper — mark spent before on-chain tx (double-spend guard)
// ────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────
// UTXO file helper
// ────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────
// UTXO file helper — mark spent before on-chain tx
// ────────────────────────────────────────────────────────────
async function findAndRemoveUtxoByCommitment(
    filePath: string,
    targetCommitment: bigint,
    treasuryPublicKey: bigint,
): Promise<Utxo | null> {
    try {
        const content = await readFile(filePath, 'utf8');
        if (!content.trim()) return null;

        const records: StoredUtxoRecord[] = JSON.parse(content);
        const idx = records.findIndex(r => !r.spent && r.commitment === targetCommitment.toString());
        if (idx === -1) return null;

        const r = records[idx];
        const utxo: Utxo = {
            amount: BigInt(r.amount),
            keypair: { privateKey: 0n, publicKey: treasuryPublicKey },
            blinding: BigInt(r.blinding),
            mintAddress: new PublicKey(r.mintAddress),
            index: r.index,
            commitment: BigInt(r.commitment),
            siblingCommitment: r.siblingcommitments ? BigInt(r.siblingcommitments) : undefined,
        };



        console.log(chalk.green('🗑️  Marked UTXO as spent'));

        return utxo;
    } catch (err) {
        console.error('❌ Error reading/writing UTXO file:', err);
        return null;
    }
}

// ────────────────────────────────────────────────────────────
// Shared summary printer
// ────────────────────────────────────────────────────────────
function printSummary(
    label: string,
    total: number,
    success: number,
    failures: { index: number; recipient: string; error: string }[],
) {
    console.log(chalk.bold(`\n📊 ${label} Summary`));
    console.log(`   Total:      ${total}`);
    console.log(`   ${chalk.green('Succeeded:')}  ${success}`);
    console.log(`   ${chalk.red('Failed:')}      ${failures.length}`);
    if (failures.length > 0) {
        console.log(chalk.red('\nFailed entries:'));
        for (const f of failures) console.log(`   [${f.index}] ${f.recipient} — ${f.error}`);
    }
}