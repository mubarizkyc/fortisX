import { SignatureBytes } from '@solana/keys';
import { TransactionMessage, TransactionMessageWithFeePayer } from '@solana/transaction-messages';
import { SendableTransaction, Transaction, TransactionWithinSizeLimit, TransactionWithLifetime } from '@solana/transactions';
import { TransactionMessageWithSigners } from './account-signer-meta';
import { TransactionModifyingSigner } from './transaction-modifying-signer';
import { TransactionPartialSigner, TransactionPartialSignerConfig } from './transaction-partial-signer';
import { TransactionSendingSignerConfig } from './transaction-sending-signer';
import { TransactionSigner } from './transaction-signer';
/**
 * Extracts all {@link TransactionSigner | TransactionSigners} inside the provided
 * transaction message and uses them to return a signed transaction.
 *
 * It first uses all {@link TransactionModifyingSigner | TransactionModifyingSigners} sequentially before
 * using all {@link TransactionPartialSigner | TransactionPartialSigners} in parallel.
 *
 * If a composite signer implements both interfaces, it will be used as a
 * {@link TransactionModifyingSigner} if no other signer implements that interface.
 * Otherwise, it will be used as a {@link TransactionPartialSigner}.
 *
 * @example
 * ```ts
 * const signedTransaction = await partiallySignTransactionMessageWithSigners(transactionMessage);
 * ```
 *
 * It also accepts an optional {@link AbortSignal} that will be propagated to all signers.
 *
 * ```ts
 * const signedTransaction = await partiallySignTransactionMessageWithSigners(transactionMessage, {
 *     abortSignal: myAbortController.signal,
 * });
 * ```
 *
 * @remarks
 * Finally, note that this function ignores {@link TransactionSendingSigner | TransactionSendingSigners}
 * as it does not send the transaction. Check out the {@link signAndSendTransactionMessageWithSigners}
 * function for more details on how to use sending signers.
 *
 * @see {@link partiallySignTransactionWithSigners}
 * @see {@link signTransactionMessageWithSigners}
 * @see {@link signAndSendTransactionMessageWithSigners}
 */
export declare function partiallySignTransactionMessageWithSigners(transactionMessage: TransactionMessage & TransactionMessageWithFeePayer & TransactionMessageWithSigners, config?: TransactionPartialSignerConfig): Promise<Transaction & TransactionWithinSizeLimit & TransactionWithLifetime>;
/**
 * Extracts all {@link TransactionSigner | TransactionSigners} inside the provided
 * transaction message and uses them to return a signed transaction before asserting
 * that all signatures required by the transaction are present.
 *
 * This function delegates to the {@link partiallySignTransactionMessageWithSigners} function
 * in order to extract signers from the transaction message and sign the transaction.
 *
 * @example
 * ```ts
 * const mySignedTransaction = await signTransactionMessageWithSigners(myTransactionMessage);
 *
 * // With additional config.
 * const mySignedTransaction = await signTransactionMessageWithSigners(myTransactionMessage, {
 *     abortSignal: myAbortController.signal,
 * });
 *
 * // We now know the transaction is fully signed.
 * mySignedTransaction satisfies FullySignedTransaction;
 * ```
 *
 * @see {@link signTransactionWithSigners}
 * @see {@link partiallySignTransactionMessageWithSigners}
 * @see {@link signAndSendTransactionMessageWithSigners}
 */
