import { u8, u32, u64, bignum } from "@metaplex-foundation/beet";
import { Buffer } from "buffer";
import {
    AccountMeta,
    AddressLookupTableAccount,
    Connection,
    PublicKey,
    TransactionMessage,
    VersionedTransaction,
} from "@solana/web3.js";
import { transactionMessageBeet } from "./commands/types";
import invariant from "invariant";
const PROGRAM_ID = new PublicKey('CD6Pnc1gpUQ1XT1bzXEPs2QnqFMcQUHsiRKAV9iYXh36')
const TREASURY = new PublicKey('5wBH8hqU4PxVCFXmu3JR6Kegdy2Vq8K7fZnRgN5ZJEr2')
const SEED_PREFIX = Buffer.from('multisig')
const SEED_MULTISIG = Buffer.from('multisig')
const SEED_EPHEMERAL_SIGNER = toUtfBytes("ephemeral_signer");
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
export function deserializeVaultTransactionMessage(
    buffer: Buffer | Uint8Array,
    offset: number = 0
): { message: VaultTransactionMessage; bytesRead: number } {
    let cursor = offset;
    const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    // ────────────────────────────────────────────────────────────
    // 1. READ HEADER (3 u8 fields)
    // ────────────────────────────────────────────────────────────
    const numSigners = data[cursor++];                    // u8
    const numWritableSigners = data[cursor++];            // u8
    const numWritableNonSigners = data[cursor++];         // u8

    // ────────────────────────────────────────────────────────────
    // 2. READ ACCOUNT_KEYS: Vec<Pubkey> (Borsh: u32 LE len + 32*N bytes)
    // ────────────────────────────────────────────────────────────
    const accountKeysLen = data.readUInt32LE(cursor);     // u32 LE
    cursor += 4;

    const accountKeys: PublicKey[] = [];
    for (let i = 0; i < accountKeysLen; i++) {
        if (cursor + 32 > data.length) {
            throw new Error(`Account key ${i} out of bounds`);
        }
        accountKeys.push(new PublicKey(data.slice(cursor, cursor + 32)));
        cursor += 32;
    }

    // ────────────────────────────────────────────────────────────
    // 3. READ ADDRESS_TABLE_LOOKUPS: Vec<MultisigMessageAddressTableLookup>
    //    Borsh: u32 LE len + [item...]
    // ────────────────────────────────────────────────────────────
    const lookupsLen = data.readUInt32LE(cursor);         // u32 LE
    cursor += 4;

    const addressTableLookups: MessageAddressTableLookup[] = [];
    for (let i = 0; i < lookupsLen; i++) {
        if (cursor + 32 > data.length) throw new Error(`Lookup ${i}: account_key out of bounds`);
        const accountKey = new PublicKey(data.slice(cursor, cursor + 32));
        cursor += 32;

        // writable_indexes: Vec<u8>
        const writableLen = data.readUInt32LE(cursor);    // u32 LE
        cursor += 4;
        if (cursor + writableLen > data.length) throw new Error(`Lookup ${i}: writable_indexes out of bounds`);
        const writableIndexes = data.slice(cursor, cursor + writableLen);
        cursor += writableLen;

        // readonly_indexes: Vec<u8>
        const readonlyLen = data.readUInt32LE(cursor);    // u32 LE
        cursor += 4;
        if (cursor + readonlyLen > data.length) throw new Error(`Lookup ${i}: readonly_indexes out of bounds`);
        const readonlyIndexes = data.slice(cursor, cursor + readonlyLen);
        cursor += readonlyLen;

        addressTableLookups.push({
            accountKey,
            writableIndexes,
            readonlyIndexes,
        });
    }

    // ────────────────────────────────────────────────────────────
    // 4. READ INSTRUCTIONS: Vec<MultisigCompiledInstruction>
    //    Borsh: u32 LE len + [item...]
    // ────────────────────────────────────────────────────────────
    const instructionsLen = data.readUInt32LE(cursor);    // u32 LE
    cursor += 4;

    const instructions: CompiledInstruction[] = [];
    for (let i = 0; i < instructionsLen; i++) {
        if (cursor + 1 > data.length) throw new Error(`Instruction ${i}: program_id_index out of bounds`);
        const programIdIndex = data[cursor++];            // u8

        // account_indexes: Vec<u8>
        const accountIndexesLen = data.readUInt32LE(cursor); // u32 LE
        cursor += 4;
        if (cursor + accountIndexesLen > data.length) throw new Error(`Instruction ${i}: account_indexes out of bounds`);
        const accountIndexes = data.slice(cursor, cursor + accountIndexesLen);
        cursor += accountIndexesLen;

        // data: Vec<u8>
        const dataLen = data.readUInt32LE(cursor);        // u32 LE
        cursor += 4;
        if (cursor + dataLen > data.length) throw new Error(`Instruction ${i}: instruction data out of bounds`);
        const instructionData = data.slice(cursor, cursor + dataLen);
        cursor += dataLen;

        instructions.push({
            programIdIndex,
            accountIndexes,
            data: instructionData,
        });
    }

    return {
        message: {
            numSigners,
            numWritableSigners,
            numWritableNonSigners,
            accountKeys,
            instructions,
            addressTableLookups,
        },
        bytesRead: cursor - offset,
    };
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