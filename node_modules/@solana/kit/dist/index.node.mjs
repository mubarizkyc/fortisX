import { fetchJsonParsedAccounts, assertAccountsDecoded, assertAccountsExist } from '@solana/accounts';
export * from '@solana/accounts';
export * from '@solana/addresses';
export * from '@solana/codecs';
import { SolanaError, SOLANA_ERROR__TRANSACTION__FAILED_TO_ESTIMATE_COMPUTE_LIMIT, SOLANA_ERROR__TRANSACTION__FAILED_WHEN_SIMULATING_TO_ESTIMATE_COMPUTE_LIMIT, getSolanaErrorFromTransactionError, isSolanaError, SOLANA_ERROR__INVALID_NONCE } from '@solana/errors';
export * from '@solana/errors';
import { pipe } from '@solana/functional';
export * from '@solana/functional';
export * from '@solana/instructions';
export * from '@solana/instruction-plans';
export * from '@solana/keys';
export * from '@solana/offchain-messages';
export * from '@solana/plugin-core';
export * from '@solana/programs';
export * from '@solana/rpc';
export * from '@solana/rpc-parsed-types';
export * from '@solana/rpc-subscriptions';
import { commitmentComparator } from '@solana/rpc-types';
export * from '@solana/rpc-types';
export * from '@solana/signers';
import { isTransactionMessageWithDurableNonceLifetime, setTransactionMessageComputeUnitLimit, getTransactionMessageComputeUnitLimit, decompileTransactionMessage } from '@solana/transaction-messages';
export * from '@solana/transaction-messages';
import { compileTransaction, getBase64EncodedWireTransaction, getSignatureFromTransaction } from '@solana/transactions';
export * from '@solana/transactions';
import { createRecentSignatureConfirmationPromiseFactory, createNonceInvalidationPromiseFactory, createBlockHeightExceedencePromiseFactory, waitForRecentTransactionConfirmationUntilTimeout, getTimeoutPromise, waitForDurableNonceTransactionConfirmation, waitForRecentTransactionConfirmation } from '@solana/transaction-confirmation';
export { createRpcMessage } from '@solana/rpc-spec-types';

// src/index.ts

// src/create-async-generator-with-initial-value-and-slot-tracking.ts
async function* createAsyncGeneratorWithInitialValueAndSlotTracking({
  abortSignal,
  rpcRequest,
  rpcValueMapper,
  rpcSubscriptionRequest,
  rpcSubscriptionValueMapper
}) {
  if (abortSignal.aborted) return;
  let lastUpdateSlot = -1n;
  const queue = [];
  let waitingResolve = null;
  let waitingReject = null;
  let rpcDone = false;
  let subscriptionDone = false;
  let done = false;
  let pendingError;
  function markSourcesDone() {
    done = true;
    if (waitingResolve) {
      const resolve = waitingResolve;
      waitingResolve = null;
      waitingReject = null;
      resolve({ done: true, value: void 0 });
    }
  }
  const abortController = new AbortController();
  const signal = abortController.signal;
  function onAbort() {
    done = true;
    abortController.abort(abortSignal.reason);
    if (waitingResolve) {
      const resolve = waitingResolve;
      waitingResolve = null;
      waitingReject = null;
      resolve({ done: true, value: void 0 });
    }
  }
  abortSignal.addEventListener("abort", onAbort);
  function enqueue(item) {
    if (done || signal.aborted) return;
    if (waitingResolve) {
      const resolve = waitingResolve;
      waitingResolve = null;
      waitingReject = null;
      resolve({ done: false, value: item });
    } else {
      queue.push(item);
    }
  }
  function handleError(err) {
    if (signal.aborted) return;
    done = true;
    pendingError = err;
    abortController.abort(err);
    if (waitingReject) {
      const reject = waitingReject;
      waitingResolve = null;
      waitingReject = null;
      reject(err);
    }
  }
  rpcRequest.send({ abortSignal: signal }).then(({ context: { slot }, value }) => {
    if (signal.aborted) return;
    if (slot < lastUpdateSlot) return;
    lastUpdateSlot = slot;
    enqueue({ context: { slot }, value: rpcValueMapper(value) });
  }).then(() => {
    rpcDone = true;
    if (subscriptionDone) markSourcesDone();
  }).catch(handleError);
  rpcSubscriptionRequest.subscribe({ abortSignal: signal }).then(async (notifications) => {
    for await (const {
      context: { slot },
      value
    } of notifications) {
      if (signal.aborted) return;
      if (slot < lastUpdateSlot) continue;
      lastUpdateSlot = slot;
      enqueue({ context: { slot }, value: rpcSubscriptionValueMapper(value) });
    }
    subscriptionDone = true;
    if (rpcDone) markSourcesDone();
  }).catch(handleError);
  try {
    while (true) {
      if (pendingError) throw pendingError;
      if (queue.length > 0) {
        yield queue.shift();
      } else if (done) {
        return;
      } else {
        const result = await new Promise((resolve, reject) => {
          waitingResolve = resolve;
          waitingReject = reject;
        });
        if (result.done) return;
        yield result.value;
      }
    }
  } finally {
    abortSignal.removeEventListener("abort", onAbort);
    if (!signal.aborted) {
      abortController.abort();
    }
  }
}

