import {
    PublicKey,
    SystemProgram,
    TransactionInstruction,
    Keypair,
    Connection,
    LAMPORTS_PER_SOL,
    TransactionMessage, AddressLookupTableAccount,
    AccountKeysFromLookups,
    MessageAccountKeys,
    MessageAddressTableLookup,
    MessageV0,
    MessageCompiledInstruction,
    VersionedTransaction
} from '@solana/web3.js';
import { SEED_MULTISIG, SEED_PREFIX, TREASURY, transactionMessageToMultisigTransactionMessageBytes, SEED_VAULT, SEED_TRANSACTION, SEED_PROPOSAL, PROGRAM_ID, DISCRIMINATOR_APPROVE_PROPOSAL, PROPOSAL_HEADER_SIZE, bigIntToLittleEndianBytes } from '../utils';
import { Buffer } from 'buffer';
import bs58 from 'bs58';
import { readFileSync } from 'fs';
import chalk from 'chalk';
export async function createTransferProposal(
    creatorKeypair: Keypair,
    multisigAddress: PublicKey,
    transferTarget: PublicKey,
    amountLamports: bigint,
    conn: Connection
) {

    // 1. Fetch multisig account to get current transaction_index
    const multisigInfo = await conn.getAccountInfo(multisigAddress);
    if (!multisigInfo) {
        throw new Error('Multisig account not found');
    }

    // Read transaction_index (u64 LE at offset 128)
    let currentTxIndex = multisigInfo.data.readBigUInt64LE(128);
    let nextTxIndex = currentTxIndex + 1n;

    console.log(chalk.blue('Current Tx Index:'), currentTxIndex.toString());
    console.log(chalk.blue('Next Tx Index:'), nextTxIndex.toString());

    // 2. Derive PDAs using NEXT transaction index
    const nextTxIndexBytes = bigIntToLittleEndianBytes(nextTxIndex, 8);

    const [transactionPda, vaultTxnBump] = PublicKey.findProgramAddressSync(
        [
            SEED_PREFIX,
            multisigAddress.toBytes(),
            SEED_TRANSACTION,
            nextTxIndexBytes,
        ],
        PROGRAM_ID
    );

    const [proposalPda, proposalBump] = PublicKey.findProgramAddressSync(
        [
            SEED_PREFIX,
            multisigAddress.toBytes(),
            SEED_TRANSACTION,
            nextTxIndexBytes,
            SEED_PROPOSAL,
        ],
        PROGRAM_ID
    );

    const [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
        [SEED_PREFIX, multisigAddress.toBytes(), SEED_VAULT],
        PROGRAM_ID
    );

    // 3. Build inner Transfer Transaction Message
    const transferIx = SystemProgram.transfer({
        fromPubkey: vaultPda,
        toPubkey: transferTarget,
        lamports: Number(amountLamports),
    });

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();

    const transferMessage = new TransactionMessage({
        instructions: [transferIx],
        payerKey: creatorKeypair.publicKey,
        recentBlockhash: blockhash,
    });

    const transactionMessageBytes = transactionMessageToMultisigTransactionMessageBytes({
        message: transferMessage,
    });

    // 4. Build Instruction Data (MATCHES RUST EXACTLY)
    const ephemeralSigners = 0; // u8
    const proposalType = 0; // u8 - define your enum for Transfer
    const votingDeadline = BigInt(Math.floor(Date.now() / 1000) + 86400); // i64 LE

    // Header size: 1 (ephemeral) + 1 (type) + 8 (deadline) + 4 (len) = 14 bytes
    const dataBuffer = Buffer.alloc(1 + 1 + 1 + 8 + 4 + transactionMessageBytes.length);
    let offset = 0;


    dataBuffer.writeUInt8(1, offset); offset += 1;  // [0]
    dataBuffer.writeUInt8(ephemeralSigners, offset); offset += 1;  // [0]
    dataBuffer.writeUInt8(proposalType, offset); offset += 1;      // [1]
    dataBuffer.writeBigInt64LE(votingDeadline, offset); offset += 8; // [2-9]
    dataBuffer.writeUInt32LE(transactionMessageBytes.length, offset); offset += 4; // [10-13]
    dataBuffer.set(transactionMessageBytes, offset); // [14+]

    // 5. Build the Instruction
    const ix = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: multisigAddress, isSigner: false, isWritable: true },
            { pubkey: transactionPda, isSigner: false, isWritable: true },
            { pubkey: creatorKeypair.publicKey, isSigner: true, isWritable: true },
            { pubkey: proposalPda, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: dataBuffer,
    });
    console.log(creatorKeypair.publicKey);
    // 6. Build & Sign Transaction
    const msg = new TransactionMessage({
        payerKey: creatorKeypair.publicKey,
        recentBlockhash: blockhash,
        instructions: [ix],
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    tx.sign([creatorKeypair]);

    // 7. Send with error handling & confirmation
    try {
        console.log(chalk.yellow('Sending transaction...'));
        const signature = await conn.sendTransaction(tx, {
            skipPreflight: false, // ✅ Set to false to catch errors early
            maxRetries: 3,
            preflightCommitment: 'confirmed',
        });

        console.log(chalk.blue('Signature:'), signature);

        // Wait for confirmation
        const confirmation = await conn.confirmTransaction(signature, 'confirmed');
        if (confirmation.value.err) {
            throw new Error(`Transaction failed: ${confirmation.value.err}`);
        }


        console.log(chalk.green('✅ Proposal Created & Confirmed!'));
        console.log('Vault PDA:', vaultPda.toBase58());
        console.log('Proposal PDA:', proposalPda.toBase58());
        console.log('Tx Index:', nextTxIndex.toString());



    } catch (error: any) {
        console.error(chalk.red('❌ Transaction Failed:'), error.message);

        // Try to get logs if available
        if (error.logs) {
            console.error('Program Logs:');
            error.logs.forEach((log: string) => console.error('  ', log));
        }

        throw error;
    }
}