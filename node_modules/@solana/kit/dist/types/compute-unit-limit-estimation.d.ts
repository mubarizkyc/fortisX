import type { Rpc, SimulateTransactionApi } from '@solana/rpc';
import type { Commitment, Slot } from '@solana/rpc-types';
import { TransactionMessage, TransactionMessageWithFeePayer } from '@solana/transaction-messages';
type EstimateComputeUnitLimitFactoryConfig = Readonly<{
    rpc: Rpc<SimulateTransactionApi>;
}>;
type EstimateComputeUnitLimitConfig = Readonly<{
    abortSignal?: AbortSignal;
    commitment?: Commitment;
    minContextSlot?: Slot;
}>;
type EstimateComputeUnitLimitFunction = (transactionMessage: TransactionMessage & TransactionMessageWithFeePayer, config?: EstimateComputeUnitLimitConfig) => Promise<number>;
/**
 * Returns a function that estimates the compute units consumed by a transaction message by
 * simulating it.
 *
 * The estimator sets the compute unit limit to the maximum (1,400,000) before simulating, so the
 * simulation does not fail due to compute unit exhaustion. For blockhash-lifetime transactions, the
 * RPC is asked to replace the blockhash during simulation, so any blockhash value will work. For
 * durable nonce transactions, the actual nonce value is used.
 *
 * @param factoryConfig - An object containing the RPC instance to use for simulation.
 * @return A function that accepts a transaction message and returns the estimated compute units.
 *
 * @example
 * ```ts
 * import { estimateComputeUnitLimitFactory } from '@solana/kit';
 *
 * const estimateComputeUnitLimit = estimateComputeUnitLimitFactory({ rpc });
 * const estimatedUnits = await estimateComputeUnitLimit(transactionMessage);
 * ```
 */
export declare function estimateComputeUnitLimitFactory({ rpc, }: EstimateComputeUnitLimitFactoryConfig): EstimateComputeUnitLimitFunction;
/**
 * Returns a function that estimates the compute unit limit for a transaction message and sets it on
 * the message. If the message already has an explicit compute unit limit set (one that is not the
 * provisory value of 0, and not the maximum of 1,400,000), the message is returned unchanged.
 *
 * This is designed to work with {@link fillTransactionMessageProvisoryComputeUnitLimit}: first add a provisory limit
 * during transaction construction, then later estimate and replace it before sending.
 *
 * @param estimateComputeUnitLimit - The estimator function, typically created by
 *   {@link estimateComputeUnitLimitFactory}. You can also pass a custom wrapper that adds a buffer
 *   (e.g. multiply the estimate by 1.1).
 * @return A function that accepts a transaction message and returns it with the compute unit limit
 *   set to the estimated value.
 *
 * @example
 * ```ts
 * import { estimateAndSetComputeUnitLimitFactory, estimateComputeUnitLimitFactory } from '@solana/kit';
 *
 * const estimator = estimateComputeUnitLimitFactory({ rpc });
 * const estimateAndSet = estimateAndSetComputeUnitLimitFactory(estimator);
 * const updatedMessage = await estimateAndSet(transactionMessage);
 * ```
 */
export declare function estimateAndSetComputeUnitLimitFactory(estimateComputeUnitLimit: EstimateComputeUnitLimitFunction): <TTransactionMessage extends TransactionMessage & TransactionMessageWithFeePayer>(transactionMessage: TTransactionMessage, config?: EstimateComputeUnitLimitConfig) => Promise<TTransactionMessage>;
/**
 * Sets the compute unit limit to a provisory value of 0 if no compute unit limit is currently set
 * on the transaction message. If a limit is already set (any value, including 0), the message is
 * returned unchanged.
 *
 * This is useful during transaction construction to reserve space for a compute unit limit that
 * will later be replaced with an actual estimate via
 * {@link estimateAndSetComputeUnitLimitFactory}.
 *
 * @param transactionMessage - The transaction message to add a provisory limit to.
 * @return The transaction message with a provisory compute unit limit set, or unchanged if one was
 *   already present.
 *
 * @example
 * ```ts
 * import { fillTransactionMessageProvisoryComputeUnitLimit } from '@solana/kit';
 *
 * const messageWithProvisoryLimit = fillTransactionMessageProvisoryComputeUnitLimit(transactionMessage);
 * ```
 */
export declare function fillTransactionMessageProvisoryComputeUnitLimit<TTransactionMessage extends TransactionMessage>(transactionMessage: TTransactionMessage): TTransactionMessage;
export {};
//# sourceMappingURL=compute-unit-limit-estimation.d.ts.map