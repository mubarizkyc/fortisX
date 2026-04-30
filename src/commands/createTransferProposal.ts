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
import { CompiledKeys } from "./compiled-keys";
import { transactionMessageBeet } from "./types";
import { Buffer } from 'buffer';
import bs58 from 'bs58';
import { LiteSVM, FailedTransactionMetadata } from "litesvm";
// ⚠️ REPLACE WITH YOUR ACTUAL PROGRAM ID
const PROGRAM_ID = new PublicKey('CD6Pnc1gpUQ1XT1bzXEPs2QnqFMcQUHsiRKAV9iYXh36');

// Seeds must match your Rust code exactly
const SEED_PREFIX = Buffer.from('multisig');
const SEED_TRANSACTION = Buffer.from('transaction');
const SEED_PROPOSAL = Buffer.from('proposal');
import { readFileSync } from 'fs';
import {
    createKeyPairSignerFromBytes,
    TransactionSigner,
    pipe,
    createTransactionMessage,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
    appendTransactionMessageInstruction,
    lamports,
    none,
} from '@solana/kit';
import {
    fromLegacyPublicKey,
    fromLegacyTransactionInstruction,
} from '@solana/compat';
import chalk from 'chalk';

export const SEED_MULTISIG = Buffer.from('multisig');
export const SEED_VAULT = Buffer.from('vault');

// Account size constants (from Rust)
export const MULTISIG_HEADER_SIZE = 128; // Adjust if your header size differs
export const PROPOSAL_HEADER_SIZE = 59;

export function compileToWrappedMessageV0({
    payerKey,
    recentBlockhash,
    instructions,
    addressLookupTableAccounts,
}: {
    payerKey: PublicKey;
    recentBlockhash: string;
    instructions: TransactionInstruction[];
    addressLookupTableAccounts?: AddressLookupTableAccount[];
}) {
    const compiledKeys = CompiledKeys.compile(instructions, payerKey);

    const addressTableLookups = new Array<MessageAddressTableLookup>();
    const accountKeysFromLookups: AccountKeysFromLookups = {
        writable: [],
        readonly: [],
    };
    const lookupTableAccounts = addressLookupTableAccounts || [];
    for (const lookupTable of lookupTableAccounts) {
        const extractResult = compiledKeys.extractTableLookup(lookupTable);
        if (extractResult !== undefined) {
            const [addressTableLookup, { writable, readonly }] = extractResult;
            addressTableLookups.push(addressTableLookup);
            accountKeysFromLookups.writable.push(...writable);
            accountKeysFromLookups.readonly.push(...readonly);
        }
    }

    const [header, staticAccountKeys] = compiledKeys.getMessageComponents();
    const accountKeys = new MessageAccountKeys(
        staticAccountKeys,
        accountKeysFromLookups
    );
    const compiledInstructions = accountKeys.compileInstructions(instructions);
    return new MessageV0({
        header,
        staticAccountKeys,
        recentBlockhash,
        compiledInstructions,
        addressTableLookups,
    });
}
export function transactionMessageToMultisigTransactionMessageBytes({
    message,
    addressLookupTableAccounts,
}: {
    message: TransactionMessage;
    addressLookupTableAccounts?: AddressLookupTableAccount[];
}): Uint8Array {
    // // Make sure authority is marked as non-signer in all instructions,
    // // otherwise the message will be serialized in incorrect format.
    // message.instructions.forEach((instruction) => {
    //   instruction.keys.forEach((key) => {
    //     if (key.pubkey.equals(vaultPda)) {
    //       key.isSigner = false;
    //     }
    //   });
    // });

    // Use custom implementation of `message.compileToV0Message` that allows instruction programIds
    // to also be loaded from `addressLookupTableAccounts`.
    const compiledMessage = compileToWrappedMessageV0({
        payerKey: message.payerKey,
        recentBlockhash: message.recentBlockhash,
        instructions: message.instructions,
        addressLookupTableAccounts,
    });
    // const compiledMessage = message.compileToV0Message(
    //   addressLookupTableAccounts
    // );

    // We use custom serialization for `transaction_message` that ensures as small byte size as possible.
    const [transactionMessageBytes] = transactionMessageBeet.serialize({
        numSigners: compiledMessage.header.numRequiredSignatures,
        numWritableSigners:
            compiledMessage.header.numRequiredSignatures -
            compiledMessage.header.numReadonlySignedAccounts,
        numWritableNonSigners:
            compiledMessage.staticAccountKeys.length -
            compiledMessage.header.numRequiredSignatures -
            compiledMessage.header.numReadonlyUnsignedAccounts,
        accountKeys: compiledMessage.staticAccountKeys,
        instructions: compiledMessage.compiledInstructions.map((ix) => {
            return {
                programIdIndex: ix.programIdIndex,
                accountIndexes: ix.accountKeyIndexes,
                data: Array.from(ix.data),
            };
        }),
        addressTableLookups: compiledMessage.addressTableLookups,
    });

    return transactionMessageBytes;
}
export async function createTransferProposal(
    creatorKeypair: Keypair,
    multisigAddress: PublicKey,
    transferTarget: PublicKey,
    amountLamports: bigint,
) {
    const conn = new Connection("https://api.devnet.solana.com", "confirmed");

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

    const [vaultTransactionPda, vaultTxnBump] = PublicKey.findProgramAddressSync(
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

    const [, vaultBump] = PublicKey.findProgramAddressSync(
        [SEED_PREFIX, multisigAddress.toBytes(), SEED_VAULT],
        PROGRAM_ID
    );

    // 3. Build inner Transfer Transaction Message
    const transferIx = SystemProgram.transfer({
        fromPubkey: vaultTransactionPda,
        toPubkey: transferTarget,
        lamports: Number(amountLamports),
    });

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();

    const transferMessage = new TransactionMessage({
        instructions: [transferIx],
        payerKey: vaultTransactionPda,
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
            { pubkey: vaultTransactionPda, isSigner: false, isWritable: true },
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
        console.log(chalk.yellow('Sending transaction to Devnet...'));
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
        console.log('Vault PDA:', vaultTransactionPda.toBase58());
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



// Helper: Convert bigint to little-endian byte array
function bigIntToLittleEndianBytes(value: bigint, byteLength: number): Uint8Array {
    const bytes = new Uint8Array(byteLength);
    let remaining = value;
    for (let i = 0; i < byteLength; i++) {
        bytes[i] = Number(remaining & 0xFFn);
        remaining >>= 8n;
    }
    return bytes;
}

// Helper: Read u64 LE from bytes
class Uint64LE {
    constructor(private bytes: Uint8Array) {
        if (bytes.length !== 8) throw new Error('Uint64LE requires 8 bytes');
    }
    toBigInt(): bigint {
        let result = 0n;
        for (let i = 7; i >= 0; i--) {
            result = (result << 8n) | BigInt(this.bytes[i]);
        }
        return result;
    }
}