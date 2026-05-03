import {
    PublicKey,
    SystemProgram,
    TransactionInstruction,
} from '@solana/web3.js'
import { PROGRAM_ID, SEED_PREFIX, SEED_MULTISIG, SEED_TRANSACTION, SEED_PROPOSAL, bigIntToLittleEndianBytes } from '../utils'

export const DISCRIMINATOR_CREATE_PRIVATE_PROPOSAL = 5

export interface PrivateTransferProposalAccounts {
    multisig: PublicKey
    creator: PublicKey
}

export interface PrivateTransferProposalArgs {
    commitment: bigint       // UTXO commitment (32 bytes as bigint)
    amountLamports: bigint   // amount to transfer
    recipient: PublicKey     // final recipient
    votingDeadlineSeconds?: number // seconds from now, default 86400
    currentTxIndex: bigint   // read from multisig account before calling
}

import {
    Connection,
    Keypair,
    TransactionMessage,
    VersionedTransaction,
} from '@solana/web3.js'
import chalk from 'chalk'

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────
export interface PrivateTransferProposalAccounts {
    multisig: PublicKey;
    creator: PublicKey;
}

export interface PrivateTransferProposalArgs {
    currentTxIndex: bigint;
    commitment: bigint;              // UTXO commitment to spend
    amountLamports: bigint;          // Amount to transfer
    recipient: PublicKey;            // Recipient public key
    votingDeadlineSeconds?: number;  // Optional: seconds from now (default: 86400)
}

// ────────────────────────────────────────────────────────────
// Constants (MUST match Rust)
// ────────────────────────────────────────────────────────────
// Instruction data layout for process_create_private_proposal:
// [0..8)   voting_deadline (i64 LE)
// [8]      private_proposal_subtype (u8) - 0 = PRIVATE_TRANSFER
// [9..41)  utxo_commitment (32 bytes)
// [41..49) amount (u64 LE)
// [49..81) recipient_public_key (32 bytes)
// TOTAL: 81 bytes
export const PRIVATE_TRANSFER_IX_DATA_SIZE = 8 + 1 + 32 + 8 + 32; // 81 bytes
export const PRIVATE_TRANSFER_SUBTYPE = 0;

// ────────────────────────────────────────────────────────────
// Main Function
// ────────────────────────────────────────────────────────────
export function buildPrivateTransferProposalIx(
    accounts: PrivateTransferProposalAccounts,
    args: PrivateTransferProposalArgs,
): {
    ix: TransactionInstruction;
    transactionPda: PublicKey;
    proposalPda: PublicKey;
    nextTxIndex: bigint;
} {
    const nextTxIndex = args.currentTxIndex + 1n;
    const nextTxIndexBytes = bigIntToLittleEndianBytes(nextTxIndex, 8);
    const deadlineSecs = BigInt(
        Math.floor(Date.now() / 1000) + (args.votingDeadlineSeconds ?? 86400)
    );

    // Derive PDAs
    const [transactionPda] = PublicKey.findProgramAddressSync(
        [SEED_PREFIX, accounts.multisig.toBytes(), SEED_TRANSACTION, nextTxIndexBytes],
        PROGRAM_ID
    );
    const [proposalPda] = PublicKey.findProgramAddressSync(
        [
            SEED_PREFIX,
            accounts.multisig.toBytes(),
            SEED_TRANSACTION,
            nextTxIndexBytes,
            SEED_PROPOSAL,
        ],
        PROGRAM_ID
    );

    // ────────────────────────────────────────────────────────
    // Build Instruction Data (81 bytes, NO discriminator)
    // Layout: [deadline:8][subtype:1][commitment:32][amount:8][recipient:32]
    // ────────────────────────────────────────────────────────
    const buf = Buffer.alloc(PRIVATE_TRANSFER_IX_DATA_SIZE + 1);
    let offset = 0;
    // disc
    buf.writeUInt8(5, offset);
    offset += 1;
    // [0..8) voting_deadline (i64 LE)
    buf.writeBigInt64LE(deadlineSecs, offset);
    offset += 8;

    // [8] private_proposal_subtype (u8) = 0 for PRIVATE_TRANSFER
    buf.writeUInt8(PRIVATE_TRANSFER_SUBTYPE, offset);
    offset += 1;

    // [9..41) utxo_commitment (32 bytes LE)
    buf.set(bigIntToLittleEndianBytes(args.commitment, 32), offset);
    offset += 32;

    // [41..49) amount (u64 LE)
    buf.writeBigUInt64LE(args.amountLamports, offset);
    offset += 8;

    // [49..81) recipient_public_key (32 bytes)
    buf.set(args.recipient.toBytes(), offset);
    // offset += 32; // not needed after last field

    // Debug log (remove in production)
    // console.log('Instruction data (hex):', buf.toString('hex'));
    // console.log('Expected size: 81, Actual:', buf.length);

    // Build Instruction
    console.log('=== DEBUG: Commitment Serialization ===');
    console.log('Original commitment (bigint):', args.commitment.toString());
    console.log('Commitment bytes (hex):', buf.subarray(9, 41).toString('hex'));
    console.log('First 8 bytes of commitment:', buf.subarray(9, 17).toString('hex'));
    const ix = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: accounts.multisig, isSigner: false, isWritable: true },
            { pubkey: transactionPda, isSigner: false, isWritable: true },
            { pubkey: accounts.creator, isSigner: true, isWritable: true }, // rent payer + signer
            { pubkey: proposalPda, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: buf,
    });

    return { ix, transactionPda, proposalPda, nextTxIndex };
}
export async function createPrivateTransferProposal(
    commitment: bigint,
    creatorKeypair: Keypair,
    multisigAddress: PublicKey,
    recipient: PublicKey,
    amountLamports: bigint,
) {
    const connection = new Connection("https://api.devnet.solana.com")
    // 1. read current tx index from multisig account
    const multisigInfo = await connection.getAccountInfo(multisigAddress)
    if (!multisigInfo) throw new Error(`Multisig not found: ${multisigAddress.toBase58()}`)

    // tx_index is u64 LE at offset 128 in your Multisig header
    const currentTxIndex = multisigInfo.data.readBigUInt64LE(128)
    console.log(chalk.blue('Current tx index:'), currentTxIndex.toString())

    // 2. build instruction
    const { ix, transactionPda, proposalPda, nextTxIndex } = buildPrivateTransferProposalIx(
        { multisig: multisigAddress, creator: creatorKeypair.publicKey },
        { commitment, amountLamports, recipient, currentTxIndex }
    )

    // 3. build + sign + send
    const { blockhash } = await connection.getLatestBlockhash()
    const msg = new TransactionMessage({
        payerKey: creatorKeypair.publicKey,
        recentBlockhash: blockhash,
        instructions: [ix],
    }).compileToV0Message()

    const tx = new VersionedTransaction(msg)
    tx.sign([creatorKeypair])

    console.log(chalk.yellow('Sending to devnet...'))
    const signature = await connection.sendTransaction(tx, {
        skipPreflight: false,
        maxRetries: 3,
        preflightCommitment: 'confirmed',
    })

    const confirmation = await connection.confirmTransaction(signature, 'confirmed')
    if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`)
    }

    console.log(chalk.green('✅ Private proposal created!'))
    console.log('Signature:      ', signature)
    console.log('Multisig:       ', multisigAddress.toBase58())
    console.log('Transaction PDA:', transactionPda.toBase58())
    console.log('Proposal PDA:   ', proposalPda.toBase58())
    console.log('Tx Index:       ', nextTxIndex.toString())

    return { signature, transactionPda, proposalPda, nextTxIndex }
}