// src/create-reactive-store-with-initial-value-and-slot-tracking.ts
function createReactiveStoreWithInitialValueAndSlotTracking({
  abortSignal,
  rpcRequest,
  rpcValueMapper,
  rpcSubscriptionRequest,
  rpcSubscriptionValueMapper
}) {
  let currentState;
  let currentError;
  let lastUpdateSlot = -1n;
  const subscribers = /* @__PURE__ */ new Set();
  const abortController = new AbortController();
  abortSignal.addEventListener("abort", () => abortController.abort(abortSignal.reason));
  const signal = abortController.signal;
  function notifySubscribers() {
    subscribers.forEach((cb) => cb());
  }
  function handleError(err) {
    if (signal.aborted) return;
    if (currentError !== void 0) return;
    currentError = err;
    abortController.abort(err);
    notifySubscribers();
  }
  rpcRequest.send({ abortSignal: signal }).then(({ context: { slot }, value }) => {
    if (signal.aborted) return;
    if (slot < lastUpdateSlot) return;
    lastUpdateSlot = slot;
    currentState = { context: { slot }, value: rpcValueMapper(value) };
    notifySubscribers();
  }).catch(handleError);
  rpcSubscriptionRequest.subscribe({ abortSignal: signal }).then(async (notifications) => {
    for await (const {
      context: { slot },
      value
    } of notifications) {
      if (signal.aborted) return;
      if (slot < lastUpdateSlot) continue;
      lastUpdateSlot = slot;
      currentState = {
        context: { slot },
        value: rpcSubscriptionValueMapper(value)
      };
      notifySubscribers();
    }
  }).catch(handleError);
  return {
    getError() {
      return currentError;
    },
    getState() {
      return currentState;
    },
    subscribe(callback) {
      subscribers.add(callback);
      return () => {
        subscribers.delete(callback);
      };
    }
  };
}

// src/airdrop-internal.ts
async function requestAndConfirmAirdrop_INTERNAL_ONLY_DO_NOT_EXPORT({
  abortSignal,
  commitment,
  confirmSignatureOnlyTransaction,
  lamports,
  recipientAddress,
  rpc
}) {
  const airdropTransactionSignature = await rpc.requestAirdrop(recipientAddress, lamports, { commitment }).send({ abortSignal });
  await confirmSignatureOnlyTransaction({
    abortSignal,
    commitment,
    signature: airdropTransactionSignature
  });
  return airdropTransactionSignature;
}

