/**
 * A function or {@link RegExp} used to test whether a candidate base58-encoded
 * address produced from a generated key pair satisfies the grind criteria.
 *
 * - When a `RegExp` is provided, its literal characters (outside of escape
 *   sequences, character classes, quantifiers, and groups) are validated up
 *   front to ensure they are all in the base58 alphabet. This catches common
 *   typos like `/^ab0/` before any key generation takes place.
 * - When a function is provided, it is used as-is with no validation. Use this
 *   form when you need arbitrary matching logic that falls outside what a
 *   simple regex can express.
 *
 * @see {@link grindKeyPair}
 * @see {@link grindKeyPairs}
 */
export type GrindKeyPairMatches = RegExp | ((address: string) => boolean);
/**
 * Configuration object accepted by {@link grindKeyPairs}.
 *
 * @see {@link grindKeyPairs}
 * @see {@link GrindKeyPairMatches}
 */
export type GrindKeyPairsConfig = Readonly<{
    /**
     * An optional {@link AbortSignal} used to cancel the grind loop. When the
     * signal fires, the returned promise rejects immediately with the signal's
     * reason, even if a batch of key pair generations is still in flight (the
     * in-flight generations are abandoned in the background).
     */
    abortSignal?: AbortSignal;
    /**
     * The number of matching key pairs to return. Defaults to `1`. Values less
     * than or equal to `0` cause the function to return an empty array without
     * generating any key pairs (after validating the `matches` regex, if any).
     */
    amount?: number;
    /**
     * The number of key pairs to generate in parallel per batch. Defaults to
     * `32`. Higher values increase throughput at the cost of more memory
     * pressure per batch.
     */
    concurrency?: number;
    /**
     * Setting this to `true` makes it possible to extract the bytes of the
     * generated private keys using
     * [`crypto.subtle.exportKey()`](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/exportKey).
     * This value is forwarded to the inner {@link generateKeyPair} call and
     * defaults to `false`, which prevents the bytes of the private key from
     * being visible to JS.
     */
    extractable?: boolean;
    /**
     * Either a {@link RegExp} or a predicate function that tests candidate
     * base58-encoded addresses. See {@link GrindKeyPairMatches} for details.
     */
    matches: GrindKeyPairMatches;
}>;
/**
 * Generates multiple Ed25519 key pairs whose base58-encoded public key
 * satisfies the provided `matches` criterion.
 *
 * Key pairs are generated in batches of `concurrency` in parallel and tested
 * against the matcher. The loop continues until `amount` matching key pairs
 * have been found or the provided `abortSignal` is aborted.
 *
 * When `matches` is a {@link RegExp}, its literal characters are validated
 * against the base58 alphabet up front to prevent infinite loops caused by
 * typos (e.g. `/^anza0/`). When `matches` is a function, it is used as-is
 * with no validation.
 *
 * @param config - See {@link GrindKeyPairsConfig}.
 * @returns A promise that resolves to an array of exactly `amount`
 * {@link CryptoKeyPair} instances, each of which satisfies the matcher. When
 * `amount <= 0`, the promise resolves to an empty array.
 *
 * @example
 * Find four key pairs whose address starts with `anza`:
 * ```ts
 * import { grindKeyPairs } from '@solana/keys';
 *
 * const keyPairs = await grindKeyPairs({ matches: /^anza/, amount: 4 });
 * ```
 *
 * @example
 * Use a predicate function for arbitrary matching logic:
 * ```ts
 * import { grindKeyPairs } from '@solana/keys';
 *
 * const keyPairs = await grindKeyPairs({
 *     matches: address => address.startsWith('anza') && address.endsWith('end'),
 *     amount: 2,
 * });
 * ```
 *
 * @example
 * Cancel a long-running grind using an {@link AbortSignal}:
 * ```ts
 * import { grindKeyPairs } from '@solana/keys';
 *
 * const keyPairs = await grindKeyPairs({
 *     matches: /^anza/,
 *     amount: 10,
 *     abortSignal: AbortSignal.timeout(60_000),
 * });
 * ```
 *
 * @see {@link grindKeyPair}
 */
export declare function grindKeyPairs(config: GrindKeyPairsConfig): Promise<CryptoKeyPair[]>;
/**
 * Generates a single Ed25519 key pair whose base58-encoded public key
 * satisfies the provided `matches` criterion. This is the main entry point
 * for mining vanity Solana addresses: the function keeps generating fresh
 * key pairs in parallel batches until one of them matches.
 *
 * When `matches` is a {@link RegExp}, its literal characters (outside of
 * escape sequences, character classes, quantifiers, and groups) are
 * validated against the base58 alphabet up front. This catches common typos
 * such as `/^ab0/` (`0` is not in the base58 alphabet) before any key is
 * generated, preventing a guaranteed infinite loop.
 *
 * When `matches` is a function, it is used as-is with no validation — use
 * this form when you need arbitrary matching logic that cannot be expressed
 * as a regex. Be mindful that if the function can never return `true`, the
 * grind loop will never terminate unless you supply an {@link AbortSignal}.
 *
 * @param config - See {@link GrindKeyPairsConfig}. The `amount` field is
 * omitted because this function always returns a single key pair.
 *
 * @returns A promise that resolves to a {@link CryptoKeyPair} whose
 * base58-encoded public key satisfies the matcher.
 *
 * @throws {@link SOLANA_ERROR__KEYS__INVALID_BASE58_IN_GRIND_REGEX} when the
 * provided regex contains a literal character that is not in the base58
 * alphabet.
 *
 * @throws The `AbortSignal`'s reason when the supplied `abortSignal` is
 * fired (either before the function is called or during the grind loop).
 *
 * @example
 * Mine a vanity address that starts with `anza`:
 * ```ts
 * import { grindKeyPair } from '@solana/keys';
 *
 * const keyPair = await grindKeyPair({ matches: /^anza/ });
 * ```
 *
 * @example
 * Use the `i` flag for case-insensitive matching:
 * ```ts
 * import { grindKeyPair } from '@solana/keys';
 *
 * const keyPair = await grindKeyPair({ matches: /^anza/i });
 * ```
 *
 * @example
 * Use a predicate function for arbitrary matching logic:
 * ```ts
 * import { grindKeyPair } from '@solana/keys';
 *
 * const keyPair = await grindKeyPair({
 *     matches: address => address.startsWith('anza') && address.length === 44,
 * });
 * ```
 *
 * @example
 * Cap the grind at 60 seconds using
 * [`AbortSignal.timeout()`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static):
 * ```ts
 * import { grindKeyPair } from '@solana/keys';
 *
 * const keyPair = await grindKeyPair({
 *     matches: /^anza/,
 *     abortSignal: AbortSignal.timeout(60_000),
 * });
 * ```
 *
 * @example
 * Generate an extractable key pair so you can persist its private key bytes:
 * ```ts
 * import { grindKeyPair } from '@solana/keys';
 *
 * const keyPair = await grindKeyPair({ matches: /^anza/, extractable: true });
 * const privateKeyBytes = new Uint8Array(
 *     await crypto.subtle.exportKey('pkcs8', keyPair.privateKey),
 * );
 * ```
 *
 * @see {@link grindKeyPairs}
 * @see {@link GrindKeyPairsConfig}
 * @see {@link GrindKeyPairMatches}
 * @see {@link generateKeyPair}
 */
export declare function grindKeyPair(config: Omit<GrindKeyPairsConfig, 'amount'>): Promise<CryptoKeyPair>;
//# sourceMappingURL=grind-keypair.d.ts.map