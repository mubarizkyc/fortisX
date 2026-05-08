import { DataPublisher } from './data-publisher';
type Config = Readonly<{
    /**
     * Triggering this abort signal will cause the store to stop updating and will disconnect it from
     * the underlying data publisher.
     */
    abortSignal: AbortSignal;
    /**
     * Messages from this channel of `dataPublisher` will be used to update the store's state.
     */
    dataChannelName: string;
    dataPublisher: DataPublisher;
    /**
     * Messages from this channel of `dataPublisher` will cause subscribers to be notified without
     * updating the state, so that they can respond to the error condition.
     */
    errorChannelName: string;
}>;
/**
 * A reactive store that holds the latest value published to a data channel and allows external
 * systems to subscribe to changes. Compatible with `useSyncExternalStore`, Svelte stores, Solid's
 * `from()`, and other reactive primitives that expect a `{ subscribe, getState }` contract.
 *
 * @example
 * ```ts
 * // React — throw error from snapshot function to surface via Error Boundary
 * const state = useSyncExternalStore(store.subscribe, () => {
 *     if (store.getError()) throw store.getError();
 *     return store.getState();
 * });
 *
 * // Vue — check error reactively in a composable
 * const data = shallowRef(store.getState());
 * const error = shallowRef(store.getError());
 * store.subscribe(() => {
 *     data.value = store.getState();
 *     error.value = store.getError();
 * });
 * ```
 *
 * @see {@link createReactiveStoreFromDataPublisher}
 */
export type ReactiveStore<T> = {
    /**
     * Returns the error published to the error channel, or `undefined` if no error has occurred.
     * Once set, the error is preserved — subsequent errors do not overwrite it.
     */
    getError(): unknown;
    /**
     * Returns the most recent value published to the data channel, or `undefined` if no
     * notification has arrived yet. On error, continues to return the last known value.
     */
    getState(): T | undefined;
    /**
     * Registers a callback to be called whenever the state changes or an error is received.
     * Returns an unsubscribe function. Safe to call multiple times.
     */
    subscribe(callback: () => void): () => void;
};
/**
 * Returns a {@link ReactiveStore} given a data publisher.
 *
 * The store will update its state with each message published to `dataChannelName` and notify all
 * subscribers. When a message is published to `errorChannelName`, subscribers are notified so they
 * can react to the error condition, but the last-known state is preserved. Triggering the abort
 * signal disconnects the store from the data publisher.
 *
 * Things to note:
 *
 * - `getState()` returns `undefined` until the first notification arrives.
 * - On error, `getState()` continues to return the last known value and `getError()` returns the
 *   error. Only the first error is captured.
 * - The function returned by `subscribe` is idempotent — calling it multiple times is safe.
 *
 * @param config
 *
 * @example
 * ```ts
 * const store = createReactiveStoreFromDataPublisher({
 *     abortSignal: AbortSignal.timeout(10_000),
 *     dataChannelName: 'notification',
 *     dataPublisher,
 *     errorChannelName: 'error',
 * });
 * const unsubscribe = store.subscribe(() => {
 *     console.log('State updated:', store.getState());
 * });
 * ```
 */
export declare function createReactiveStoreFromDataPublisher<TData>({ abortSignal, dataChannelName, dataPublisher, errorChannelName, }: Config): ReactiveStore<TData>;
export {};
//# sourceMappingURL=reactive-store.d.ts.map