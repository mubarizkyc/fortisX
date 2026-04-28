import { VariableSizeDecoder, VariableSizeEncoder } from '@solana/codecs-core';
import { CompiledTransactionConfigValue } from '../../compile/v1/config';
/**
 * Encode a {@link TransactionMessageConfig} into a variable length byte array, where the fields set are encoded based on their data size.
 * @returns An Encoder for {@link TransactionMessageConfig}
 */
export declare function getCompiledTransactionConfigValuesEncoder(): VariableSizeEncoder<CompiledTransactionConfigValue[]>;
/**
 * Decode a {@link TransactionMessageConfig} from a byte array of values, using the provided mask.
 * @param mask A mask indicating which fields are set
 * @returns A Decoder for {@link TransactionMessageConfig}
 */
export declare function getCompiledTransactionConfigValuesDecoder(mask: number): VariableSizeDecoder<CompiledTransactionConfigValue[]>;
//# sourceMappingURL=config.d.ts.map