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
    creatorKeypairPath: string, // Path to creator keypair JSON
    multisigAddress: PublicKey,
    transferTarget: PublicKey,
    amountLamports: bigint,
) {
    // 1. Load Creator Signer
    const keypairBytes = new Uint8Array(
        JSON.parse(readFileSync(creatorKeypairPath, 'utf-8'))
    );
    const creator = await createKeyPairSignerFromBytes(keypairBytes);

    // 2. Initialize SVM (for local testing) or use connection
    const svm = new LiteSVM();;

    svm.addProgramFromFile(
        fromLegacyPublicKey(PROGRAM_ID),
        '/home/mubariz/Documents/SolDev/FortisX/program/target/deploy/program.so'
    );

    let currentTxIndex = 0n;
    let nextTxIndex = 1n;




    console.log(chalk.blue('Current Tx Index:'), currentTxIndex.toString());
    console.log(chalk.blue('Next Tx Index:'), nextTxIndex.toString());

    // 4. Derive PDAs using NEXT transaction index (as Rust does)
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

    // 5. Derive Vault PDA (for size calculation)
    const [, vaultBump] = PublicKey.findProgramAddressSync(
        [SEED_PREFIX, multisigAddress.toBytes(), SEED_VAULT],
        PROGRAM_ID
    );

    // 6. Build the inner Transfer Transaction Message
    const transferIx = SystemProgram.transfer({
        fromPubkey: vaultTransactionPda,
        toPubkey: transferTarget,
        lamports: Number(amountLamports),
    });

    const blockhash = svm.latestBlockhash();

    const transferMessage = new TransactionMessage({
        instructions: [transferIx],
        payerKey: vaultTransactionPda,
        recentBlockhash: blockhash,
    });

    // Convert to your custom multisig transaction message format
    const transactionMessageBytes = await transactionMessageToMultisigTransactionMessageBytes({
        message: transferMessage,
    });

    // 7. Build Instruction Data (matches Rust parsing exactly)
    const ephemeralSigners = 0; // u8
    const proposalType = 0; // u8 - define your enum for Transfer
    const votingDeadline = BigInt(Math.floor(Date.now() / 1000) + 86400); // i64 LE - 24 hours

    const dataBuffer = Buffer.alloc(1 + 1 + 1 + 8 + 4 + transactionMessageBytes.length);
    let offset = 0;
    dataBuffer.writeUInt8(1, offset); offset += 1; //discriminator
    dataBuffer.writeUInt8(ephemeralSigners, offset); offset += 1;
    dataBuffer.writeUInt8(proposalType, offset); offset += 1;
    dataBuffer.writeBigInt64LE(votingDeadline, offset); offset += 8;
    dataBuffer.writeUInt32LE(transactionMessageBytes.length, offset); offset += 4;
    dataBuffer.set(transactionMessageBytes, offset); // ✅ Works for Uint8Array

    // 8. Build the Instruction
    const ix = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: multisigAddress, isSigner: false, isWritable: true }, // multisig
            { pubkey: vaultTransactionPda, isSigner: false, isWritable: true }, // vault_transaction (new account)
            { pubkey: new PublicKey(creator.address), isSigner: true, isWritable: true }, // creator (rent payer)
            { pubkey: proposalPda, isSigner: false, isWritable: true }, // proposal (new account)
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system program
        ],
        data: dataBuffer,
    });

    // 9. Fund creator for rent/fees (if using SVM)
    if (svm) {
        await svm.airdrop(creator.address, lamports(10_000_000_000n)); // 10 SOL
    }

    // 10. Build and Sign Transaction (using @solana/kit style)
    const transaction = await pipe(
        createTransactionMessage({ version: 0 }),
        (tx) => setTransactionMessageFeePayerSigner(creator, tx),
        (tx) => svm.setTransactionMessageLifetimeUsingLatestBlockhash(tx),
        (tx) => appendTransactionMessageInstruction(fromLegacyTransactionInstruction(ix), tx),
        (tx) => signTransactionMessageWithSigners(tx),
    )
    // 11. Send Transaction
    const result = svm.sendTransaction(transaction)

    // 12. Handle Result
    if (result instanceof FailedTransactionMetadata) {
        console.error(chalk.red('❌ Transaction Failed!'))
        console.error('Error:', result.err())
        try {
            const meta = result.meta()
        } catch (e) {
            console.error('No execution metadata available.')
        }
    } else {
        console.log(chalk.green('✅ Success!'))
        console.log('Logs:', result.logs())
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