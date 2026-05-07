import {
    PublicKey,
    SystemProgram,
    TransactionInstruction,
    Connection,
    Keypair,
    TransactionMessage,
    VersionedTransaction,
} from '@solana/web3.js'
import chalk from 'chalk'
import {
    PROGRAM_ID,
    SEED_PREFIX,
    SEED_TRANSACTION,
    SEED_PROPOSAL,
    bigIntToLittleEndianBytes,
} from '../utils'
import { writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { blake3 } from '@noble/hashes/blake3';

// Domain separation constant — prevents hash collisions across different use cases
const PAYLOAD_HASH_DOMAIN = new TextEncoder().encode('fortisx-payload-hash-v1');

// ────────────────────────────────────────────────────────────
// Constants — must match Rust exactly
// ────────────────────────────────────────────────────────────
export const DISCRIMINATOR_CREATE_PRIVATE_PROPOSAL = 5
export const PROPOSAL_TYPE_PRIVATE = 1
export const PRIVATE_TRANSFER_SUBTYPE = 0

// Instruction layout (after router strips disc byte, Rust sees):
// [0..8)  voting_deadline (i64 LE)
// [8]     proposal_type   (u8)
// [9..41) payload_hash    (32 bytes)
//
// With discriminator included (what we send):
// [0]     disc            (u8)        = 5
// [1..9)  voting_deadline (i64 LE)
// [9]     proposal_type   (u8)        = 1
// [10..42) payload_hash   (32 bytes)
const IX_SIZE = 1 + 8 + 1 + 32 // 42 bytes, fixed always

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

// Lives only in your DB — never goes on-chain
export interface MultiPayoutEntry {
    commitment: bigint
    amount: bigint
    recipient: PublicKey
}

export interface PrivateTransferProposalAccounts {
    multisig: PublicKey
    creator: PublicKey
}

export interface PrivateTransferProposalArgs {
    currentTxIndex: bigint
    mint: PublicKey
    entries: MultiPayoutEntry[]
    salt: bigint
    votingDeadlineSeconds?: number
}
export interface ProposalDbRecord {
    txIndex: string;
    multisig: string;           // base58
    salt: string;               // bigint as string
    payloadHash: string;        // hex
    mint: string;               // base58
    entries: Array<{
        commitment: string;     // bigint as string
        amount: string;         // bigint as string
        recipient: string;      // base58
    }>;
    createdAt?: string;         // ISO timestamp (added automatically)
}

// ────────────────────────────────────────────────────────────
// Hash — preimage never touches the chain
//
// Blake3( JSON({ mint, salt, entries }) )
// Deterministic: bigints as strings, fields in fixed order.
// Members fetch payload from DB, recompute, compare to on-chain hash.
// ────────────────────────────────────────────────────────────
export function buildPayloadHash(
    mint: PublicKey,
    salt: bigint,
    entries: MultiPayoutEntry[],
): Buffer {
    // 1. Build deterministic JSON payload (same structure as Rust)
    const payload = {
        mint: mint.toBase58(),
        salt: salt.toString(),
        entries: entries.map(e => ({
            commitment: e.commitment.toString(),
            amount: e.amount.toString(),
            recipient: e.recipient.toBase58(),
        })),
    };

    // 2. Encode payload to UTF-8 bytes
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));

    // 3. Domain-separated preimage: [domain][payload_bytes]
    const preimage = new Uint8Array(PAYLOAD_HASH_DOMAIN.length + payloadBytes.length);
    preimage.set(PAYLOAD_HASH_DOMAIN, 0);
    preimage.set(payloadBytes, PAYLOAD_HASH_DOMAIN.length);

    // 4. Hash with BLAKE3 (returns Uint8Array, 32 bytes by default)
    const hashBytes = blake3(preimage);

    // 5. Return as Buffer for easy hex/logging usage
    return Buffer.from(hashBytes);
}

// Members call this before casting their vote
export function verifyPayloadHash(
    mint: PublicKey,
    salt: bigint,
    entries: MultiPayoutEntry[],
    onChainHash: Buffer,
): boolean {
    return buildPayloadHash(mint, salt, entries).equals(onChainHash)
}
export async function appendProposalRecord(
    record: ProposalDbRecord,
    filePath: string = './proposal_history.json'
): Promise<void> {
    // Add timestamp for auditability
    const recordWithTimestamp: ProposalDbRecord & { createdAt: string } = {
        ...record,
        createdAt: new Date().toISOString(),
    };

    let records: (ProposalDbRecord & { createdAt: string })[] = [];

    // Read existing file if it exists
    try {
        const content = await readFile(filePath, 'utf8');
        if (content.trim()) {
            records = JSON.parse(content);
            if (!Array.isArray(records)) {
                throw new Error('Existing file does not contain a JSON array');
            }
        }
    } catch (err: any) {
        if (err.code !== 'ENOENT') {
            // Re-throw if it's not a "file not found" error
            throw new Error(`Failed to read ${filePath}: ${err.message}`);
        }
        // File doesn't exist — start fresh
    }

    // Append new record
    records.push(recordWithTimestamp);

    // Write back with pretty-printing
    await writeFile(filePath, JSON.stringify(records, null, 2), 'utf8');
}

