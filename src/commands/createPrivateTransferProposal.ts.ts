import {
    PublicKey,
    SystemProgram,
    TransactionInstruction,
} from '@solana/web3.js'
import { PROGRAM_ID, SEED_PREFIX, SEED_MULTISIG, SEED_TRANSACTION, SEED_PROPOSAL } from '../utils'

export const DISCRIMINATOR_CREATE_PRIVATE_PROPOSAL = 5

function bigintToLeBytes(value: bigint, length: number): Uint8Array {
    const bytes = new Uint8Array(length)
    let remaining = value
    for (let i = 0; i < length; i++) {
        bytes[i] = Number(remaining & 0xffn)
        remaining >>= 8n
    }
    return bytes
}

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

export function buildPrivateTransferProposalIx(
    accounts: PrivateTransferProposalAccounts,
    args: PrivateTransferProposalArgs,
): {
    ix: TransactionInstruction
    transactionPda: PublicKey
    proposalPda: PublicKey
    nextTxIndex: bigint
} {
    const nextTxIndex = args.currentTxIndex + 1n
    const nextTxIndexBytes = bigintToLeBytes(nextTxIndex, 8)
    const deadlineSecs = BigInt(
        Math.floor(Date.now() / 1000) + (args.votingDeadlineSeconds ?? 86400)
    )

    // derive PDAs
    const [transactionPda] = PublicKey.findProgramAddressSync(
        [SEED_PREFIX, accounts.multisig.toBytes(), SEED_TRANSACTION, nextTxIndexBytes],
        PROGRAM_ID
    )
    const [proposalPda] = PublicKey.findProgramAddressSync(
        [SEED_PREFIX, accounts.multisig.toBytes(), SEED_TRANSACTION, nextTxIndexBytes, SEED_PROPOSAL],
        PROGRAM_ID
    )

    // layout:
    // [0]      discriminator (u8)        = 5
    // [1..9)   voting_deadline (i64 LE)
    // [9]      private_proposal_subtype  = 0 (PRIVATE_TRANSFER)
    // [10..42) utxo_commitment (32 bytes LE)
    // [42..50) amount (u64 LE)
    // [50..82) recipient pubkey (32 bytes)
    const buf = Buffer.alloc(82)
    let offset = 0

    buf.writeUInt8(DISCRIMINATOR_CREATE_PRIVATE_PROPOSAL, offset); offset += 1
    buf.writeBigInt64LE(deadlineSecs, offset); offset += 8
    buf.writeUInt8(0, offset); offset += 1  // PRIVATE_TRANSFER
    buf.set(bigintToLeBytes(args.commitment, 32), offset); offset += 32
    buf.writeBigUInt64LE(args.amountLamports, offset); offset += 8
    buf.set(args.recipient.toBytes(), offset)                       // 32 bytes

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

    return { ix, transactionPda, proposalPda, nextTxIndex }
}
import {
    Connection,
    Keypair,
    TransactionMessage,
    VersionedTransaction,
} from '@solana/web3.js'
import chalk from 'chalk'

export async function createPrivateTransferProposal(
    commitment: bigint,
    creatorKeypair: Keypair,
    multisigAddress: PublicKey,
    recipient: PublicKey,
    amountLamports: bigint,
    connection: Connection,
) {
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