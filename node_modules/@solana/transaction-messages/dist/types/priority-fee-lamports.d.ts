import { TransactionMessage, TransactionVersion } from './transaction-message';
type SupportedTransactionVersions = Extract<TransactionVersion, 1>;
/**
 * Returns the priority fee in lamports currently set on a v1 transaction message, or `undefined`
 * if none is set.
 *
 * This reads from the transaction message's `config.priorityFeeLamports`.
 *
 * @param transactionMessage - The v1 transaction message to inspect.
 * @return The priority fee in lamports, or `undefined` if none is set.
 *
 * @example
 * ```ts
 * const fee = getTransactionMessagePriorityFeeLamports(transactionMessage);
 * if (fee !== undefined) {
 *     console.log(`Priority fee: ${fee}`);
 * }
 * ```
 *
 * @see {@link setTransactionMessagePriorityFeeLamports}
 * @see {@link setTransactionMessageComputeUnitPrice} for legacy/v0 transactions.
 */
export declare function getTransactionMessagePriorityFeeLamports<TTransactionMessage extends TransactionMessage & {
    version: SupportedTransactionVersions;
}>(transactionMessage: TTransactionMessage): bigint | undefined;
/**
 * Sets the total priority fee for a v1 transaction message.
 *
 * In v1 transactions, the priority fee is expressed as a total amount in lamports — what you set is
 * what you pay, regardless of the compute unit limit.
 *
 * @param priorityFeeLamports - The priority fee amount in lamports, or `undefined` to remove the
 *   fee.
 * @param transactionMessage - The v1 transaction message to configure.
 * @typeParam TTransactionMessage - The transaction message type.
 * @return A new transaction message with the priority fee set.
 *
 * @example
 * ```ts
 * const txMessage = setTransactionMessagePriorityFeeLamports(
 *     10_000n,
 *     transactionMessage,
 * );
 * ```
 *
 * @see {@link getTransactionMessagePriorityFeeLamports}
 * @see {@link setTransactionMessageComputeUnitPrice} for legacy/v0 transactions.
 */
export declare function setTransactionMessagePriorityFeeLamports<TTransactionMessage extends TransactionMessage & {
    version: SupportedTransactionVersions;
}>(priorityFeeLamports: bigint | undefined, transactionMessage: TTransactionMessage): TTransactionMessage;
export {};
//# sourceMappingURL=priority-fee-lamports.d.ts.map