// src/airdrop.ts
function airdropFactory({
  rpc,
  rpcSubscriptions
}) {
  const getRecentSignatureConfirmationPromise = createRecentSignatureConfirmationPromiseFactory({
    rpc,
    rpcSubscriptions
  });
  async function confirmSignatureOnlyTransaction(config) {
    await waitForRecentTransactionConfirmationUntilTimeout({
      ...config,
      getRecentSignatureConfirmationPromise,
      getTimeoutPromise
    });
  }
  return async function airdrop(config) {
    return await requestAndConfirmAirdrop_INTERNAL_ONLY_DO_NOT_EXPORT({
      ...config,
      confirmSignatureOnlyTransaction,
      rpc
    });
  };
}
var PROVISORY_COMPUTE_UNIT_LIMIT = 0;
var MAX_COMPUTE_UNIT_LIMIT = 14e5;
function estimateComputeUnitLimitFactory({
  rpc
}) {
  return async function estimateComputeUnitLimit(transactionMessage, config) {
    const { abortSignal, ...simulateConfig } = config ?? {};
    const replaceRecentBlockhash = !isTransactionMessageWithDurableNonceLifetime(transactionMessage);
    const transaction = pipe(
      transactionMessage,
      (m) => setTransactionMessageComputeUnitLimit(MAX_COMPUTE_UNIT_LIMIT, m),
      compileTransaction
    );
    const wireTransactionBytes = getBase64EncodedWireTransaction(transaction);
    try {
      const response = await rpc.simulateTransaction(wireTransactionBytes, {
        ...simulateConfig,
        encoding: "base64",
        replaceRecentBlockhash,
        sigVerify: false
      }).send({ abortSignal });
      const { err: transactionError, ...simulationResult } = response.value;
      if (simulationResult.unitsConsumed == null) {
        throw new SolanaError(SOLANA_ERROR__TRANSACTION__FAILED_TO_ESTIMATE_COMPUTE_LIMIT);
      }
      if (transactionError) {
        throw new SolanaError(SOLANA_ERROR__TRANSACTION__FAILED_WHEN_SIMULATING_TO_ESTIMATE_COMPUTE_LIMIT, {
          ...simulationResult,
          cause: getSolanaErrorFromTransactionError(transactionError)
        });
      }
      return simulationResult.unitsConsumed > 4294967295n ? 4294967295 : Number(simulationResult.unitsConsumed);
    } catch (e) {
      if (isSolanaError(e, SOLANA_ERROR__TRANSACTION__FAILED_WHEN_SIMULATING_TO_ESTIMATE_COMPUTE_LIMIT)) {
        throw e;
      }
      throw new SolanaError(SOLANA_ERROR__TRANSACTION__FAILED_TO_ESTIMATE_COMPUTE_LIMIT, {
        cause: e
      });
    }
  };
}
function estimateAndSetComputeUnitLimitFactory(estimateComputeUnitLimit) {
  return async function estimateAndSetComputeUnitLimit(transactionMessage, config) {
    const existingLimit = getTransactionMessageComputeUnitLimit(transactionMessage);
    if (existingLimit && existingLimit !== MAX_COMPUTE_UNIT_LIMIT) {
      return transactionMessage;
    }
    const estimatedUnits = await estimateComputeUnitLimit(transactionMessage, config);
    return setTransactionMessageComputeUnitLimit(estimatedUnits, transactionMessage);
  };
}
function fillTransactionMessageProvisoryComputeUnitLimit(transactionMessage) {
  if (getTransactionMessageComputeUnitLimit(transactionMessage) !== void 0) {
    return transactionMessage;
  }
  return setTransactionMessageComputeUnitLimit(PROVISORY_COMPUTE_UNIT_LIMIT, transactionMessage);
}
async function fetchAddressesForLookupTables(lookupTableAddresses, rpc, config) {
  if (lookupTableAddresses.length === 0) {
    return {};
  }
  const fetchedLookupTables = await fetchJsonParsedAccounts(
    rpc,
    lookupTableAddresses,
    config
  );
  assertAccountsDecoded(fetchedLookupTables);
  assertAccountsExist(fetchedLookupTables);
  return fetchedLookupTables.reduce((acc, lookup) => {
    return {
      ...acc,
      [lookup.address]: lookup.data.addresses
    };
  }, {});
}

