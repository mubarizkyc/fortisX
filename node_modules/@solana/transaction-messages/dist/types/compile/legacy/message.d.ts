import { Address } from '@solana/addresses';
import { TransactionMessageWithFeePayer } from '../..';
import { TransactionMessage } from '../../transaction-message';
import { ForwardTransactionMessageLifetime } from '../message-types';
import { getCompiledMessageHeader } from './header';
import { getCompiledInstructions } from './instructions';
export type LegacyCompiledTransactionMessage = Readonly<{
    /** Information about the role of the accounts loaded. */
    header: ReturnType<typeof getCompiledMessageHeader>;
    /** A list of instructions that this transaction will execute */
    instructions: ReturnType<typeof getCompiledInstructions>;
    /** A list of addresses indicating which accounts to load */
    staticAccounts: Address[];
    version: 'legacy';
}>;
/**
 * Converts the type of transaction message data structure that you create in your application to
 * the type of transaction message data structure that can be encoded for execution on the network.
 *
 * This is a lossy process; you can not fully reconstruct a source message from a compiled message
 * without extra information. In particular, supporting details about the lifetime constraint will
 * be lost to compilation.
 *
 * @see {@link decompileTransactionMessage}
 */
export declare function compileTransactionMessage<TTransactionMessage extends TransactionMessage & TransactionMessageWithFeePayer & {
    version: 'legacy';
}>(transactionMessage: TTransactionMessage): ForwardTransactionMessageLifetime<LegacyCompiledTransactionMessage, TTransactionMessage>;
//# sourceMappingURL=message.d.ts.map