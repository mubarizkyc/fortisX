'use strict';

var accounts = require('@solana/accounts');
var addresses = require('@solana/addresses');
var codecs = require('@solana/codecs');
var errors = require('@solana/errors');
var functional = require('@solana/functional');
var instructions = require('@solana/instructions');
var instructionPlans = require('@solana/instruction-plans');
var keys = require('@solana/keys');
var offchainMessages = require('@solana/offchain-messages');
var pluginCore = require('@solana/plugin-core');
var programs = require('@solana/programs');
var rpc = require('@solana/rpc');
var rpcParsedTypes = require('@solana/rpc-parsed-types');
var rpcSubscriptions = require('@solana/rpc-subscriptions');
var rpcTypes = require('@solana/rpc-types');
var signers = require('@solana/signers');
var transactionMessages = require('@solana/transaction-messages');
var transactions = require('@solana/transactions');
var transactionConfirmation = require('@solana/transaction-confirmation');
var rpcSpecTypes = require('@solana/rpc-spec-types');

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
  const getRecentSignatureConfirmationPromise = transactionConfirmation.createRecentSignatureConfirmationPromiseFactory({
    rpc,
    rpcSubscriptions
  });
  async function confirmSignatureOnlyTransaction(config) {
    await transactionConfirmation.waitForRecentTransactionConfirmationUntilTimeout({
      ...config,
      getRecentSignatureConfirmationPromise,
      getTimeoutPromise: transactionConfirmation.getTimeoutPromise
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
    const replaceRecentBlockhash = !transactionMessages.isTransactionMessageWithDurableNonceLifetime(transactionMessage);
    const transaction = functional.pipe(
      transactionMessage,
      (m) => transactionMessages.setTransactionMessageComputeUnitLimit(MAX_COMPUTE_UNIT_LIMIT, m),
      transactions.compileTransaction
    );
    const wireTransactionBytes = transactions.getBase64EncodedWireTransaction(transaction);
    try {
      const response = await rpc.simulateTransaction(wireTransactionBytes, {
        ...simulateConfig,
        encoding: "base64",
        replaceRecentBlockhash,
        sigVerify: false
      }).send({ abortSignal });
      const { err: transactionError, ...simulationResult } = response.value;
      if (simulationResult.unitsConsumed == null) {
        throw new errors.SolanaError(errors.SOLANA_ERROR__TRANSACTION__FAILED_TO_ESTIMATE_COMPUTE_LIMIT);
      }
      if (transactionError) {
        throw new errors.SolanaError(errors.SOLANA_ERROR__TRANSACTION__FAILED_WHEN_SIMULATING_TO_ESTIMATE_COMPUTE_LIMIT, {
          ...simulationResult,
          cause: errors.getSolanaErrorFromTransactionError(transactionError)
        });
      }
      return simulationResult.unitsConsumed > 4294967295n ? 4294967295 : Number(simulationResult.unitsConsumed);
    } catch (e) {
      if (errors.isSolanaError(e, errors.SOLANA_ERROR__TRANSACTION__FAILED_WHEN_SIMULATING_TO_ESTIMATE_COMPUTE_LIMIT)) {
        throw e;
      }
      throw new errors.SolanaError(errors.SOLANA_ERROR__TRANSACTION__FAILED_TO_ESTIMATE_COMPUTE_LIMIT, {
        cause: e
      });
    }
  };
}
function estimateAndSetComputeUnitLimitFactory(estimateComputeUnitLimit) {
  return async function estimateAndSetComputeUnitLimit(transactionMessage, config) {
    const existingLimit = transactionMessages.getTransactionMessageComputeUnitLimit(transactionMessage);
    if (existingLimit && existingLimit !== MAX_COMPUTE_UNIT_LIMIT) {
      return transactionMessage;
    }
    const estimatedUnits = await estimateComputeUnitLimit(transactionMessage, config);
    return transactionMessages.setTransactionMessageComputeUnitLimit(estimatedUnits, transactionMessage);
  };
}
function fillTransactionMessageProvisoryComputeUnitLimit(transactionMessage) {
  if (transactionMessages.getTransactionMessageComputeUnitLimit(transactionMessage) !== void 0) {
    return transactionMessage;
  }
  return transactionMessages.setTransactionMessageComputeUnitLimit(PROVISORY_COMPUTE_UNIT_LIMIT, transactionMessage);
}
async function fetchAddressesForLookupTables(lookupTableAddresses, rpc, config) {
  if (lookupTableAddresses.length === 0) {
    return {};
  }
  const fetchedLookupTables = await accounts.fetchJsonParsedAccounts(
    rpc,
    lookupTableAddresses,
    config
  );
  accounts.assertAccountsDecoded(fetchedLookupTables);
  accounts.assertAccountsExist(fetchedLookupTables);
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
  return transactionMessages.decompileTransactionMessage(compiledTransactionMessage, {
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
    rpcTypes.commitmentComparator(
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
  const base64EncodedWireTransaction = transactions.getBase64EncodedWireTransaction(transaction);
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
  const getNonceInvalidationPromise = transactionConfirmation.createNonceInvalidationPromiseFactory({ rpc, rpcSubscriptions });
  const getRecentSignatureConfirmationPromise = transactionConfirmation.createRecentSignatureConfirmationPromiseFactory({
    rpc,
    rpcSubscriptions
  });
  function createNonceInvalidationPromiseHandlingRaceCondition(signature) {
    return async function wrappedGetNonceInvalidationPromise(config) {
      try {
        return await getNonceInvalidationPromise(config);
      } catch (e) {
        if (errors.isSolanaError(e, errors.SOLANA_ERROR__INVALID_NONCE)) {
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
          if (status.confirmationStatus !== null && rpcTypes.commitmentComparator(status.confirmationStatus, config.commitment) >= 0) {
            if (status.err !== null) {
              throw errors.getSolanaErrorFromTransactionError(status.err);
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
      transactions.getSignatureFromTransaction(config.transaction)
    );
    await transactionConfirmation.waitForDurableNonceTransactionConfirmation({
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
  const getBlockHeightExceedencePromise = transactionConfirmation.createBlockHeightExceedencePromiseFactory({
    rpc,
    rpcSubscriptions
  });
  const getRecentSignatureConfirmationPromise = transactionConfirmation.createRecentSignatureConfirmationPromiseFactory({
    rpc,
    rpcSubscriptions
  });
  async function confirmRecentTransaction(config) {
    await transactionConfirmation.waitForRecentTransactionConfirmation({
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

Object.defineProperty(exports, "createRpcMessage", {
  enumerable: true,
  get: function () { return rpcSpecTypes.createRpcMessage; }
});
exports.airdropFactory = airdropFactory;
exports.createAsyncGeneratorWithInitialValueAndSlotTracking = createAsyncGeneratorWithInitialValueAndSlotTracking;
exports.createReactiveStoreWithInitialValueAndSlotTracking = createReactiveStoreWithInitialValueAndSlotTracking;
exports.decompileTransactionMessageFetchingLookupTables = decompileTransactionMessageFetchingLookupTables;
exports.estimateAndSetComputeUnitLimitFactory = estimateAndSetComputeUnitLimitFactory;
exports.estimateComputeUnitLimitFactory = estimateComputeUnitLimitFactory;
exports.fetchAddressesForLookupTables = fetchAddressesForLookupTables;
exports.fillTransactionMessageProvisoryComputeUnitLimit = fillTransactionMessageProvisoryComputeUnitLimit;
exports.getMinimumBalanceForRentExemption = getMinimumBalanceForRentExemption;
exports.sendAndConfirmDurableNonceTransactionFactory = sendAndConfirmDurableNonceTransactionFactory;
exports.sendAndConfirmTransactionFactory = sendAndConfirmTransactionFactory;
exports.sendTransactionWithoutConfirmingFactory = sendTransactionWithoutConfirmingFactory;
Object.keys(accounts).forEach(function (k) {
  if (k !== 'default' && !Object.prototype.hasOwnProperty.call(exports, k)) Object.defineProperty(exports, k, {
    enumerable: true,
    get: function () { return accounts[k]; }
  });
});
Object.keys(addresses).forEach(function (k) {
  if (k !== 'default' && !Object.prototype.hasOwnProperty.call(exports, k)) Object.defineProperty(exports, k, {
    enumerable: true,
    get: function () { return addresses[k]; }
  });
});
Object.keys(codecs).forEach(function (k) {
  if (k !== 'default' && !Object.prototype.hasOwnProperty.call(exports, k)) Object.defineProperty(exports, k, {
    enumerable: true,
    get: function () { return codecs[k]; }
  });
});
Object.keys(errors).forEach(function (k) {
  if (k !== 'default' && !Object.prototype.hasOwnProperty.call(exports, k)) Object.defineProperty(exports, k, {
    enumerable: true,
    get: function () { return errors[k]; }
  });
});
Object.keys(functional).forEach(function (k) {
  if (k !== 'default' && !Object.prototype.hasOwnProperty.call(exports, k)) Object.defineProperty(exports, k, {
    enumerable: true,
    get: function () { return functional[k]; }
  });
});
Object.keys(instructions).forEach(function (k) {
  if (k !== 'default' && !Object.prototype.hasOwnProperty.call(exports, k)) Object.defineProperty(exports, k, {
    enumerable: true,
    get: function () { return instructions[k]; }
  });
});
Object.keys(instructionPlans).forEach(function (k) {
  if (k !== 'default' && !Object.prototype.hasOwnProperty.call(exports, k)) Object.defineProperty(exports, k, {
    enumerable: true,
    get: function () { return instructionPlans[k]; }
  });
});
Object.keys(keys).forEach(function (k) {
  if (k !== 'default' && !Object.prototype.hasOwnProperty.call(exports, k)) Object.defineProperty(exports, k, {
    enumerable: true,
    get: function () { return keys[k]; }
  });
});
Object.keys(offchainMessages).forEach(function (k) {
  if (k !== 'default' && !Object.prototype.hasOwnProperty.call(exports, k)) Object.defineProperty(exports, k, {
    enumerable: true,
    get: function () { return offchainMessages[k]; }
  });
});
Object.keys(pluginCore).forEach(function (k) {
  if (k !== 'default' && !Object.prototype.hasOwnProperty.call(exports, k)) Object.defineProperty(exports, k, {
    enumerable: true,
    get: function () { return pluginCore[k]; }
  });
});
Object.keys(programs).forEach(function (k) {
  if (k !== 'default' && !Object.prototype.hasOwnProperty.call(exports, k)) Object.defineProperty(exports, k, {
    enumerable: true,
    get: function () { return programs[k]; }
  });
});
Object.keys(rpc).forEach(function (k) {
  if (k !== 'default' && !Object.prototype.hasOwnProperty.call(exports, k)) Object.defineProperty(exports, k, {
    enumerable: true,
    get: function () { return rpc[k]; }
  });
});
Object.keys(rpcParsedTypes).forEach(function (k) {
  if (k !== 'default' && !Object.prototype.hasOwnProperty.call(exports, k)) Object.defineProperty(exports, k, {
    enumerable: true,
    get: function () { return rpcParsedTypes[k]; }
  });
});
Object.keys(rpcSubscriptions).forEach(function (k) {
  if (k !== 'default' && !Object.prototype.hasOwnProperty.call(exports, k)) Object.defineProperty(exports, k, {
    enumerable: true,
    get: function () { return rpcSubscriptions[k]; }
  });
});
Object.keys(rpcTypes).forEach(function (k) {
  if (k !== 'default' && !Object.prototype.hasOwnProperty.call(exports, k)) Object.defineProperty(exports, k, {
    enumerable: true,
    get: function () { return rpcTypes[k]; }
  });
});
Object.keys(signers).forEach(function (k) {
  if (k !== 'default' && !Object.prototype.hasOwnProperty.call(exports, k)) Object.defineProperty(exports, k, {
    enumerable: true,
    get: function () { return signers[k]; }
  });
});
Object.keys(transactionMessages).forEach(function (k) {
  if (k !== 'default' && !Object.prototype.hasOwnProperty.call(exports, k)) Object.defineProperty(exports, k, {
    enumerable: true,
    get: function () { return transactionMessages[k]; }
  });
});
Object.keys(transactions).forEach(function (k) {
  if (k !== 'default' && !Object.prototype.hasOwnProperty.call(exports, k)) Object.defineProperty(exports, k, {
    enumerable: true,
    get: function () { return transactions[k]; }
  });
});
//# sourceMappingURL=index.browser.cjs.map
//# sourceMappingURL=index.browser.cjs.map