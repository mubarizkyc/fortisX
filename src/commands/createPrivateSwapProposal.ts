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
import { blake3 } from '@noble/hashes/blake3';
import { DISCRIMINATOR_CREATE_PRIVATE_PROPOSAL } from './createPrivateTransferProposal.ts';

// Domain separation constant — prevents hash collisions across different use cases
const PAYLOAD_HASH_DOMAIN = new TextEncoder().encode('fortisx-payload-hash-v1');
export const PROPOSAL_SWAP_PROPOSAL = 2

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

// Single swap entry — lives only in your DB, never goes on-chain
export interface SwapEntry {
    commitment: bigint        // UTXO commitment to spend (shielded input)
    mint: PublicKey,
    amount: bigint            // Amount to swap (in input token units)
    recipientAta: PublicKey   // Recipient's ATA for OUTPUT token
    targetMint: PublicKey     // Mint of the token being swapped TO (e.g., USDC)
}

export interface PrivateSwapProposalAccounts {
    multisig: PublicKey
    creator: PublicKey
}

export interface PrivateSwapProposalArgs {
    currentTxIndex: bigint
    entry: SwapEntry          // Single entry (no array)
    salt: bigint
    votingDeadlineSeconds?: number
}

// DB record — for audit/history, never on-chain
export interface SwapProposalDbRecord {
    txIndex: string;
    multisig: string;           // base58
    salt: string;               // bigint as string
    payloadHash: string;        // hex
    entry: {
        commitment: string;     // bigint as string
        mint: String,
        amount: string;         // bigint as string
        recipientAta: string;   // base58
        targetMint: string;     // base58
    };
    createdAt?: string;         // ISO timestamp (added automatically)
}

// ────────────────────────────────────────────────────────────
// Hash — preimage never touches the chain
//
// Blake3( JSON({ entry: { commitment, amount, recipientAta, targetMint }, salt }) )
// Deterministic: bigints as strings, fields in fixed order.
// Members fetch payload from DB, recompute, compare to on-chain hash.
// ────────────────────────────────────────────────────────────
export function buildPayloadHash(
    entry: SwapEntry,
    salt: bigint,
): Buffer {
    // 1. Build deterministic JSON payload (same structure as Rust)
    const payload = {
        entry: {
            commitment: entry.commitment.toString(),
            mint: entry.mint.toString(),
            amount: entry.amount.toString(),
            recipientAta: entry.recipientAta.toBase58(),
            targetMint: entry.targetMint.toBase58(),
        },
        salt: salt.toString(),
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
    entry: SwapEntry,
    salt: bigint,
    onChainHash: Buffer,
): boolean {
    return buildPayloadHash(entry, salt).equals(onChainHash)
}

export async function appendSwapProposalRecord(
    record: SwapProposalDbRecord,
    filePath: string = './swap_proposal_history.json'
): Promise<void> {
    // Add timestamp for auditability
    const recordWithTimestamp: SwapProposalDbRecord & { createdAt: string } = {
        ...record,
        createdAt: new Date().toISOString(),
    };

    let records: (SwapProposalDbRecord & { createdAt: string })[] = [];

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
// Instruction builder — 42 bytes, fixed, no loops, no entries array
// ────────────────────────────────────────────────────────────
export function buildPrivateSwapProposalIx(
    accounts: PrivateSwapProposalAccounts,
    args: PrivateSwapProposalArgs,
): {
    ix: TransactionInstruction
    transactionPda: PublicKey
    proposalPda: PublicKey
    nextTxIndex: bigint
    payloadHash: Buffer
} {
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
    const payloadHash = buildPayloadHash(args.entry, args.salt)

    // 42-byte fixed instruction buffer
    const buf = Buffer.alloc(IX_SIZE)
    let offset = 0

    // [0] discriminator
    buf.writeUInt8(DISCRIMINATOR_CREATE_PRIVATE_PROPOSAL, offset); offset += 1

    // [1..9) voting_deadline (i64 LE)
    buf.writeBigInt64LE(deadlineSecs, offset); offset += 8

    // [9] proposal_type (private)
    buf.writeUInt8(PROPOSAL_SWAP_PROPOSAL, offset); offset += 1

    // [10..42) payload_hash (32 bytes)
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
// Main command: createPrivateSwapProposal
// ────────────────────────────────────────────────────────────
export async function createPrivateSwapProposal(
    entry: SwapEntry,
    creatorKeypair: Keypair,
    multisigAddress: PublicKey,
    connection: Connection,
    options?: {
        votingDeadlineSeconds?: number
    }
) {

    // Read current tx index from multisig account
    const multisigInfo = await connection.getAccountInfo(multisigAddress)
    if (!multisigInfo) throw new Error(`Multisig not found: ${multisigAddress.toBase58()}`)

    // tx_index is u64 LE at offset 128 in your Multisig header
    const currentTxIndex = multisigInfo.data.readBigUInt64LE(128)

    // Use txIndex as salt (deterministic, unique per proposal)
    const salt = currentTxIndex;
    console.log(chalk.blue('Current tx index (used as salt):'), currentTxIndex.toString())

    // Build instruction
    const { ix, transactionPda, proposalPda, nextTxIndex, payloadHash } =
        buildPrivateSwapProposalIx(
            { multisig: multisigAddress, creator: creatorKeypair.publicKey },
            {
                currentTxIndex,
                entry,
                salt,
                votingDeadlineSeconds: options?.votingDeadlineSeconds
            }
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

    console.log(chalk.yellow('Sending private swap proposal to devnet...'))
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
    const dbRecord: SwapProposalDbRecord = {
        txIndex: nextTxIndex.toString(),
        multisig: multisigAddress.toBase58(),
        salt: salt.toString(),
        payloadHash: payloadHash.toString('hex'),
        entry: {
            commitment: entry.commitment.toString(),
            mint: entry.mint.toString(),
            amount: entry.amount.toString(),
            recipientAta: entry.recipientAta.toBase58(),
            targetMint: entry.targetMint.toBase58(),
        },
    }

    try {
        await appendSwapProposalRecord(dbRecord);
        console.log(chalk.green('📝 Swap proposal record saved to swap_proposal_history.json'));
    } catch (err) {
        console.error(chalk.red('⚠️  Failed to save swap proposal record:'), err);
        // Non-fatal — don't block the main flow
    }

    console.log(chalk.green('✅ Private swap proposal created!'))
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