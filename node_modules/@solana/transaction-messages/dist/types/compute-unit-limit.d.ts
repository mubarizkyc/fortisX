import { TransactionMessage } from './transaction-message';
/**
 * Returns the compute unit limit currently set on a transaction message, or `undefined` if none is
 * set.
 *
 * This function works with all transaction versions:
 * - **V1**: Reads from the transaction message's `config.computeUnitLimit`.
 * - **Legacy / V0**: Searches the instructions for a `SetComputeUnitLimit` instruction and decodes
 *   its value.
 *
 * @param transactionMessage - The transaction message to inspect.
 * @return The compute unit limit, or `undefined` if none is set.
 *
 * @example
 * ```ts
 * const limit = getTransactionMessageComputeUnitLimit(transactionMessage);
 * if (limit !== undefined) {
 *     console.log(`Compute unit limit: ${limit}`);
 * }
 * ```
 */
export declare function getTransactionMessageComputeUnitLimit(transactionMessage: TransactionMessage): number | undefined;
/**
 * Sets the compute unit limit for a transaction message.
 *
 * This function works with all transaction versions:
 * - **V1**: Sets the `computeUnitLimit` field in the transaction message's config.
 * - **Legacy / V0**: Appends (or replaces) a `SetComputeUnitLimit` instruction from the Compute
 *   Budget program.
 *
 * @param computeUnitLimit - The maximum compute units (CUs) allowed, or `undefined` to remove the
 *   limit.
 * @param transactionMessage - The transaction message to configure.
 * @typeParam TTransactionMessage - The transaction message type.
 * @return A new transaction message with the compute unit limit set.
 *
 * @example
 * ```ts
 * const txMessage = setTransactionMessageComputeUnitLimit(
 *     400_000,
 *     transactionMessage,
 * );
 * ```
 */
export declare function setTransactionMessageComputeUnitLimit<TTransactionMessage extends TransactionMessage>(computeUnitLimit: number | undefined, transactionMessage: TTransactionMessage): TTransactionMessage;
//# sourceMappingURL=compute-unit-limit.d.ts.map