import { VariableSizeCodec, VariableSizeDecoder, VariableSizeEncoder } from '@solana/codecs-core';
import { getCompiledInstructions } from '../../compile/v0/instructions';
type CompiledInstruction = ReturnType<typeof getCompiledInstructions>[number];
export declare function getInstructionEncoder(): VariableSizeEncoder<CompiledInstruction>;
export declare function getInstructionDecoder(): VariableSizeDecoder<CompiledInstruction>;
export declare function getInstructionCodec(): VariableSizeCodec<CompiledInstruction>;
export {};
//# sourceMappingURL=instruction.d.ts.map