export declare function signTransactionMessageWithSigners(transactionMessage: TransactionMessage & TransactionMessageWithFeePayer & TransactionMessageWithSigners, config?: TransactionPartialSignerConfig): Promise<SendableTransaction & Transaction & TransactionWithLifetime>;
/**
 * Extracts all {@link TransactionSigner | TransactionSigners} inside the provided
 * transaction message and uses them to sign it before sending it immediately to the blockchain.
 *
 * It returns the signature of the sent transaction (i.e. its identifier) as bytes.
 *
 * @example
 * ```ts
 * import { signAndSendTransactionMessageWithSigners } from '@solana/signers';
 *
 * const transactionSignature = await signAndSendTransactionMessageWithSigners(transactionMessage);
 *
 * // With additional config.
 * const transactionSignature = await signAndSendTransactionMessageWithSigners(transactionMessage, {
 *     abortSignal: myAbortController.signal,
 * });
 * ```
 *
 * @remarks
 * Similarly to the {@link partiallySignTransactionMessageWithSigners} function, it first uses all
 * {@link TransactionModifyingSigner | TransactionModifyingSigners} sequentially before using all
 * {@link TransactionPartialSigner | TransactionPartialSigners} in parallel.
 * It then sends the transaction using the {@link TransactionSendingSigner} it identified.
 *
 * Composite transaction signers are treated such that at least one sending signer is used if any.
 * When a {@link TransactionSigner} implements more than one interface, we use it as a:
 *
 * - {@link TransactionSendingSigner}, if no other {@link TransactionSendingSigner} exists.
 * - {@link TransactionModifyingSigner}, if no other {@link TransactionModifyingSigner} exists.
 * - {@link TransactionPartialSigner}, otherwise.
 *
 * The provided transaction must contain exactly one {@link TransactionSendingSigner} inside its account metas.
 * If more than one composite signers implement the {@link TransactionSendingSigner} interface,
 * one of them will be selected as the sending signer. Otherwise, if multiple
 * {@link TransactionSendingSigner | TransactionSendingSigners} must be selected, the function will throw an error.
 *
 * If you'd like to assert that a transaction makes use of exactly one {@link TransactionSendingSigner}
 * _before_ calling this function, you may use the {@link assertIsTransactionMessageWithSingleSendingSigner} function.
 *
 * Alternatively, you may use the {@link isTransactionMessageWithSingleSendingSigner} function to provide a
 * fallback in case the transaction does not contain any sending signer.
 *
 * @see {@link signAndSendTransactionWithSigners}
 * @see {@link assertIsTransactionMessageWithSingleSendingSigner}
 * @see {@link isTransactionMessageWithSingleSendingSigner}
 * @see {@link partiallySignTransactionMessageWithSigners}
 * @see {@link signTransactionMessageWithSigners}
 *
 */
export declare function signAndSendTransactionMessageWithSigners(transaction: TransactionMessage & TransactionMessageWithFeePayer & TransactionMessageWithSigners, config?: TransactionSendingSignerConfig): Promise<SignatureBytes>;
/**
 * Signs a transaction using the provided {@link TransactionModifyingSigner | TransactionModifyingSigners}
 * and {@link TransactionPartialSigner | TransactionPartialSigners}.
 *
 * It first uses all {@link TransactionModifyingSigner | TransactionModifyingSigners} sequentially before
 * using all {@link TransactionPartialSigner | TransactionPartialSigners} in parallel.
 *
 * If a composite signer implements both interfaces, it will be used as a
 * {@link TransactionModifyingSigner} if no other signer implements that interface.
 * Otherwise, it will be used as a {@link TransactionPartialSigner}.
 *
 * @param signers - The signers to use. Only {@link TransactionModifyingSigner} and
 * {@link TransactionPartialSigner} interfaces are accepted.
 * @param transaction - The compiled transaction to sign.
 * @param config - Optional configuration including an {@link AbortSignal}.
 * @returns The signed transaction.
 *
 * @example
 * ```ts
 * const signedTransaction = await partiallySignTransactionWithSigners(mySigners, compiledTransaction);
 * ```
 *
 * It also accepts an optional {@link AbortSignal} that will be propagated to all signers.
 *
 * ```ts
 * const signedTransaction = await partiallySignTransactionWithSigners(mySigners, compiledTransaction, {
 *     abortSignal: myAbortController.signal,
 * });
 * ```
 *
 * @see {@link signTransactionWithSigners}
 * @see {@link signAndSendTransactionWithSigners}
 * @see {@link partiallySignTransactionMessageWithSigners}
 */
