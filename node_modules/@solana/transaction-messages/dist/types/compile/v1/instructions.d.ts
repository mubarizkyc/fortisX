import { ReadonlyUint8Array } from '@solana/codecs-core';
import { Instruction } from '@solana/instructions';
import { getAccountIndex } from '../legacy/instructions';
export type InstructionHeader = {
    numInstructionAccounts: number;
    numInstructionDataBytes: number;
    programAccountIndex: number;
};
export type InstructionPayload = {
    instructionAccountIndices: number[];
    instructionData: ReadonlyUint8Array;
};
export declare function getInstructionHeader(instruction: Instruction, accountIndex: ReturnType<typeof getAccountIndex>): InstructionHeader;
export declare function getInstructionPayload(instruction: Instruction, accountIndex: ReturnType<typeof getAccountIndex>): InstructionPayload;
//# sourceMappingURL=instructions.d.ts.map