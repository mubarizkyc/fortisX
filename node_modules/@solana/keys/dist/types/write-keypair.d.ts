/**
 * Configuration options for {@link writeKeyPair} and {@link writeKeyPairSigner}.
 */
export type WriteKeyPairConfig = Readonly<{
    /**
     * When `true`, allows the write to overwrite an existing file at the destination path.
     * Defaults to `false`, in which case attempting to write to a path that already exists
     * will throw an `EEXIST` error.
     *
     * **DANGER:** Overwriting an existing key pair file with a different key pair
     * permanently destroys the previous key and, with it, access to any funds or
     * onchain state controlled by that address. This action is irreversible.
     * Only enable this option if you are certain the existing file is disposable.
     */
    unsafelyOverwriteExistingKeyPair?: boolean;
}>;
/**
 * Writes an extractable {@link CryptoKeyPair} to disk as a JSON array of 64 bytes, matching
 * the format produced by `solana-keygen`. The first 32 bytes are the raw Ed25519 seed
 * (private key) and the last 32 bytes are the raw public key.
 *
 * Any missing parent directories are created automatically. The written file uses mode
 * `0600` (owner read/write only) to match `solana-keygen`.
 *
 * This helper requires a writable filesystem and will throw in environments that don't
 * provide one (such as browsers or React Native).
 *
 * @param keyPair - An extractable {@link CryptoKeyPair}. Both the private and public keys
 * must have been created with `extractable: true`.
 * @param path - The destination path on disk.
 * @param config - See {@link WriteKeyPairConfig}.
 *
 * @throws A {@link SolanaError} of code
 * {@link SOLANA_ERROR__KEYS__WRITE_KEY_PAIR_UNSUPPORTED_ENVIRONMENT | `SOLANA_ERROR__KEYS__WRITE_KEY_PAIR_UNSUPPORTED_ENVIRONMENT`}
 * when called in an environment without a writable filesystem.
 * @throws A {@link SolanaError} of code
 * {@link SOLANA_ERROR__SUBTLE_CRYPTO__CANNOT_EXPORT_NON_EXTRACTABLE_KEY | `SOLANA_ERROR__SUBTLE_CRYPTO__CANNOT_EXPORT_NON_EXTRACTABLE_KEY`}
 * when either the private or public key is not extractable.
 *
 * @example
 * ```ts
 * import { generateKeyPair, writeKeyPair } from '@solana/keys';
 *
 * // Generate an extractable key pair so its bytes can be persisted.
 * const keyPair = await generateKeyPair(true);
 * await writeKeyPair(keyPair, './my-keypair.json');
 * ```
 *
 * @example
 * Overwriting an existing file requires an explicit opt-in, because doing so permanently
 * destroys the previous key and any funds controlled by it:
 * ```ts
 * import { writeKeyPair } from '@solana/keys';
 *
 * await writeKeyPair(keyPair, './my-keypair.json', {
 *     unsafelyOverwriteExistingKeyPair: true,
 * });
 * ```
 *
 * @see {@link createKeyPairFromBytes} — the inverse helper that loads a key pair from a
 * 64-byte buffer.
 * @see {@link writeKeyPairSigner} — the signer-flavored variant from `@solana/signers`.
 */
export declare function writeKeyPair(keyPair: CryptoKeyPair, path: string, config?: WriteKeyPairConfig): Promise<void>;
//# sourceMappingURL=write-keypair.d.ts.map