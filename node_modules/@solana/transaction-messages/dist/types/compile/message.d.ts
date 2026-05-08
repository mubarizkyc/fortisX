import { TransactionMessageWithFeePayer } from '../fee-payer';
import { TransactionMessageWithLifetime } from '../lifetime';
import { TransactionMessage } from '../transaction-message';
import { getCompiledLifetimeToken } from './legacy/lifetime-token';
import { LegacyCompiledTransactionMessage } from './legacy/message';
import { V0CompiledTransactionMessage } from './v0/message';
import { V1CompiledTransactionMessage } from './v1/message';
/**
 * A transaction message in a form suitable for encoding for execution on the network.
 *
 * You can not fully reconstruct a source message from a compiled message without extra information.
 * In particular, supporting details about the lifetime constraint and the concrete addresses of
 * accounts sourced from account lookup tables are lost to compilation.
 */
export type CompiledTransactionMessage = LegacyCompiledTransactionMessage | V0CompiledTransactionMessage | V1CompiledTransactionMessage;
export type { LegacyCompiledTransactionMessage, V0CompiledTransactionMessage, V1CompiledTransactionMessage };
export type CompiledTransactionMessageWithLifetime = Readonly<{
    /**
     * 32 bytes of data observed by the transaction proposed that makes a transaction eligible to
     * land on the network.
     *
     * In the case of a transaction message with a nonce lifetime constraint, this will be the value
     * of the nonce itself. In all other cases this will be a recent blockhash.
     */
    lifetimeToken: ReturnType<typeof getCompiledLifetimeToken>;
}>;
/**
 * Converts the type of transaction message data structure that you create in your application to
 * the type of transaction message data structure that can be encoded for execution on the network.
 *
 * This is a lossy process; you can not fully reconstruct a source message from a compiled message
 * without extra information. In particular, supporting details about the lifetime constraint and
 * the concrete addresses of accounts sourced from account lookup tables will be lost to
 * compilation.
 *
 * @see {@link decompileTransactionMessage}
 */
export declare function compileTransactionMessage<TTransactionMessage extends TransactionMessage & TransactionMessageWithFeePayer & {
    version: 'legacy';
}>(transactionMessage: TTransactionMessage): ForwardTransactionMessageLifetime<LegacyCompiledTransactionMessage, TTransactionMessage>;
export declare function compileTransactionMessage<TTransactionMessage extends TransactionMessage & TransactionMessageWithFeePayer & {
    version: 0;
}>(transactionMessage: TTransactionMessage): ForwardTransactionMessageLifetime<V0CompiledTransactionMessage, TTransactionMessage>;
export declare function compileTransactionMessage<TTransactionMessage extends TransactionMessage & TransactionMessageWithFeePayer & {
    version: 1;
}>(transactionMessage: TTransactionMessage): ForwardTransactionMessageLifetime<V1CompiledTransactionMessage, TTransactionMessage>;
export declare function compileTransactionMessage<TTransactionMessage extends TransactionMessage & TransactionMessageWithFeePayer>(transactionMessage: TTransactionMessage): ForwardTransactionMessageLifetime<CompiledTransactionMessage, TTransactionMessage>;
type ForwardTransactionMessageLifetime<TCompiledTransactionMessage extends CompiledTransactionMessage, TTransactionMessage extends TransactionMessage> = TTransactionMessage extends TransactionMessageWithLifetime ? CompiledTransactionMessageWithLifetime & TCompiledTransactionMessage : TCompiledTransactionMessage;
//# sourceMappingURL=message.d.ts.map