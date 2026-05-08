import { SOLANA_ERROR__FAILED_TO_SEND_TRANSACTION, SOLANA_ERROR__FAILED_TO_SEND_TRANSACTIONS, SOLANA_ERROR__INSTRUCTION_PLANS__FAILED_TO_EXECUTE_TRANSACTION_PLAN, SolanaError } from '@solana/errors';
import { type CanceledSingleTransactionPlanResult, type FailedSingleTransactionPlanResult, type TransactionPlanResult } from './transaction-plan-result';
/**
 * Creates a {@link SolanaError} with the {@link SOLANA_ERROR__FAILED_TO_SEND_TRANSACTION}
 * error code from a failed or canceled {@link SingleTransactionPlanResult}.
 *
 * This is a high-level error designed for user-facing transaction send failures.
 * It unwraps simulation errors (such as preflight failures) to expose the
 * underlying transaction error as the `cause`, and extracts preflight data
 * and logs into the error context for easy access.
 *
 * The error message includes an indicator showing whether the failure was a
 * preflight error or includes the on-chain transaction signature for easy
 * copy-pasting into block explorers.
 *
 * @param result - A failed or canceled single transaction plan result.
 * @param abortReason - An optional abort reason if the transaction was canceled.
 * @return A {@link SolanaError} with the appropriate error code, context, and cause.
 *
 * @example
 * Creating an error from a failed transaction plan result.
 * ```ts
 * import { createFailedToSendTransactionError } from '@solana/instruction-plans';
 *
 * const error = createFailedToSendTransactionError(failedResult);
 * console.log(error.message);
 * // "Failed to send transaction (preflight): Insufficient funds for fee"
 * console.log(error.cause);
 * // The unwrapped transaction error
 * console.log(error.context.logs);
 * // Transaction logs from the preflight simulation
 * ```
 *
 * @see {@link createFailedToSendTransactionsError}
 */
export declare function createFailedToSendTransactionError(result: CanceledSingleTransactionPlanResult | FailedSingleTransactionPlanResult, abortReason?: unknown): SolanaError<typeof SOLANA_ERROR__FAILED_TO_SEND_TRANSACTION>;
/**
 * Creates a {@link SolanaError} with the {@link SOLANA_ERROR__FAILED_TO_SEND_TRANSACTIONS}
 * error code from a {@link TransactionPlanResult}.
 *
 * This is a high-level error designed for user-facing transaction send failures
 * involving multiple transactions. It walks the result tree, unwraps simulation
 * errors from each failure, and builds a `failedTransactions` array pairing each
 * failure with its unwrapped error, logs, and preflight data.
 *
 * The error message lists each failure with its position in the plan and an
 * indicator showing whether it was a preflight error or includes the transaction
 * signature. When all transactions were canceled, the message is a single line.
 *
 * @param result - The full transaction plan result tree.
 * @param abortReason - An optional abort reason if the plan was aborted.
 * @return A {@link SolanaError} with the appropriate error code, context, and cause.
 *
 * @example
 * Creating an error from a failed transaction plan result.
 * ```ts
 * import { createFailedToSendTransactionsError } from '@solana/instruction-plans';
 *
 * const error = createFailedToSendTransactionsError(planResult);
 * console.log(error.message);
 * // "Failed to send transactions.
 * // [Tx #1 (preflight)] Insufficient funds for fee
 * // [Tx #3 (5abc...)] Custom program error: 0x1"
 * console.log(error.context.failedTransactions);
 * // [{ index: 0, error: ..., logs: [...], preflightData: {...} }, ...]
 * ```
 *
 * @see {@link createFailedToSendTransactionError}
 */
export declare function createFailedToSendTransactionsError(result: TransactionPlanResult, abortReason?: unknown): SolanaError<typeof SOLANA_ERROR__FAILED_TO_SEND_TRANSACTIONS>;
/**
 * Creates a {@link SolanaError} with the
 * {@link SOLANA_ERROR__INSTRUCTION_PLANS__FAILED_TO_EXECUTE_TRANSACTION_PLAN}
 * error code from a {@link TransactionPlanResult}.
 *
 * This is a low-level error intended for custom transaction plan executor
 * authors. It attaches the full `transactionPlanResult` as a non-enumerable
 * property so that callers can inspect execution details without the result
 * being serialized with the error.
 *
 * @param result - The full transaction plan result tree.
 * @param abortReason - An optional abort reason if the plan was aborted.
 * @return A {@link SolanaError} with the appropriate error code and context.
 *
 * @example
 * Throwing a failed-to-execute error from a custom executor.
 * ```ts
 * import { createFailedToExecuteTransactionPlanError } from '@solana/instruction-plans';
 *
 * throw createFailedToExecuteTransactionPlanError(transactionPlanResult, abortSignal?.reason);
 * ```
 *
 * @see {@link createFailedToSendTransactionError}
 * @see {@link createFailedToSendTransactionsError}
 */
export declare function createFailedToExecuteTransactionPlanError(result: TransactionPlanResult, abortReason?: unknown): SolanaError<typeof SOLANA_ERROR__INSTRUCTION_PLANS__FAILED_TO_EXECUTE_TRANSACTION_PLAN>;
//# sourceMappingURL=transaction-plan-errors.d.ts.map