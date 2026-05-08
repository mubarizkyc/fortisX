import { VariableSizeCodec, VariableSizeDecoder, VariableSizeEncoder } from '@solana/codecs-core';
import { CompiledTransactionMessage, CompiledTransactionMessageWithLifetime } from '../..';
type LegacyCompiledTransactionMessage = CompiledTransactionMessage & {
    version: 'legacy';
};
export declare function getMessageEncoder(): VariableSizeEncoder<LegacyCompiledTransactionMessage | (CompiledTransactionMessageWithLifetime & LegacyCompiledTransactionMessage)>;
export declare function getMessageDecoder(): VariableSizeDecoder<CompiledTransactionMessageWithLifetime & LegacyCompiledTransactionMessage>;
export declare function getMessageCodec(): VariableSizeCodec<LegacyCompiledTransactionMessage | (CompiledTransactionMessageWithLifetime & LegacyCompiledTransactionMessage), CompiledTransactionMessageWithLifetime & LegacyCompiledTransactionMessage>;
export {};
//# sourceMappingURL=message.d.ts.map