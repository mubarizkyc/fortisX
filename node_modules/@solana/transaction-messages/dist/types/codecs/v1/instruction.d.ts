import { FixedSizeCodec, FixedSizeDecoder, FixedSizeEncoder, VariableSizeDecoder, VariableSizeEncoder } from '@solana/codecs-core';
import { InstructionHeader, InstructionPayload } from '../../compile/v1/instructions';
/**
 * Encode the fixed size {@link InstructionHeader}
 * @returns A FixedSizeEncoder for the instruction header
 */
export declare function getInstructionHeaderEncoder(): FixedSizeEncoder<InstructionHeader>;
/**
 * Decode an {@link InstructionHeader} from a byte array
 * @returns A FixedSizeDecoder for the instruction header
 */
export declare function getInstructionHeaderDecoder(): FixedSizeDecoder<InstructionHeader>;
/**
 * Get a codec for the {@link InstructionHeader}, which includes both the encoder and decoder
 * @returns A FixedSizeCodec for the instruction header
 */
export declare function getInstructionHeaderCodec(): FixedSizeCodec<InstructionHeader>;
/**
 * Encode the variable size {@link InstructionPayload}, which includes the account indices and instruction data.
 * Both arrays may be empty
 * @returns A VariableSizeEncoder for the instruction payload
 */
export declare function getInstructionPayloadEncoder(): VariableSizeEncoder<InstructionPayload>;
/**
 * Decode an {@link InstructionPayload} from a byte array, given the instruction header
 * @param instructionHeader The header for the instruction
 * @returns A decoder for InstructionPayload
 */
export declare function getInstructionPayloadDecoder(instructionHeader: Pick<InstructionHeader, 'numInstructionAccounts' | 'numInstructionDataBytes'>): VariableSizeDecoder<InstructionPayload>;
//# sourceMappingURL=instruction.d.ts.map