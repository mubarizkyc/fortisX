import { u8, u32, u64, bignum } from "@metaplex-foundation/beet";
import { Buffer } from "buffer";
import {
    AccountMeta,
    Connection,
    TransactionMessage,
    VersionedTransaction,
    MessageHeader,
    AccountKeysFromLookups,
    AddressLookupTableAccount,
    TransactionInstruction,
    PublicKey,
    MessageV0, MessageAccountKeys
} from "@solana/web3.js";
import { VaultTransactionMessage, MessageAddressTableLookup, transactionMessageBeet } from "./types";
import assert from "assert";
import invariant from "invariant";
export const TREASURY = new PublicKey('5wBH8hqU4PxVCFXmu3JR6Kegdy2Vq8K7fZnRgN5ZJEr2')
export const PROGRAM_ID = new PublicKey('CD6Pnc1gpUQ1XT1bzXEPs2QnqFMcQUHsiRKAV9iYXh36');
// Seeds must match your Rust code exactly
export const SEED_PREFIX = Buffer.from('multisig');
export const SEED_TRANSACTION = Buffer.from('transaction');
export const SEED_PROPOSAL = Buffer.from('proposal');
export const SEED_MULTISIG = Buffer.from('multisig');
export const SEED_VAULT = Buffer.from("vault");

// Account size constants (from Rust)
export const MULTISIG_HEADER_SIZE = 128; // Adjust if your header size differs
export const PROPOSAL_HEADER_SIZE = 59;
export const DISCRIMINATOR_EXECUTE_PROPOSAL = 3; // Adjust to match your Rust enum
// Instruction discriminators (define your enum values)
export const DISCRIMINATOR_APPROVE_PROPOSAL = 2; // Adjust to match your Rust enum
const SEED_EPHEMERAL_SIGNER = toUtfBytes("ephemeral_signer");
// Helper: Convert bigint to little-endian byte array
export function bigIntToLittleEndianBytes(value: bigint, byteLength: number): Uint8Array {
    const bytes = new Uint8Array(byteLength);
    let remaining = value;
    for (let i = 0; i < byteLength; i++) {
        bytes[i] = Number(remaining & 0xFFn);
        remaining >>= 8n;
    }
    return bytes;
}
function getEphemeralSignerPda({
    transactionPda,
    ephemeralSignerIndex,
}: {
    transactionPda: PublicKey;
    ephemeralSignerIndex: number;
    programId?: PublicKey;
}): [PublicKey, number] {
    const buf = new Uint8Array([ephemeralSignerIndex]); // ✅ works

    return PublicKey.findProgramAddressSync(
        [
            SEED_PREFIX,
            transactionPda.toBytes(),
            SEED_EPHEMERAL_SIGNER,
            buf,
        ],
        PROGRAM_ID
    );
}
/*
export type VaultTransactionMessage = {
    numSigners: number
    numWritableSigners: number
    numWritableNonSigners: number
    accountKeys: PublicKey[]
    instructions: CompiledInstruction[]
    addressTableLookups: MessageAddressTableLookup[]
}
export type CompiledInstruction = {
    programIdIndex: number;
    accountIndexes: Uint8Array;
    data: Uint8Array;
};
export type MessageAddressTableLookup = {
    accountKey: PublicKey;
    writableIndexes: Uint8Array;
    readonlyIndexes: Uint8Array;
};
*/
export function toUtfBytes(str: string): Uint8Array {
    return new TextEncoder().encode(str);
}

export function toU8Bytes(num: number): Uint8Array {
    const bytes = Buffer.alloc(1);
    u8.write(bytes, 0, num);
    return bytes;
}

export function toU32Bytes(num: number): Uint8Array {
    const bytes = Buffer.alloc(4);
    u32.write(bytes, 0, num);
    return bytes;
}

export function toU64Bytes(num: bigint): Uint8Array {
    const bytes = Buffer.alloc(8);
    u64.write(bytes, 0, num);
    return bytes;
}