export declare function partiallySignTransactionWithSigners(signers: readonly (TransactionModifyingSigner | TransactionPartialSigner)[], transaction: Transaction, config?: TransactionPartialSignerConfig): Promise<Transaction & TransactionWithinSizeLimit & TransactionWithLifetime>;
/**
 * Signs a transaction using the provided signers and asserts that all
 * signatures required by the transaction are present.
 *
 * This function delegates to {@link partiallySignTransactionWithSigners} to sign
 * the transaction, then asserts it is fully signed before returning.
 *
 * @param signers - The signers to use. Only {@link TransactionModifyingSigner} and
 * {@link TransactionPartialSigner} interfaces are accepted.
 * @param transaction - The compiled transaction to sign.
 * @param config - Optional configuration including an {@link AbortSignal}.
 * @returns The fully signed transaction.
 *
 * @example
 * ```ts
 * const mySignedTransaction = await signTransactionWithSigners(mySigners, compiledTransaction);
 *
 * // With additional config.
 * const mySignedTransaction = await signTransactionWithSigners(mySigners, compiledTransaction, {
 *     abortSignal: myAbortController.signal,
 * });
 *
 * // We now know the transaction is fully signed.
 * mySignedTransaction satisfies FullySignedTransaction;
 * ```
 *
 * @see {@link partiallySignTransactionWithSigners}
 * @see {@link signAndSendTransactionWithSigners}
 * @see {@link signTransactionMessageWithSigners}
 */
export declare function signTransactionWithSigners(signers: readonly (TransactionModifyingSigner | TransactionPartialSigner)[], transaction: Transaction, config?: TransactionPartialSignerConfig): Promise<SendableTransaction & Transaction & TransactionWithLifetime>;
/**
 * Signs a transaction using the provided signers and sends it immediately to the blockchain.
 *
 * It returns the signature of the sent transaction (i.e. its identifier) as bytes.
 *
 * Similarly to {@link partiallySignTransactionWithSigners}, it first uses all
 * {@link TransactionModifyingSigner | TransactionModifyingSigners} sequentially before using all
 * {@link TransactionPartialSigner | TransactionPartialSigners} in parallel.
 * It then sends the transaction using the {@link TransactionSendingSigner} it identified.
 *
 * Composite transaction signers are treated such that at least one sending signer is used if any.
 * When a {@link TransactionSigner} implements more than one interface, we use it as a:
 *
 * - {@link TransactionSendingSigner}, if no other {@link TransactionSendingSigner} exists.
 * - {@link TransactionModifyingSigner}, if no other {@link TransactionModifyingSigner} exists.
 * - {@link TransactionPartialSigner}, otherwise.
 *
 * The provided signers must contain exactly one {@link TransactionSendingSigner} that can be
 * unambiguously resolved. If more than one composite signers implement the
 * {@link TransactionSendingSigner} interface, one of them will be selected as the sending signer.
 * Otherwise, if multiple {@link TransactionSendingSigner | TransactionSendingSigners} must be
 * selected, the function will throw an error.
 *
 * @param signers - The signers to use. Must contain at least one resolvable
 * {@link TransactionSendingSigner}.
 * @param transaction - The compiled transaction to sign and send.
 * @param config - Optional configuration including an {@link AbortSignal}.
 * @returns The signature of the sent transaction as bytes.
 *
 * @example
 * ```ts
 * const transactionSignature = await signAndSendTransactionWithSigners(mySigners, compiledTransaction);
 *
 * // With additional config.
 * const transactionSignature = await signAndSendTransactionWithSigners(mySigners, compiledTransaction, {
 *     abortSignal: myAbortController.signal,
 * });
 * ```
 *
 * @see {@link assertContainsResolvableTransactionSendingSigner}
 * @see {@link partiallySignTransactionWithSigners}
 * @see {@link signTransactionWithSigners}
 * @see {@link signAndSendTransactionMessageWithSigners}
 */
export declare function signAndSendTransactionWithSigners(signers: readonly TransactionSigner[], transaction: Transaction, config?: TransactionSendingSignerConfig): Promise<SignatureBytes>;
//# sourceMappingURL=sign-transaction.d.ts.map