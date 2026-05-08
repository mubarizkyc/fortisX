// src/commands/createProposalFromTx.ts
import {
    SystemProgram,
    TransactionInstruction,
    Keypair,
    Connection,
} from '@solana/web3.js';
import {
    Message,
    MessageAccountKeys,
    MessageV0,
    PublicKey,
    Transaction,
    TransactionMessage,
    VersionedMessage,
    VersionedTransaction,
} from '@solana/web3.js';
import { Buffer } from 'buffer';
import bs58 from 'bs58';
import chalk from 'chalk';

// Import your existing utilities
import {
    SEED_PREFIX,
    SEED_TRANSACTION,
    SEED_PROPOSAL,
    SEED_VAULT,
    PROGRAM_ID,
    bigIntToLittleEndianBytes,
    transactionMessageToMultisigTransactionMessageBytes,
} from '../utils';

interface DeserializedTransaction {
    message: TransactionMessage;
    version: number | 'legacy';
    accountKeys: PublicKey[];
}

/**
 * Decodes a base58 encoded transaction and deserializes it into a TransactionMessage
 * @param tx - Base58 encoded transaction string
 * @returns Object containing the deserialized message, version, and account keys
 * @throws Error if deserialization fails
 */
export function decodeAndDeserialize(tx: string): DeserializedTransaction {
    if (!tx) {
        throw new Error('Transaction string is required');
    }

    try {
        const messageBytes = bs58.default.decode(tx);
        const version = VersionedMessage.deserializeMessageVersion(messageBytes);
        let message: TransactionMessage;
        let accountKeys: PublicKey[];

        if (version === 'legacy') {
            const legacyMessage = Message.from(messageBytes);
            accountKeys = legacyMessage.accountKeys;

            const intermediate = VersionedMessage.deserialize(new MessageV0(legacyMessage).serialize());
            message = TransactionMessage.decompile(intermediate, {
                addressLookupTableAccounts: [],
            });
        } else {
            const versionedMessage = VersionedMessage.deserialize(messageBytes);
            accountKeys = versionedMessage.staticAccountKeys;

            message = TransactionMessage.decompile(versionedMessage, {
                addressLookupTableAccounts: [],
            });
        }

        return {
            version,
            message,
            accountKeys,
        };
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(`Failed to decode transaction: ${error.message}`);
        }
        throw new Error('Failed to decode transaction: Unknown error');
    }
}
export const DISCRIMINATOR_CREATE_PROPOSAL = 1; // Adjust to match your Rust enum

export async function createProposalFromTx(
    creatorKeypair: Keypair,
    multisigAddress: PublicKey,
    encodedTransaction: string, // Base58-encoded transaction
    connection: Connection,
    options?: {
        votingDeadlineHours?: number; // Default: 2
    }
) {
    const {
        votingDeadlineHours = 24,
    } = options || {};

    // 1. Fetch multisig account to get current transaction_index
    const multisigInfo = await connection.getAccountInfo(multisigAddress);
    if (!multisigInfo) {
        throw new Error(`Multisig account not found: ${multisigAddress.toBase58()}`);
    }

    // Read transaction_index (u64 LE at offset 128) - adjust if your struct differs
    const txIndexOffset = 128;
    const currentTxIndex = multisigInfo.data.readBigUInt64LE(txIndexOffset);
    const nextTxIndex = currentTxIndex + 1n;

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

    // 3. Deserialize the user-provided transaction
    console.log(chalk.yellow('Deserializing user transaction...'));
    const { message: deserializedMessage, version, accountKeys } = decodeAndDeserialize(encodedTransaction);

    console.log(chalk.blue('Transaction Version:'), version);
    console.log(chalk.blue('Account Keys Count:'), accountKeys.length);
    console.log(chalk.blue('Instructions Count:'), deserializedMessage.instructions.length);
    const transactionMessage = new TransactionMessage(deserializedMessage);

    // 4. Convert to your custom multisig message format
    // Note: Ensure transactionMessageToMultisigTransactionMessageBytes handles both legacy and v0
    const transactionMessageBytes = await transactionMessageToMultisigTransactionMessageBytes({
        message: deserializedMessage,
    });

    // 5. Build Instruction Data (matches Rust parsing exactly)
    const votingDeadline = BigInt(Math.floor(Date.now() / 1000) + (votingDeadlineHours * 3600));

    // Header: [discriminator: u8][ephemeral: u8][type: u8][deadline: i64 LE][msgLen: u32 LE][msgBytes...]
    const dataBuffer = Buffer.alloc(1 + 1 + 1 + 8 + 4 + transactionMessageBytes.length);
    let offset = 0;

    dataBuffer.writeUInt8(DISCRIMINATOR_CREATE_PROPOSAL, offset); offset += 1;  // [0]
    dataBuffer.writeUInt8(ephemeralSigners, offset); offset += 1;                // [1]
    dataBuffer.writeUInt8(proposalType, offset); offset += 1;                    // [2]
    dataBuffer.writeBigInt64LE(votingDeadline, offset); offset += 8;             // [3-10]
    dataBuffer.writeUInt32LE(transactionMessageBytes.length, offset); offset += 4; // [11-14]
    dataBuffer.set(transactionMessageBytes, offset); // [15+]

    // 6. Build the Instruction
    const ix = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: multisigAddress, isSigner: false, isWritable: true }, // multisig
            { pubkey: transactionPda, isSigner: false, isWritable: true },  // vault_transaction (new account)
            { pubkey: creatorKeypair.publicKey, isSigner: true, isWritable: true }, // creator (rent payer)
            { pubkey: proposalPda, isSigner: false, isWritable: true },     // proposal (new account)
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system program
        ],
        data: dataBuffer,
    });

    // 7. Build & Sign Outer Transaction
    const { blockhash } = await connection.getLatestBlockhash();

    const msg = new TransactionMessage({
        payerKey: creatorKeypair.publicKey,
        recentBlockhash: blockhash,
        instructions: [ix],
    }).compileToV0Message();

    const tx = new VersionedTransaction(msg);
    tx.sign([creatorKeypair]);

    // 8. Send with error handling & confirmation
    try {
        console.log(chalk.yellow('Sending proposal creation transaction...'));
        const signature = await connection.sendTransaction(tx, {
            skipPreflight: false,
            maxRetries: 3,
            preflightCommitment: 'confirmed',
        });

        console.log(chalk.blue('Signature:'), signature);

        const confirmation = await connection.confirmTransaction(signature, 'confirmed');
        if (confirmation.value.err) {
            throw new Error(`Transaction failed: ${confirmation.value.err}`);
        }

        console.log(chalk.green('✅ Proposal Created & Confirmed!'));
        console.log('Transaction PDA:', transactionPda.toBase58());
        console.log('Proposal PDA:', proposalPda.toBase58());
        console.log('Tx Index:', nextTxIndex.toString());

        return {
            signature,
            transactionPda,
            proposalPda,
            transactionIndex: nextTxIndex,
            deserializedMessage,
        };

    } catch (error: any) {
        console.error(chalk.red('❌ Proposal Creation Failed:'), error.message);

        if (error.logs) {
            console.error('📜 Program Logs:');
            error.logs.forEach((log: string) => console.error('  ', log));
        }

        throw error;
    }
}