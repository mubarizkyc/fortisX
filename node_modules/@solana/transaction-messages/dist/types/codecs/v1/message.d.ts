import { VariableSizeCodec, VariableSizeDecoder, VariableSizeEncoder } from '@solana/codecs-core';
import { CompiledTransactionMessageWithLifetime, V1CompiledTransactionMessage } from '../..';
export declare function getMessageEncoder(): VariableSizeEncoder<V1CompiledTransactionMessage | (CompiledTransactionMessageWithLifetime & V1CompiledTransactionMessage)>;
export declare function getMessageDecoder(): VariableSizeDecoder<CompiledTransactionMessageWithLifetime & V1CompiledTransactionMessage>;
export declare function getMessageCodec(): VariableSizeCodec<V1CompiledTransactionMessage | (CompiledTransactionMessageWithLifetime & V1CompiledTransactionMessage), CompiledTransactionMessageWithLifetime & V1CompiledTransactionMessage>;
//# sourceMappingURL=message.d.ts.map