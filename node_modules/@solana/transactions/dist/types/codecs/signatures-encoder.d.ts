import { FixedSizeEncoder, VariableSizeEncoder } from '@solana/codecs-core';
import { SignaturesMap } from '../transaction';
/**
 * Signatures encoder used for legacy and v0 transactions, which encode signatures
 * as an array with a u16-short size prefix
 *
 * @internal
 */
export declare function getSignaturesEncoderWithSizePrefix(): VariableSizeEncoder<SignaturesMap>;
/**
 * Signatures encoder used for v1 transactions, which encode signatures
 * as a known-size array
 *
 * @param size Known number of signatures for the transaction
 *
 * @internal
 */
export declare function getSignaturesEncoderWithLength(size: number): FixedSizeEncoder<SignaturesMap>;
//# sourceMappingURL=signatures-encoder.d.ts.map