// src/decompile-transaction-message-fetching-lookup-tables.ts
async function decompileTransactionMessageFetchingLookupTables(compiledTransactionMessage, rpc, config) {
  const lookupTables = "addressTableLookups" in compiledTransactionMessage && compiledTransactionMessage.addressTableLookups !== void 0 && compiledTransactionMessage.addressTableLookups.length > 0 ? compiledTransactionMessage.addressTableLookups : [];
  const lookupTableAddresses = lookupTables.map((l) => l.lookupTableAddress);
  const { lastValidBlockHeight, ...fetchAccountsConfig } = config ?? {};
  const addressesByLookupTableAddress = lookupTableAddresses.length > 0 ? await fetchAddressesForLookupTables(lookupTableAddresses, rpc, fetchAccountsConfig) : {};
  return decompileTransactionMessage(compiledTransactionMessage, {
    addressesByLookupTableAddress,
    lastValidBlockHeight
  });
}

// src/get-minimum-balance-for-rent-exemption.ts
function getMinimumBalanceForRentExemption(space) {
  const RENT = {
    ACCOUNT_STORAGE_OVERHEAD: 128n,
    DEFAULT_EXEMPTION_THRESHOLD: 2n,
    DEFAULT_LAMPORTS_PER_BYTE_YEAR: 3480n
  };
  const requiredLamports = (RENT.ACCOUNT_STORAGE_OVERHEAD + space) * RENT.DEFAULT_LAMPORTS_PER_BYTE_YEAR * RENT.DEFAULT_EXEMPTION_THRESHOLD;
  return requiredLamports;
}
function getSendTransactionConfigWithAdjustedPreflightCommitment(commitment, config) {
  if (
    // The developer has supplied no value for `preflightCommitment`.
    !config?.preflightCommitment && // The value of `commitment` is lower than the server default of `preflightCommitment`.
    commitmentComparator(
      commitment,
      "finalized"
      /* default value of `preflightCommitment` */
    ) < 0
  ) {
    return {
      ...config,
      // In the common case, it is unlikely that you want to simulate a transaction at
      // `finalized` commitment when your standard of commitment for confirming the
      // transaction is lower. Cap the simulation commitment level to the level of the
      // confirmation commitment.
      preflightCommitment: commitment
    };
  }
  return config;
}
async function sendTransaction_INTERNAL_ONLY_DO_NOT_EXPORT({
  abortSignal,
  commitment,
  rpc,
  transaction,
  ...sendTransactionConfig
}) {
  const base64EncodedWireTransaction = getBase64EncodedWireTransaction(transaction);
  return await rpc.sendTransaction(base64EncodedWireTransaction, {
    ...getSendTransactionConfigWithAdjustedPreflightCommitment(commitment, sendTransactionConfig),
    encoding: "base64"
  }).send({ abortSignal });
}
async function sendAndConfirmDurableNonceTransaction_INTERNAL_ONLY_DO_NOT_EXPORT({
  abortSignal,
  commitment,
  confirmDurableNonceTransaction,
  rpc,
  transaction,
  ...sendTransactionConfig
}) {
  const transactionSignature = await sendTransaction_INTERNAL_ONLY_DO_NOT_EXPORT({
    ...sendTransactionConfig,
    abortSignal,
    commitment,
    rpc,
    transaction
  });
  await confirmDurableNonceTransaction({
    abortSignal,
    commitment,
    transaction
  });
  return transactionSignature;
}
async function sendAndConfirmTransactionWithBlockhashLifetime_INTERNAL_ONLY_DO_NOT_EXPORT({
  abortSignal,
  commitment,
  confirmRecentTransaction,
  rpc,
  transaction,
  ...sendTransactionConfig
}) {
  const transactionSignature = await sendTransaction_INTERNAL_ONLY_DO_NOT_EXPORT({
    ...sendTransactionConfig,
    abortSignal,
    commitment,
    rpc,
    transaction
  });
  await confirmRecentTransaction({
    abortSignal,
    commitment,
    transaction
  });
  return transactionSignature;
}

