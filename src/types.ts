import * as beet from "@metaplex-foundation/beet";
import * as beetSolana from "@metaplex-foundation/beet-solana";
import { PublicKey } from "@solana/web3.js";
import invariant from "invariant";
export function fixedSizeSmallArray<T, V = Partial<T>>(
    lengthBeet: beet.FixedSizeBeet<number>,
    elements: beet.FixedSizeBeet<T, V>[],
    elementsByteSize: number
): beet.FixedSizeBeet<T[], V[]> {
    const len = elements.length;
    const firstElement = len === 0 ? "<EMPTY>" : elements[0].description;

    return {
        write: function (buf: Buffer, offset: number, value: V[]): void {
            invariant(
                value.length === len,
                `array length ${value.length} should match len ${len}`
            );
            lengthBeet.write(buf, offset, len);

            let cursor = offset + lengthBeet.byteSize;
            for (let i = 0; i < len; i++) {
                const element = elements[i];
                element.write(buf, cursor, value[i]);
                cursor += element.byteSize;
            }
        },

        read: function (buf: Buffer, offset: number): T[] {
            const size = lengthBeet.read(buf, offset);
            invariant(size === len, "invalid byte size");

            let cursor = offset + lengthBeet.byteSize;
            const arr: T[] = new Array(len);
            for (let i = 0; i < len; i++) {
                const element = elements[i];
                arr[i] = element.read(buf, cursor);
                cursor += element.byteSize;
            }
            return arr;
        },
        byteSize: lengthBeet.byteSize + elementsByteSize,
        length: len,
        description: `Array<${firstElement}>(${len})[ ${lengthBeet.byteSize} + ${elementsByteSize} ]`,
    };
}
export function smallArray<T, V = Partial<T>>(
    lengthBeet: beet.FixedSizeBeet<number>,
    element: beet.Beet<T, V>
): beet.FixableBeet<T[], V[]> {
    return {
        toFixedFromData(buf: Buffer, offset: number): beet.FixedSizeBeet<T[], V[]> {
            const len = lengthBeet.read(buf, offset);
            const cursorStart = offset + lengthBeet.byteSize;
            let cursor = cursorStart;

            const fixedElements: beet.FixedSizeBeet<T, V>[] = new Array(len);
            for (let i = 0; i < len; i++) {
                const fixedElement = beet.fixBeetFromData(
                    element,
                    buf,
                    cursor
                ) as beet.FixedSizeBeet<T, V>;
                fixedElements[i] = fixedElement;
                cursor += fixedElement.byteSize;
            }
            return fixedSizeSmallArray(
                lengthBeet,
                fixedElements,
                cursor - cursorStart
            );
        },

        toFixedFromValue(vals: V[]): beet.FixedSizeBeet<T[], V[]> {
            invariant(Array.isArray(vals), `${vals} should be an array`);

            let elementsSize = 0;
            const fixedElements: beet.FixedSizeBeet<T, V>[] = new Array(vals.length);

            for (let i = 0; i < vals.length; i++) {
                const fixedElement: beet.FixedSizeBeet<T, V> = beet.fixBeetFromValue<
                    T,
                    V
                >(element, vals[i]);
                fixedElements[i] = fixedElement;
                elementsSize += fixedElement.byteSize;
            }
            return fixedSizeSmallArray(lengthBeet, fixedElements, elementsSize);
        },

        description: `smallArray`,
    };
}


export type CompiledMsInstruction = {
    programIdIndex: number;
    accountIndexes: number[];
    data: number[];
};

export const compiledMsInstructionBeet =
    new beet.FixableBeetArgsStruct<CompiledMsInstruction>(
        [
            ["programIdIndex", beet.u8],
            ["accountIndexes", smallArray(beet.u8, beet.u8)],
            ["data", smallArray(beet.u16, beet.u8)],
        ],
        "CompiledMsInstruction"
    );
export type VaultTransactionMessage = {
    numSigners: number;
    numWritableSigners: number;
    numWritableNonSigners: number;
    accountKeys: PublicKey[];
    instructions: CompiledMsInstruction[];
};

export const transactionMessageBeet =
    new beet.FixableBeetArgsStruct<VaultTransactionMessage>(
        [
            ["numSigners", beet.u8],
            ["numWritableSigners", beet.u8],
            ["numWritableNonSigners", beet.u8],
            ["accountKeys", smallArray(beet.u8, beetSolana.publicKey)],
            ["instructions", smallArray(beet.u8, compiledMsInstructionBeet)],
        ],
        "VaultTransactionMessage"
    );