import { TransactionMessage, TransactionVersion } from './transaction-message';
/**
 * Configuration options for transaction messages.
 *
 * These options allow fine-grained control over transaction resource usage and
 * prioritization. All fields are optional and will be encoded into the transaction
 * when present.
 */
export type V1TransactionConfig = {
    /**
     * Maximum number of compute units the transaction may consume.
     *
     * If not specified, defaults to 200,000 CUs per instruction. The maximum
     * allowed value is 1,400,000 CUs.
     */
    computeUnitLimit?: number;
    /**
     * Requested heap frame size in bytes for the transaction's execution.
     */
    heapSize?: number;
    /**
     * Maximum size in bytes for loaded account data.
     */
    loadedAccountsDataSizeLimit?: number;
    /**
     * Total priority fee in lamports to pay for transaction prioritization.
     */
    priorityFeeLamports?: bigint;
};
export declare function isV1ConfigEmpty(config: V1TransactionConfig): boolean;
export declare function areV1ConfigsEqual(config1: V1TransactionConfig, config2: V1TransactionConfig): boolean;
type SupportedTransactionVersions = Extract<TransactionVersion, 1>;
/**
 * Sets configuration options on a transaction message.
 *
 * This function merges the provided configuration with any existing configuration
 * on the transaction message. Configuration values control resource limits and
 * transaction prioritization.
 *
 * @param config - The configuration options to apply.
 * @param transactionMessage - The transaction message to configure.
 * @typeParam TTransactionMessage - The transaction message type.
 * @return A new transaction message with the merged configuration.
 *
 * @example
 * ```ts
 * const configuredTx = setTransactionMessageConfig(
 *     {
 *         computeUnitLimit: 300_000,
 *         priorityFeeLamports: 50_000n,
 *     },
 *     transactionMessage,
 * );
 * ```
 *
 * @example
 * Incrementally adding configuration values.
 * ```ts
 * const txMessage = pipe(
 *     baseTransaction,
 *     tx => setTransactionMessageConfig({ computeUnitLimit: 300_000 }, tx),
 *     tx => setTransactionMessageConfig({ priorityFeeLamports: 50_000n }, tx),
 * );
 * ```
 *
 * @example
 * Removing a configuration value.
 * ```ts
 * const txMessage = setTransactionMessageConfig({ computeUnitLimit: undefined }, tx);
 * ```
 *
 * @see {@link setTransactionMessageComputeUnitLimit}
 * @see {@link setTransactionMessagePriorityFeeLamports}
 */
export declare function setTransactionMessageConfig<TTransactionMessage extends TransactionMessage & {
    version: SupportedTransactionVersions;
}>(config: V1TransactionConfig, transactionMessage: TTransactionMessage): TTransactionMessage;
export declare const TRANSACTION_CONFIG_PRIORITY_FEE_LAMPORTS_BIT_MASK = 3;
export declare const TRANSACTION_CONFIG_COMPUTE_UNIT_LIMIT_BIT_MASK = 4;
export declare const TRANSACTION_CONFIG_LOADED_ACCOUNTS_DATA_SIZE_LIMIT_BIT_MASK = 8;
export declare const TRANSACTION_CONFIG_HEAP_SIZE_BIT_MASK = 16;
/**
 * Checks whether the transaction config mask indicates a priority fee is present.
 *
 * The priority fee uses bits 0 and 1 of the mask. Both bits must be set or
 * both must be unset — having only one bit set is invalid and will throw an error.
 *
 * @param mask - The transaction config mask to check.
 * @return `true` if the mask indicates a priority fee is present, `false` otherwise.
 *
 * @throws {SolanaError} Throws `SOLANA_ERROR__TRANSACTION__INVALID_CONFIG_MASK_PRIORITY_FEE_BITS`
 * if only one of the two priority fee bits is set.
 *
 * @example
 * Check if a mask has a priority fee.
 * ```ts
 * const hasPriorityFee = transactionConfigMaskHasPriorityFee(0b11);
 * // true (both bits 0 and 1 are set)
 * ```
 */
export declare function transactionConfigMaskHasPriorityFee(mask: number): boolean;
/**
 * Checks whether the transaction config mask indicates a compute unit limit is present.
 *
 * The compute unit limit uses bit 2 of the mask.
 *
 * @param mask - The transaction config mask to check.
 * @return `true` if the mask indicates a compute unit limit is present, `false` otherwise.
 *
 * @example
 * ```ts
 * const hasComputeUnitLimit = transactionConfigMaskHasComputeUnitLimit(0b100);
 * // true (bit 2 is set)
 * ```
 */
export declare function transactionConfigMaskHasComputeUnitLimit(mask: number): boolean;
/**
 * Checks whether the transaction config mask indicates a loaded accounts data size limit is present.
 *
 * The loaded accounts data size limit uses bit 3 of the mask.
 *
 * @param mask - The transaction config mask to check.
 * @return `true` if the mask indicates a loaded accounts data size limit is present, `false` otherwise.
 *
 * @example
 * ```ts
 * const hasLimit = transactionConfigMaskHasLoadedAccountsDataSizeLimit(0b1000);
 * // true (bit 3 is set)
 * ```
 */
export declare function transactionConfigMaskHasLoadedAccountsDataSizeLimit(mask: number): boolean;
/**
 * Checks whether the transaction config mask indicates a heap size is present.
 *
 * The heap size uses bit 4 of the mask.
 *
 * @param mask - The transaction config mask to check.
 * @return `true` if the mask indicates a heap size is present, `false` otherwise.
 *
 * @example
 * ```ts
 * const hasHeapSize = transactionConfigMaskHasHeapSize(0b10000);
 * // true (bit 4 is set)
 * ```
 */
export declare function transactionConfigMaskHasHeapSize(mask: number): boolean;
export {};
//# sourceMappingURL=v1-transaction-config.d.ts.map