export function toBigInt(number: bignum): bigint {
    return BigInt(number.toString());
}

const MAX_TX_SIZE_BYTES = 1232;
const STRING_LEN_SIZE = 4;
export function getAvailableMemoSize(
    txWithoutMemo: VersionedTransaction
): number {
    const txSize = txWithoutMemo.serialize().length;
    return (
        MAX_TX_SIZE_BYTES -
        txSize -
        STRING_LEN_SIZE -
        // Sometimes long memo can trigger switching from 1 to 2 bytes length encoding in Compact-u16,
        // so we reserve 1 extra byte to make sure.
        1
    );
}

export function isStaticWritableIndex(
    message: VaultTransactionMessage,
    index: number
) {
    const numAccountKeys = message.accountKeys.length;
    const { numSigners, numWritableSigners, numWritableNonSigners } = message;

    if (index >= numAccountKeys) {
        // `index` is not a part of static `accountKeys`.
        return false;
    }

    if (index < numWritableSigners) {
        // `index` is within the range of writable signer keys.
        return true;
    }

    if (index >= numSigners) {
        // `index` is within the range of non-signer keys.
        const indexIntoNonSigners = index - numSigners;
        // Whether `index` is within the range of writable non-signer keys.
        return indexIntoNonSigners < numWritableNonSigners;
    }

    return false;
}

export function isSignerIndex(message: VaultTransactionMessage, index: number) {
    return index < message.numSigners;
}
/** Populate remaining accounts required for execution of the transaction. */
export async function accountsForTransactionExecute({
    connection,
    transactionPda,
    vaultPda,
    messageBytes,
    ephemeralSignerBumps,
    programId,
    addressLookupTableAccounts: localAddressLookupTableAccounts,
}: {
    connection: Connection;
    messageBytes: Buffer<ArrayBuffer>;
    ephemeralSignerBumps: number[];
    vaultPda: PublicKey;
    transactionPda: PublicKey;
    programId?: PublicKey;
    addressLookupTableAccounts?: AddressLookupTableAccount[];
}): Promise<{
    /** Account metas used in the `message`. */
    accountMetas: AccountMeta[];
    /** Address lookup table accounts used in the `message`. */
    lookupTableAccounts: AddressLookupTableAccount[];
}> {

    const message = transactionMessageBeet.deserialize(messageBytes)[0];
    //deserializeVaultTransactionMessage(messageBytes).message;
    const ephemeralSignerPdas = ephemeralSignerBumps.map(
        (_, additionalSignerIndex) => {
            return getEphemeralSignerPda({
                transactionPda,
                ephemeralSignerIndex: additionalSignerIndex,
                programId,
            })[0];
        }
    );
    console.log("ephemeral signer PDAs", ephemeralSignerPdas.map((p) => p.toBase58()));
    const addressLookupTableKeys = message.addressTableLookups.map(
        ({ accountKey }) => accountKey
    );
    const addressLookupTableAccounts = new Map(
        await Promise.all(
            addressLookupTableKeys.map(async (key) => {
                const keyBase58 = key.toBase58();
                const localAccount = localAddressLookupTableAccounts?.find((a) => a.key.toBase58() === keyBase58)
                if (localAccount) {
                    return [keyBase58, localAccount] as const;
                }

                const { value } = await connection.getAddressLookupTable(key);
                if (!value) {
                    throw new Error(
                        `Address lookup table account ${keyBase58} not found`
                    );
                }
                return [keyBase58, value] as const;
            })
        )
    );

    // Populate account metas required for execution of the transaction.
    const accountMetas: AccountMeta[] = [];
    // First add the lookup table accounts used by the transaction. They are needed for on-chain validation.
    accountMetas.push(
        ...addressLookupTableKeys.map((key) => {
            return { pubkey: key, isSigner: false, isWritable: false };
        })
    );

    // Then add static account keys included into the message.
    for (const [accountIndex, accountKey] of message.accountKeys.entries()) {
        console.log("Processing static account key", accountKey.toBase58(), "at index", accountIndex);
        accountMetas.push({
            pubkey: accountKey,
            isWritable: isStaticWritableIndex(message, accountIndex),
            // NOTE: vaultPda and ephemeralSignerPdas cannot be marked as signers,
            // because they are PDAs and hence won't have their signatures on the transaction.
            isSigner:
                isSignerIndex(message, accountIndex) &&
                !accountKey.equals(vaultPda) &&
                !ephemeralSignerPdas.find((k) => accountKey.equals(k)),
        });
    }
    // Then add accounts that will be loaded with address lookup tables.
    for (const lookup of message.addressTableLookups) {

        const lookupTableAccount = addressLookupTableAccounts.get(
            lookup.accountKey.toBase58()
        );
        if (!lookupTableAccount) {
            throw new Error(
                `Address lookup table account ${lookup.accountKey.toBase58()} not found`
            );
        }
        for (const accountIndex of lookup.writableIndexes) {
            const pubkey: PublicKey =
                lookupTableAccount.state.addresses[accountIndex];
            invariant(
                pubkey,
                `Address lookup table account ${lookup.accountKey.toBase58()} does not contain address at index ${accountIndex}`
            );
            accountMetas.push({
                pubkey,
                isWritable: true,
                // Accounts in address lookup tables can not be signers.
                isSigner: false,
            });
        }
        for (const accountIndex of lookup.readonlyIndexes) {
            const pubkey: PublicKey =
                lookupTableAccount.state.addresses[accountIndex];
            invariant(
                pubkey,
                `Address lookup table account ${lookup.accountKey.toBase58()} does not contain address at index ${accountIndex}`
            );
            accountMetas.push({
                pubkey,
                isWritable: false,
                // Accounts in address lookup tables can not be signers.
                isSigner: false,
            });
        }
    }

    return {
        accountMetas,
        lookupTableAccounts: [...addressLookupTableAccounts.values()],
    };
}

