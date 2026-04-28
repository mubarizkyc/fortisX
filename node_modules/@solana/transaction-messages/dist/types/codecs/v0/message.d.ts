import { VariableSizeCodec, VariableSizeDecoder, VariableSizeEncoder } from '@solana/codecs-core';
import { CompiledTransactionMessage, CompiledTransactionMessageWithLifetime } from '../..';
type V0CompiledTransactionMessage = CompiledTransactionMessage & {
    version: 0;
};
export declare function getMessageEncoder(): VariableSizeEncoder<V0CompiledTransactionMessage | (CompiledTransactionMessageWithLifetime & V0CompiledTransactionMessage)>;
export declare function getMessageDecoder(): VariableSizeDecoder<CompiledTransactionMessageWithLifetime & V0CompiledTransactionMessage>;
export declare function getMessageCodec(): VariableSizeCodec<V0CompiledTransactionMessage | (CompiledTransactionMessageWithLifetime & V0CompiledTransactionMessage), CompiledTransactionMessageWithLifetime & V0CompiledTransactionMessage>;
export {};
//# sourceMappingURL=message.d.ts.map