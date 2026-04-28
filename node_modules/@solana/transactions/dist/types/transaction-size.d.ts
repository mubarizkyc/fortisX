import type { NominalType } from '@solana/nominal-types';
import type { TransactionMessage, TransactionMessageWithinSizeLimit } from '@solana/transaction-messages';
import { Transaction } from './transaction';
/**
 * The maximum size of a transaction packet in bytes.
 *
 * @deprecated Transaction size is no longer constant as v1 transactions have a larger size limit. Use `getTransactionSizeLimit` instead to get the size limit for a specific transaction based on its version.
 */
export declare const TRANSACTION_PACKET_SIZE = 1280;
/**
 * The size of the transaction packet header in bytes.
 * This includes the IPv6 header and the fragment header.
 *
 * @deprecated Transaction size is no longer constant as v1 transactions have a larger size limit. Use `getTransactionSizeLimit` instead to get the size limit for a specific transaction based on its version.
 */
export declare const TRANSACTION_PACKET_HEADER: number;
/**
 * The maximum size of a transaction in bytes.
 *
 * Note that this excludes the transaction packet header.
 * In other words, this is how much content we can fit in a transaction packet.
 *
 * @deprecated Transaction size is no longer constant as v1 transactions have a larger size limit. Use `getTransactionSizeLimit` instead to get the size limit for a specific transaction based on its version.
 */
export declare const TRANSACTION_SIZE_LIMIT: number;
/**
 * Gets the size of a given transaction in bytes.
 *
 * @example
 * ```ts
 * const transactionSize = getTransactionSize(transaction);
 * ```
 */
export declare function getTransactionSize(transaction: Transaction): number;
/**
 * A type guard that checks if a transaction is within the size limit.
 */
export type TransactionWithinSizeLimit = NominalType<'transactionSize', 'withinLimit'>;
/**
 * Helper type that adds the `TransactionWithinSizeLimit` flag to
 * a transaction if and only if the provided transaction message
 * is also within the size limit.
 */
export type SetTransactionWithinSizeLimitFromTransactionMessage<TTransaction extends Transaction, TTransactionMessage extends TransactionMessage> = TTransactionMessage extends TransactionMessageWithinSizeLimit ? TransactionWithinSizeLimit & TTransaction : TTransaction;
/**
 * Returns the maximum size in bytes allowed for the given transaction.
 *
 * The size limit depends on the transaction version: version 1 transactions
 * allow up to {@link V1_TRANSACTION_SIZE_LIMIT} bytes, while legacy and v0
 * transactions are capped at {@link LEGACY_TRANSACTION_SIZE_LIMIT} bytes.
 *
 * @param transaction - The transaction whose size limit to retrieve.
 * @return The maximum number of bytes the transaction may occupy.
 *
 * @example
 * ```ts
 * const sizeLimit = getTransactionSizeLimit(transaction);
 * ```
 *
 * @see {@link isTransactionWithinSizeLimit}
 * @see {@link assertIsTransactionWithinSizeLimit}
 */
export declare function getTransactionSizeLimit(transaction: Transaction): number;
/**
 * Checks if a transaction is within the size limit.
 *
 * @typeParam TTransaction - The type of the given transaction.
 *
 * @example
 * ```ts
 * if (isTransactionWithinSizeLimit(transaction)) {
 *    transaction satisfies TransactionWithinSizeLimit;
 * }
 * ```
 */
export declare function isTransactionWithinSizeLimit<TTransaction extends Transaction>(transaction: TTransaction): transaction is TransactionWithinSizeLimit & TTransaction;
/**
 * Asserts that a given transaction is within the size limit.
 *
 * Throws a {@link SolanaError} of code {@link SOLANA_ERROR__TRANSACTION__EXCEEDS_SIZE_LIMIT}
 * if the transaction exceeds the size limit.
 *
 * @typeParam TTransaction - The type of the given transaction.
 *
 * @example
 * ```ts
 * assertIsTransactionWithinSizeLimit(transaction);
 * transaction satisfies TransactionWithinSizeLimit;
 * ```
 */
export declare function assertIsTransactionWithinSizeLimit<TTransaction extends Transaction>(transaction: TTransaction): asserts transaction is TransactionWithinSizeLimit & TTransaction;
//# sourceMappingURL=transaction-size.d.ts.map