import { TransactionMessage } from './transaction-message';
/**
 * Returns the heap size currently set on a transaction message, or `undefined` if none is set.
 *
 * This function works with all transaction versions:
 * - **V1**: Reads from the transaction message's `config.heapSize`.
 * - **Legacy / V0**: Searches the instructions for a `RequestHeapFrame` instruction and decodes its
 *   value.
 *
 * @param transactionMessage - The transaction message to inspect.
 * @return The heap size in bytes, or `undefined` if none is set.
 *
 * @example
 * ```ts
 * const heapSize = getTransactionMessageHeapSize(transactionMessage);
 * if (heapSize !== undefined) {
 *     console.log(`Heap size: ${heapSize}`);
 * }
 * ```
 */
export declare function getTransactionMessageHeapSize(transactionMessage: TransactionMessage): number | undefined;
/**
 * Sets the heap frame size for a transaction message.
 *
 * This function works with all transaction versions:
 * - **V1**: Sets the `heapSize` field in the transaction message's config.
 * - **Legacy / V0**: Appends (or replaces) a `RequestHeapFrame` instruction from the Compute
 *   Budget program.
 *
 * @param heapSize - The requested heap frame size in bytes, or `undefined` to remove the setting.
 * @param transactionMessage - The transaction message to configure.
 * @typeParam TTransactionMessage - The transaction message type.
 * @return A new transaction message with the heap size set.
 *
 * @example
 * ```ts
 * const txMessage = setTransactionMessageHeapSize(
 *     256_000,
 *     transactionMessage,
 * );
 * ```
 */
export declare function setTransactionMessageHeapSize<TTransactionMessage extends TransactionMessage>(heapSize: number | undefined, transactionMessage: TTransactionMessage): TTransactionMessage;
//# sourceMappingURL=heap-size.d.ts.map