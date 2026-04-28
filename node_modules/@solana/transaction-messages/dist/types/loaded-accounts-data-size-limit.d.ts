import { TransactionMessage } from './transaction-message';
/**
 * Returns the loaded accounts data size limit currently set on a transaction message, or
 * `undefined` if none is set.
 *
 * This function works with all transaction versions:
 * - **V1**: Reads from the transaction message's `config.loadedAccountsDataSizeLimit`.
 * - **Legacy / V0**: Searches the instructions for a `SetLoadedAccountsDataSizeLimit` instruction
 *   and decodes its value.
 *
 * @param transactionMessage - The transaction message to inspect.
 * @return The loaded accounts data size limit in bytes, or `undefined` if none is set.
 *
 * @example
 * ```ts
 * const limit = getTransactionMessageLoadedAccountsDataSizeLimit(transactionMessage);
 * if (limit !== undefined) {
 *     console.log(`Loaded accounts data size limit: ${limit}`);
 * }
 * ```
 */
export declare function getTransactionMessageLoadedAccountsDataSizeLimit(transactionMessage: TransactionMessage): number | undefined;
/**
 * Sets the loaded accounts data size limit for a transaction message.
 *
 * This function works with all transaction versions:
 * - **V1**: Sets the `loadedAccountsDataSizeLimit` field in the transaction message's config.
 * - **Legacy / V0**: Appends (or replaces) a `SetLoadedAccountsDataSizeLimit` instruction from
 *   the Compute Budget program.
 *
 * @param loadedAccountsDataSizeLimit - The maximum size in bytes for loaded account data, or
 *   `undefined` to remove the limit.
 * @param transactionMessage - The transaction message to configure.
 * @typeParam TTransactionMessage - The transaction message type.
 * @return A new transaction message with the loaded accounts data size limit set.
 *
 * @example
 * ```ts
 * const txMessage = setTransactionMessageLoadedAccountsDataSizeLimit(
 *     64_000,
 *     transactionMessage,
 * );
 * ```
 */
export declare function setTransactionMessageLoadedAccountsDataSizeLimit<TTransactionMessage extends TransactionMessage>(loadedAccountsDataSizeLimit: number | undefined, transactionMessage: TTransactionMessage): TTransactionMessage;
//# sourceMappingURL=loaded-accounts-data-size-limit.d.ts.map