import type { PendingRpcRequest } from '@solana/rpc';
import type { PendingRpcSubscriptionsRequest } from '@solana/rpc-subscriptions';
import type { SolanaRpcResponse } from '@solana/rpc-types';
type CreateAsyncGeneratorWithInitialValueAndSlotTrackingConfig<TRpcValue, TSubscriptionValue, TItem> = Readonly<{
    /**
     * Triggering this abort signal will cancel the pending RPC request and subscription, and
     * cause the async generator to return (complete without error).
     */
    abortSignal: AbortSignal;
    /**
     * A pending RPC request whose response will be yielded as the generator's first value
     * (unless a subscription notification with a newer slot arrives first).
     * The response must be a {@link SolanaRpcResponse} so that its slot can be compared with
     * subscription notifications.
     */
    rpcRequest: PendingRpcRequest<SolanaRpcResponse<TRpcValue>>;
    /**
     * A pending RPC subscription request whose notifications will be yielded as they arrive.
     * Each notification must be a {@link SolanaRpcResponse} so that its slot can be compared
     * with the initial RPC response and other notifications.
     */
    rpcSubscriptionRequest: PendingRpcSubscriptionsRequest<SolanaRpcResponse<TSubscriptionValue>>;
    /**
     * Maps the value from a subscription notification to the item type yielded by the generator.
     */
    rpcSubscriptionValueMapper: (value: TSubscriptionValue) => TItem;
    /**
     * Maps the value from the RPC response to the item type yielded by the generator.
     */
    rpcValueMapper: (value: TRpcValue) => TItem;
}>;
/**
 * Creates an async generator that combines an initial RPC fetch with an ongoing subscription,
 * yielding values as they arrive from either source.
 *
 * The generator uses slot-based comparison to ensure that only the most recent values are yielded.
 * Any value at a slot older than a previously yielded value is silently dropped.
 * This prevents stale data from appearing when the RPC response and subscription notifications
 * arrive out of order.
 *
 * Things to note:
 *
 * - The generator yields {@link SolanaRpcResponse} values from both the RPC response and
 *   subscription notifications, each containing the slot context and the mapped value.
 * - Out-of-order values (by slot) are silently dropped — they are never yielded.
 * - On error from either source, the generator throws the error.
 * - Triggering the caller's abort signal causes the generator to return (complete without error).
 * - The generator completes when the subscription ends, an error occurs, or the abort signal fires.
 *
 * @param config
 *
 * @example
 * ```ts
 * import {
 *     address,
 *     createAsyncGeneratorWithInitialValueAndSlotTracking,
 *     createSolanaRpc,
 *     createSolanaRpcSubscriptions,
 * } from '@solana/kit';
 *
 * const rpc = createSolanaRpc('http://127.0.0.1:8899');
 * const rpcSubscriptions = createSolanaRpcSubscriptions('ws://127.0.0.1:8900');
 * const myAddress = address('FnHyam9w4NZoWR6mKN1CuGBritdsEWZQa4Z4oawLZGxa');
 *
 * const abortController = new AbortController();
 * for await (const balance of createAsyncGeneratorWithInitialValueAndSlotTracking({
 *     abortSignal: abortController.signal,
 *     rpcRequest: rpc.getBalance(myAddress, { commitment: 'confirmed' }),
 *     rpcValueMapper: lamports => lamports,
 *     rpcSubscriptionRequest: rpcSubscriptions.accountNotifications(myAddress),
 *     rpcSubscriptionValueMapper: ({ lamports }) => lamports,
 * })) {
 *     console.log(`Balance at slot ${balance.context.slot}:`, balance.value);
 * }
 * ```
 */
export declare function createAsyncGeneratorWithInitialValueAndSlotTracking<TRpcValue, TSubscriptionValue, TItem>({ abortSignal, rpcRequest, rpcValueMapper, rpcSubscriptionRequest, rpcSubscriptionValueMapper, }: CreateAsyncGeneratorWithInitialValueAndSlotTrackingConfig<TRpcValue, TSubscriptionValue, TItem>): AsyncGenerator<SolanaRpcResponse<TItem>>;
export {};
//# sourceMappingURL=create-async-generator-with-initial-value-and-slot-tracking.d.ts.map