export type CompiledKeyMeta = {
    isSigner: boolean;
    isWritable: boolean;
    isInvoked: boolean;
};

type KeyMetaMap = Map<string, CompiledKeyMeta>;

/**
 *  This is almost completely copy-pasted from solana-web3.js and slightly adapted to work with "wrapped" transaction messaged such as in VaultTransaction.
 *  @see https://github.com/solana-labs/solana-web3.js/blob/87d33ac68e2453b8a01cf8c425aa7623888434e8/packages/library-legacy/src/message/compiled-keys.ts
 */
export class CompiledKeys {
    payer: PublicKey;
    keyMetaMap: KeyMetaMap;

    constructor(payer: PublicKey, keyMetaMap: KeyMetaMap) {
        this.payer = payer;
        this.keyMetaMap = keyMetaMap;
    }

    /**
     * The only difference between this and the original is that we don't mark the instruction programIds as invoked.
     * It makes sense to do because the instructions will be called via CPI, so the programIds can come from Address Lookup Tables.
     * This allows to compress the message size and avoid hitting the tx size limit during vault_transaction_create instruction calls.
     */
    static compile(
        instructions: Array<TransactionInstruction>,
        payer: PublicKey
    ): CompiledKeys {
        const keyMetaMap: KeyMetaMap = new Map();
        const getOrInsertDefault = (pubkey: PublicKey): CompiledKeyMeta => {
            const address = pubkey.toBase58();
            let keyMeta = keyMetaMap.get(address);
            if (keyMeta === undefined) {
                keyMeta = {
                    isSigner: false,
                    isWritable: false,
                    isInvoked: false,
                };
                keyMetaMap.set(address, keyMeta);
            }
            return keyMeta;
        };

        const payerKeyMeta = getOrInsertDefault(payer);
        payerKeyMeta.isSigner = true;
        payerKeyMeta.isWritable = true;

        for (const ix of instructions) {
            // This is the only difference from the original.
            // getOrInsertDefault(ix.programId).isInvoked = true;
            getOrInsertDefault(ix.programId).isInvoked = false;
            for (const accountMeta of ix.keys) {
                const keyMeta = getOrInsertDefault(accountMeta.pubkey);
                keyMeta.isSigner ||= accountMeta.isSigner;
                keyMeta.isWritable ||= accountMeta.isWritable;
            }
        }

        return new CompiledKeys(payer, keyMetaMap);
    }

