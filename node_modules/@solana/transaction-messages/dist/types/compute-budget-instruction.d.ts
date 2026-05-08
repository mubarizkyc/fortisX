import { Address } from '@solana/addresses';
import { ReadonlyUint8Array } from '@solana/codecs-core';
import { Instruction, InstructionWithData } from '@solana/instructions';
import type { TransactionMessage } from './transaction-message';
/** Address of the Compute Budget program. */
export declare const COMPUTE_BUDGET_PROGRAM_ADDRESS: Address<"ComputeBudget111111111111111111111111111111">;
/** The maximum compute unit limit that can be set for a transaction (1.4M CU). */
export declare const MAX_COMPUTE_UNIT_LIMIT = 1400000;
type ComputeBudgetInstruction = Instruction<typeof COMPUTE_BUDGET_PROGRAM_ADDRESS> & InstructionWithData<ReadonlyUint8Array>;
export declare function getSetComputeUnitLimitInstruction(units: number): ComputeBudgetInstruction;
export declare function isSetComputeUnitLimitInstruction(instruction: Instruction): instruction is ComputeBudgetInstruction;
export declare function getComputeUnitLimitFromInstructionData(data: ReadonlyUint8Array): number;
export declare function getSetComputeUnitPriceInstruction(microLamports: bigint): ComputeBudgetInstruction;
export declare function isSetComputeUnitPriceInstruction(instruction: Instruction): instruction is ComputeBudgetInstruction;
export declare function getPriorityFeeFromInstructionData(data: ReadonlyUint8Array): bigint;
export declare function getRequestHeapFrameInstruction(bytes: number): ComputeBudgetInstruction;
export declare function isRequestHeapFrameInstruction(instruction: Instruction): instruction is ComputeBudgetInstruction;
export declare function getHeapSizeFromInstructionData(data: ReadonlyUint8Array): number;
export declare function getSetLoadedAccountsDataSizeLimitInstruction(limit: number): ComputeBudgetInstruction;
export declare function isSetLoadedAccountsDataSizeLimitInstruction(instruction: Instruction): instruction is ComputeBudgetInstruction;
export declare function getLoadedAccountsDataSizeLimitFromInstructionData(data: ReadonlyUint8Array): number;
export declare function replaceTransactionMessageInstruction<TTransactionMessage extends TransactionMessage>(index: number, newInstruction: Instruction, transactionMessage: TTransactionMessage): TTransactionMessage;
export declare function removeTransactionMessageInstruction<TTransactionMessage extends TransactionMessage>(index: number, transactionMessage: TTransactionMessage): TTransactionMessage;
export {};
//# sourceMappingURL=compute-budget-instruction.d.ts.map