// ────────────────────────────────────────────────────────────
// Instruction builder — 42 bytes, fixed, no loops, no entries
// ────────────────────────────────────────────────────────────
export function buildPrivateTransferProposalIx(
    accounts: PrivateTransferProposalAccounts,
    args: PrivateTransferProposalArgs,
): {
    ix: TransactionInstruction
    transactionPda: PublicKey
    proposalPda: PublicKey
    nextTxIndex: bigint
    payloadHash: Buffer
} {
    if (args.entries.length === 0) throw new Error('At least one payout entry required')

    const nextTxIndex = args.currentTxIndex + 1n
    const nextTxIndexBytes = bigIntToLittleEndianBytes(nextTxIndex, 8)
    const deadlineSecs = BigInt(
        Math.floor(Date.now() / 1000) + (args.votingDeadlineSeconds ?? 86400)
    )

    // Derive PDAs
    const [transactionPda] = PublicKey.findProgramAddressSync(
        [SEED_PREFIX, accounts.multisig.toBytes(), SEED_TRANSACTION, nextTxIndexBytes],
        PROGRAM_ID
    )
    const [proposalPda] = PublicKey.findProgramAddressSync(
        [SEED_PREFIX, accounts.multisig.toBytes(), SEED_TRANSACTION, nextTxIndexBytes, SEED_PROPOSAL],
        PROGRAM_ID
    )

    // Compute hash — preimage stays in memory, never written to buf
    const payloadHash = buildPayloadHash(args.mint, args.salt, args.entries)

    // 42-byte fixed instruction buffer
    const buf = Buffer.alloc(IX_SIZE)
    let offset = 0

    // [0] discriminator
    buf.writeUInt8(DISCRIMINATOR_CREATE_PRIVATE_PROPOSAL, offset); offset += 1

    // [1..9) voting_deadline (i64 LE)
    buf.writeBigInt64LE(deadlineSecs, offset); offset += 8

    // [9] proposal_type
    buf.writeUInt8(PROPOSAL_TYPE_PRIVATE, offset); offset += 1

    // [10..42) payload_hash
    buf.set(payloadHash, offset); offset += 32

    if (offset !== IX_SIZE) {
        throw new Error(`BUG: IX size mismatch — wrote ${offset}, expected ${IX_SIZE}`)
    }

    const ix = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: accounts.multisig, isSigner: false, isWritable: true },
            { pubkey: transactionPda, isSigner: false, isWritable: true },
            { pubkey: accounts.creator, isSigner: true, isWritable: true },
            { pubkey: proposalPda, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: buf,
    })

    return { ix, transactionPda, proposalPda, nextTxIndex, payloadHash }
}

// ────────────────────────────────────────────────────────────
// Main command
// ────────────────────────────────────────────────────────────
export async function createPrivateTransferProposal(
    entries: MultiPayoutEntry[],
    mint: PublicKey,
    creatorKeypair: Keypair,
    multisigAddress: PublicKey,
    options?: {
        votingDeadlineSeconds?: number
    }
) {
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed')

    // Generate salt if not provided — caller MUST persist this in DB
    // Lost salt = members cannot verify the hash = proposal is unvotable


    // Read current tx index from multisig account
    // tx_index is u64 LE at offset 128 in your Multisig header
    const multisigInfo = await connection.getAccountInfo(multisigAddress)
    if (!multisigInfo) throw new Error(`Multisig not found: ${multisigAddress.toBase58()}`)
    const currentTxIndex = multisigInfo.data.readBigUInt64LE(128)
    const salt = currentTxIndex;
    console.log(chalk.blue('Current tx index:'), currentTxIndex.toString())

    // Build instruction
    const { ix, transactionPda, proposalPda, nextTxIndex, payloadHash } =
        buildPrivateTransferProposalIx(
            { multisig: multisigAddress, creator: creatorKeypair.publicKey },
            { currentTxIndex, entries, mint, salt, votingDeadlineSeconds: options?.votingDeadlineSeconds }
        )

    // Build + sign + send
    const { blockhash } = await connection.getLatestBlockhash()
    const msg = new TransactionMessage({
        payerKey: creatorKeypair.publicKey,
        recentBlockhash: blockhash,
        instructions: [ix],
    }).compileToV0Message()

    const tx = new VersionedTransaction(msg)
    tx.sign([creatorKeypair])

    console.log(chalk.yellow('Sending private proposal to devnet...'))
    const signature = await connection.sendTransaction(tx, {
        skipPreflight: false,
        maxRetries: 3,
        preflightCommitment: 'confirmed',
    })

    const confirmation = await connection.confirmTransaction(signature, 'confirmed')
    if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`)
    }

    // What you must write to your DB right now, before returning
    const dbRecord = {
        txIndex: nextTxIndex.toString(),
        multisig: multisigAddress.toBase58(),
        salt: salt.toString(),
        payloadHash: payloadHash.toString('hex'),
        mint: mint.toBase58(),
        entries: entries.map(e => ({
            commitment: e.commitment.toString(),
            amount: e.amount.toString(),
            recipient: e.recipient.toBase58(),
        })),
    }
    try {
        await appendProposalRecord(dbRecord);
        console.log(chalk.green('📝 Proposal record saved to proposal_history.json'));
    } catch (err) {
        console.error(chalk.red('⚠️  Failed to save proposal record:'), err);
        // Non-fatal — don't block the main flow
    }
    console.log(chalk.green('✅ Private proposal created!'))
    console.log('Signature:      ', signature)
    console.log('Transaction PDA:', transactionPda.toBase58())
    console.log('Proposal PDA:   ', proposalPda.toBase58())
    console.log('Tx Index:       ', nextTxIndex.toString())
    console.log('Payload hash:   ', payloadHash.toString('hex'))
    console.log(chalk.yellow('\n⚠️  Persist to DB before returning:'))
    console.log(JSON.stringify(dbRecord, null, 2))

    return {
        signature,
        transactionPda,
        proposalPda,
        nextTxIndex,
        payloadHash,
        salt,       // persist this — without it members cannot verify
        dbRecord,   // ready to insert into your proposals table
    }
}