// src/send-and-confirm-durable-nonce-transaction.ts
function sendAndConfirmDurableNonceTransactionFactory({
  rpc,
  rpcSubscriptions
}) {
  const getNonceInvalidationPromise = createNonceInvalidationPromiseFactory({ rpc, rpcSubscriptions });
  const getRecentSignatureConfirmationPromise = createRecentSignatureConfirmationPromiseFactory({
    rpc,
    rpcSubscriptions
  });
  function createNonceInvalidationPromiseHandlingRaceCondition(signature) {
    return async function wrappedGetNonceInvalidationPromise(config) {
      try {
        return await getNonceInvalidationPromise(config);
      } catch (e) {
        if (isSolanaError(e, SOLANA_ERROR__INVALID_NONCE)) {
          let status;
          try {
            const { value: statuses } = await rpc.getSignatureStatuses([signature]).send({ abortSignal: config.abortSignal });
            status = statuses[0];
          } catch {
            throw e;
          }
          if (status === null || status === void 0) {
            throw e;
          }
          if (status.confirmationStatus !== null && commitmentComparator(status.confirmationStatus, config.commitment) >= 0) {
            if (status.err !== null) {
              throw getSolanaErrorFromTransactionError(status.err);
            }
            return;
          }
          return await new Promise(() => {
          });
        }
        throw e;
      }
    };
  }
  async function confirmDurableNonceTransaction(config) {
    const wrappedGetNonceInvalidationPromise = createNonceInvalidationPromiseHandlingRaceCondition(
      getSignatureFromTransaction(config.transaction)
    );
    await waitForDurableNonceTransactionConfirmation({
      ...config,
      getNonceInvalidationPromise: wrappedGetNonceInvalidationPromise,
      getRecentSignatureConfirmationPromise
    });
  }
  return async function sendAndConfirmDurableNonceTransaction(transaction, config) {
    await sendAndConfirmDurableNonceTransaction_INTERNAL_ONLY_DO_NOT_EXPORT({
      ...config,
      confirmDurableNonceTransaction,
      rpc,
      transaction
    });
  };
}
function sendAndConfirmTransactionFactory({
  rpc,
  rpcSubscriptions
}) {
  const getBlockHeightExceedencePromise = createBlockHeightExceedencePromiseFactory({
    rpc,
    rpcSubscriptions
  });
  const getRecentSignatureConfirmationPromise = createRecentSignatureConfirmationPromiseFactory({
    rpc,
    rpcSubscriptions
  });
  async function confirmRecentTransaction(config) {
    await waitForRecentTransactionConfirmation({
      ...config,
      getBlockHeightExceedencePromise,
      getRecentSignatureConfirmationPromise
    });
  }
  return async function sendAndConfirmTransaction(transaction, config) {
    await sendAndConfirmTransactionWithBlockhashLifetime_INTERNAL_ONLY_DO_NOT_EXPORT({
      ...config,
      confirmRecentTransaction,
      rpc,
      transaction
    });
  };
}

// src/send-transaction-without-confirming.ts
function sendTransactionWithoutConfirmingFactory({
  rpc
}) {
  return async function sendTransactionWithoutConfirming(transaction, config) {
    await sendTransaction_INTERNAL_ONLY_DO_NOT_EXPORT({
      ...config,
      rpc,
      transaction
    });
  };
}

export { airdropFactory, createAsyncGeneratorWithInitialValueAndSlotTracking, createReactiveStoreWithInitialValueAndSlotTracking, decompileTransactionMessageFetchingLookupTables, estimateAndSetComputeUnitLimitFactory, estimateComputeUnitLimitFactory, fetchAddressesForLookupTables, fillTransactionMessageProvisoryComputeUnitLimit, getMinimumBalanceForRentExemption, sendAndConfirmDurableNonceTransactionFactory, sendAndConfirmTransactionFactory, sendTransactionWithoutConfirmingFactory };
//# sourceMappingURL=index.node.mjs.map
//# sourceMappingURL=index.node.mjs.map