    getMessageComponents(): [MessageHeader, Array<PublicKey>] {
        const mapEntries = [...this.keyMetaMap.entries()];
        assert(mapEntries.length <= 256, "Max static account keys length exceeded");

        const writableSigners = mapEntries.filter(
            ([, meta]) => meta.isSigner && meta.isWritable
        );
        const readonlySigners = mapEntries.filter(
            ([, meta]) => meta.isSigner && !meta.isWritable
        );
        const writableNonSigners = mapEntries.filter(
            ([, meta]) => !meta.isSigner && meta.isWritable
        );
        const readonlyNonSigners = mapEntries.filter(
            ([, meta]) => !meta.isSigner && !meta.isWritable
        );

        const header: MessageHeader = {
            numRequiredSignatures: writableSigners.length + readonlySigners.length,
            numReadonlySignedAccounts: readonlySigners.length,
            numReadonlyUnsignedAccounts: readonlyNonSigners.length,
        };

        // sanity checks
        {
            assert(
                writableSigners.length > 0,
                "Expected at least one writable signer key"
            );
            const [payerAddress] = writableSigners[0];
            assert(
                payerAddress === this.payer.toBase58(),
                "Expected first writable signer key to be the fee payer"
            );
        }

        const staticAccountKeys = [
            ...writableSigners.map(([address]) => new PublicKey(address)),
            ...readonlySigners.map(([address]) => new PublicKey(address)),
            ...writableNonSigners.map(([address]) => new PublicKey(address)),
            ...readonlyNonSigners.map(([address]) => new PublicKey(address)),
        ];

        return [header, staticAccountKeys];
    }

    extractTableLookup(
        lookupTable: AddressLookupTableAccount
    ): [MessageAddressTableLookup, AccountKeysFromLookups] | undefined {
        const [writableIndexes, drainedWritableKeys] =
            this.drainKeysFoundInLookupTable(
                lookupTable.state.addresses,
                (keyMeta) =>
                    !keyMeta.isSigner && !keyMeta.isInvoked && keyMeta.isWritable
            );
        const [readonlyIndexes, drainedReadonlyKeys] =
            this.drainKeysFoundInLookupTable(
                lookupTable.state.addresses,
                (keyMeta) =>
                    !keyMeta.isSigner && !keyMeta.isInvoked && !keyMeta.isWritable
            );

        // Don't extract lookup if no keys were found
        if (writableIndexes.length === 0 && readonlyIndexes.length === 0) {
            return;
        }

        return [
            {
                accountKey: lookupTable.key,
                writableIndexes,
                readonlyIndexes,
            },
            {
                writable: drainedWritableKeys,
                readonly: drainedReadonlyKeys,
            },
        ];
    }

    /** @internal */
    private drainKeysFoundInLookupTable(
        lookupTableEntries: Array<PublicKey>,
        keyMetaFilter: (keyMeta: CompiledKeyMeta) => boolean
    ): [Array<number>, Array<PublicKey>] {
        const lookupTableIndexes = new Array();
        const drainedKeys = new Array();

        for (const [address, keyMeta] of this.keyMetaMap.entries()) {
            if (keyMetaFilter(keyMeta)) {
                const key = new PublicKey(address);
                const lookupTableIndex = lookupTableEntries.findIndex((entry) =>
                    entry.equals(key)
                );
                if (lookupTableIndex >= 0) {
                    assert(lookupTableIndex < 256, "Max lookup table index exceeded");
                    lookupTableIndexes.push(lookupTableIndex);
                    drainedKeys.push(key);
                    this.keyMetaMap.delete(address);
                }
            }
        }

        return [lookupTableIndexes, drainedKeys];
    }
}
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