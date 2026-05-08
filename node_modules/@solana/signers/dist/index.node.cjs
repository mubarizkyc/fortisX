'use strict';

var errors = require('@solana/errors');
var instructions = require('@solana/instructions');
var keys = require('@solana/keys');
var addresses = require('@solana/addresses');
var transactions = require('@solana/transactions');
var offchainMessages = require('@solana/offchain-messages');

// src/deduplicate-signers.ts
function deduplicateSigners(signers) {
  const deduplicated = {};
  signers.forEach((signer) => {
    if (!deduplicated[signer.address]) {
      deduplicated[signer.address] = signer;
    } else if (!signersAreEquivalent(deduplicated[signer.address], signer)) {
      throw new errors.SolanaError(errors.SOLANA_ERROR__SIGNER__ADDRESS_CANNOT_HAVE_MULTIPLE_SIGNERS, {
        address: signer.address
      });
    }
  });
  return Object.values(deduplicated);
}
function signersAreEquivalent(a, b) {
  if (a === b) return true;
  const aKeys = Object.getOwnPropertyNames(a);
  const bKeys = Object.getOwnPropertyNames(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => {
    if (!(key in b)) return false;
    const aVal = a[key];
    const bVal = b[key];
    if (typeof aVal === "function" && typeof bVal === "function") {
      return aVal.toString() === bVal.toString();
    }
    return aVal === bVal;
  });
}
function isTransactionModifyingSigner(value) {
  return "modifyAndSignTransactions" in value && typeof value.modifyAndSignTransactions === "function";
}
function assertIsTransactionModifyingSigner(value) {
  if (!isTransactionModifyingSigner(value)) {
    throw new errors.SolanaError(errors.SOLANA_ERROR__SIGNER__EXPECTED_TRANSACTION_MODIFYING_SIGNER, {
      address: value.address
    });
  }
}
function isTransactionPartialSigner(value) {
  return "signTransactions" in value && typeof value.signTransactions === "function";
}
function assertIsTransactionPartialSigner(value) {
  if (!isTransactionPartialSigner(value)) {
    throw new errors.SolanaError(errors.SOLANA_ERROR__SIGNER__EXPECTED_TRANSACTION_PARTIAL_SIGNER, {
      address: value.address
    });
  }
}
function isTransactionSendingSigner(value) {
  return "signAndSendTransactions" in value && typeof value.signAndSendTransactions === "function";
}
function assertIsTransactionSendingSigner(value) {
  if (!isTransactionSendingSigner(value)) {
    throw new errors.SolanaError(errors.SOLANA_ERROR__SIGNER__EXPECTED_TRANSACTION_SENDING_SIGNER, {
      address: value.address
    });
  }
}

// src/transaction-signer.ts
function isTransactionSigner(value) {
  return isTransactionPartialSigner(value) || isTransactionModifyingSigner(value) || isTransactionSendingSigner(value);
}
function assertIsTransactionSigner(value) {
  if (!isTransactionSigner(value)) {
    throw new errors.SolanaError(errors.SOLANA_ERROR__SIGNER__EXPECTED_TRANSACTION_SIGNER, {
      address: value.address
    });
  }
}

// src/account-signer-meta.ts
function getSignersFromInstruction(instruction) {
  return deduplicateSigners(
    (instruction.accounts ?? []).flatMap((account) => "signer" in account ? account.signer : [])
  );
}
function getSignersFromTransactionMessage(transaction) {
  return deduplicateSigners([
    ...transaction.feePayer && isTransactionSigner(transaction.feePayer) ? [transaction.feePayer] : [],
    ...transaction.instructions.flatMap(getSignersFromInstruction)
  ]);
}
function addSignersToInstruction(signers, instruction) {
  if (!instruction.accounts || instruction.accounts.length === 0) {
    return instruction;
  }
  const signerByAddress = new Map(deduplicateSigners(signers).map((signer) => [signer.address, signer]));
  return Object.freeze({
    ...instruction,
    accounts: instruction.accounts.map((account) => {
      const signer = signerByAddress.get(account.address);
      if (!instructions.isSignerRole(account.role) || "signer" in account || !signer) {
        return account;
      }
      return Object.freeze({ ...account, signer });
    })
  });
}
function addSignersToTransactionMessage(signers, transactionMessage) {
  const feePayerSigner = hasAddressOnlyFeePayer(transactionMessage) ? signers.find((signer) => signer.address === transactionMessage.feePayer.address) : void 0;
  if (!feePayerSigner && transactionMessage.instructions.length === 0) {
    return transactionMessage;
  }
  return Object.freeze({
    ...transactionMessage,
    ...feePayerSigner ? { feePayer: feePayerSigner } : null,
    instructions: transactionMessage.instructions.map((instruction) => addSignersToInstruction(signers, instruction))
  });
}
function hasAddressOnlyFeePayer(message) {
  return !!message && "feePayer" in message && !!message.feePayer && typeof message.feePayer.address === "string" && !isTransactionSigner(message.feePayer);
}

// src/fee-payer-signer.ts
function setTransactionMessageFeePayerSigner(feePayer, transactionMessage) {
  Object.freeze(feePayer);
  const out = { ...transactionMessage, feePayer };
  Object.freeze(out);
  return out;
}
function isMessagePartialSigner(value) {
  return "signMessages" in value && typeof value.signMessages === "function";
}
function assertIsMessagePartialSigner(value) {
  if (!isMessagePartialSigner(value)) {
    throw new errors.SolanaError(errors.SOLANA_ERROR__SIGNER__EXPECTED_MESSAGE_PARTIAL_SIGNER, {
      address: value.address
    });
  }
}

// src/keypair-signer.ts
function isKeyPairSigner(value) {
  return "keyPair" in value && typeof value.keyPair === "object" && isMessagePartialSigner(value) && isTransactionPartialSigner(value);
}
function assertIsKeyPairSigner(value) {
  if (!isKeyPairSigner(value)) {
    throw new errors.SolanaError(errors.SOLANA_ERROR__SIGNER__EXPECTED_KEY_PAIR_SIGNER, {
      address: value.address
    });
  }
}
async function createSignerFromKeyPair(keyPair) {
  const address = await addresses.getAddressFromPublicKey(keyPair.publicKey);
  const out = {
    address,
    keyPair,
    signMessages: (messages) => Promise.all(
      messages.map(
        async (message) => Object.freeze({ [address]: await keys.signBytes(keyPair.privateKey, message.content) })
      )
    ),
    signTransactions: (transactions$1) => Promise.all(
      transactions$1.map(async (transaction) => {
        const signedTransaction = await transactions.partiallySignTransaction([keyPair], transaction);
        return Object.freeze({ [address]: signedTransaction.signatures[address] });
      })
    )
  };
  return Object.freeze(out);
}
async function generateKeyPairSigner(extractable = false) {
  return await createSignerFromKeyPair(await keys.generateKeyPair(extractable));
}
async function createKeyPairSignerFromBytes(bytes, extractable) {
  return await createSignerFromKeyPair(await keys.createKeyPairFromBytes(bytes, extractable));
}
async function createKeyPairSignerFromPrivateKeyBytes(bytes, extractable) {
  return await createSignerFromKeyPair(await keys.createKeyPairFromPrivateKeyBytes(bytes, extractable));
}

// src/grind-keypair-signer.ts
async function grindKeyPairSigners(config) {
  const keyPairs = await keys.grindKeyPairs(config);
  return await Promise.all(keyPairs.map(createSignerFromKeyPair));
}
async function grindKeyPairSigner(config) {
  const [signer] = await grindKeyPairSigners({ ...config, amount: 1 });
  return signer;
}
function isMessageModifyingSigner(value) {
  return addresses.isAddress(value.address) && "modifyAndSignMessages" in value && typeof value.modifyAndSignMessages === "function";
}
function assertIsMessageModifyingSigner(value) {
  if (!isMessageModifyingSigner(value)) {
    throw new errors.SolanaError(errors.SOLANA_ERROR__SIGNER__EXPECTED_MESSAGE_MODIFYING_SIGNER, {
      address: value.address
    });
  }
}
function isMessageSigner(value) {
  return isMessagePartialSigner(value) || isMessageModifyingSigner(value);
}
function assertIsMessageSigner(value) {
  if (!isMessageSigner(value)) {
    throw new errors.SolanaError(errors.SOLANA_ERROR__SIGNER__EXPECTED_MESSAGE_SIGNER, {
      address: value.address
    });
  }
}

// src/noop-signer.ts
function createNoopSigner(address) {
  const out = {
    address,
    signMessages: (messages) => Promise.resolve(messages.map(() => Object.freeze({}))),
    signTransactions: (transactions) => Promise.resolve(transactions.map(() => Object.freeze({})))
  };
  return Object.freeze(out);
}

// src/offchain-message-signer.ts
function getSignersFromOffchainMessage({
  requiredSignatories
}) {
  const messageSigners = requiredSignatories.filter(isMessageSigner);
  return deduplicateSigners(messageSigners);
}
async function partiallySignOffchainMessageWithSigners(offchainMessage, config) {
  const { partialSigners, modifyingSigners } = categorizeMessageSigners(
    getSignersFromOffchainMessage(offchainMessage)
  );
  return await signModifyingAndPartialMessageSigners(offchainMessage, modifyingSigners, partialSigners, config);
}
async function signOffchainMessageWithSigners(offchainMessage, config) {
  const signedOffchainMessageEnvelope = await partiallySignOffchainMessageWithSigners(offchainMessage, config);
  offchainMessages.assertIsFullySignedOffchainMessageEnvelope(signedOffchainMessageEnvelope);
  return signedOffchainMessageEnvelope;
}
function categorizeMessageSigners(signers) {
  const modifyingSigners = identifyMessageModifyingSigners(signers);
  const partialSigners = signers.filter(isMessagePartialSigner).filter((signer) => !modifyingSigners.includes(signer));
  return Object.freeze({ modifyingSigners, partialSigners });
}
function identifyMessageModifyingSigners(signers) {
  const modifyingSigners = signers.filter(isMessageModifyingSigner);
  if (modifyingSigners.length === 0) return [];
  const nonPartialSigners = modifyingSigners.filter((signer) => !isMessagePartialSigner(signer));
  if (nonPartialSigners.length > 0) return nonPartialSigners;
  return [modifyingSigners[0]];
}
async function signModifyingAndPartialMessageSigners(offchainMessage, modifyingSigners = [], partialSigners = [], config) {
  const offchainMessageEnvelope = offchainMessages.compileOffchainMessageEnvelope(offchainMessage);
  const modifiedOffchainMessage = await modifyingSigners.reduce(async (offchainMessageEnvelope2, modifyingSigner) => {
    config?.abortSignal?.throwIfAborted();
    const [message] = await modifyingSigner.modifyAndSignMessages([await offchainMessageEnvelope2], config);
    return Object.freeze(message);
  }, Promise.resolve(offchainMessageEnvelope));
  config?.abortSignal?.throwIfAborted();
  const signatureDictionaries = await Promise.all(
    partialSigners.map(async (partialSigner) => {
      const [signatures] = await partialSigner.signMessages([modifiedOffchainMessage], config);
      return signatures;
    })
  );
  return Object.freeze({
    ...modifiedOffchainMessage,
    signatures: Object.freeze(
      signatureDictionaries.reduce((signatures, signatureDictionary) => {
        return { ...signatures, ...signatureDictionary };
      }, modifiedOffchainMessage.signatures ?? {})
    )
  });
}
function isTransactionMessageWithSingleSendingSigner(transaction) {
  try {
    assertIsTransactionMessageWithSingleSendingSigner(transaction);
    return true;
  } catch {
    return false;
  }
}
function assertIsTransactionMessageWithSingleSendingSigner(transaction) {
  assertContainsResolvableTransactionSendingSigner(getSignersFromTransactionMessage(transaction));
}
function assertContainsResolvableTransactionSendingSigner(signers) {
  const sendingSigners = signers.filter(isTransactionSendingSigner);
  if (sendingSigners.length === 0) {
    throw new errors.SolanaError(errors.SOLANA_ERROR__SIGNER__TRANSACTION_SENDING_SIGNER_MISSING);
  }
  const sendingOnlySigners = sendingSigners.filter(
    (signer) => !isTransactionPartialSigner(signer) && !isTransactionModifyingSigner(signer)
  );
  if (sendingOnlySigners.length > 1) {
    throw new errors.SolanaError(errors.SOLANA_ERROR__SIGNER__TRANSACTION_CANNOT_HAVE_MULTIPLE_SENDING_SIGNERS);
  }
}

// src/sign-transaction.ts
async function partiallySignTransactionMessageWithSigners(transactionMessage, config) {
  return await partiallySignTransactionWithSigners(
    getSignersFromTransactionMessage(transactionMessage).filter(
      (signer) => isTransactionModifyingSigner(signer) || isTransactionPartialSigner(signer)
    ),
    transactions.compileTransaction(transactionMessage),
    config
  );
}
async function signTransactionMessageWithSigners(transactionMessage, config) {
  const signedTransaction = await partiallySignTransactionMessageWithSigners(transactionMessage, config);
  transactions.assertIsFullySignedTransaction(signedTransaction);
  return signedTransaction;
}
async function signAndSendTransactionMessageWithSigners(transaction, config) {
  return await signAndSendTransactionWithSigners(
    getSignersFromTransactionMessage(transaction).filter(isTransactionSigner),
    transactions.compileTransaction(transaction),
    config
  );
}
async function partiallySignTransactionWithSigners(signers, transaction, config) {
  const { partialSigners, modifyingSigners } = categorizeTransactionSigners(deduplicateSigners(signers), {
    identifySendingSigner: false
  });
  return await signModifyingAndPartialTransactionSigners(transaction, modifyingSigners, partialSigners, config);
}
async function signTransactionWithSigners(signers, transaction, config) {
  const signedTransaction = await partiallySignTransactionWithSigners(signers, transaction, config);
  transactions.assertIsFullySignedTransaction(signedTransaction);
  return signedTransaction;
}
async function signAndSendTransactionWithSigners(signers, transaction, config) {
  assertContainsResolvableTransactionSendingSigner(signers);
  const abortSignal = config?.abortSignal;
  const { partialSigners, modifyingSigners, sendingSigner } = categorizeTransactionSigners(
    deduplicateSigners(signers)
  );
  abortSignal?.throwIfAborted();
  const signedTransaction = await signModifyingAndPartialTransactionSigners(
    transaction,
    modifyingSigners,
    partialSigners,
    config
  );
  if (!sendingSigner) {
    throw new errors.SolanaError(errors.SOLANA_ERROR__SIGNER__TRANSACTION_SENDING_SIGNER_MISSING);
  }
  abortSignal?.throwIfAborted();
  const [signature] = await sendingSigner.signAndSendTransactions([signedTransaction], config);
  abortSignal?.throwIfAborted();
  return signature;
}
function categorizeTransactionSigners(signers, config = {}) {
  const identifySendingSigner = config.identifySendingSigner ?? true;
  const sendingSigner = identifySendingSigner ? identifyTransactionSendingSigner(signers) : null;
  const otherSigners = signers.filter(
    (signer) => signer !== sendingSigner && (isTransactionModifyingSigner(signer) || isTransactionPartialSigner(signer))
  );
  const modifyingSigners = identifyTransactionModifyingSigners(otherSigners);
  const partialSigners = otherSigners.filter(isTransactionPartialSigner).filter((signer) => !modifyingSigners.includes(signer));
  return Object.freeze({ modifyingSigners, partialSigners, sendingSigner });
}
function identifyTransactionSendingSigner(signers) {
  const sendingSigners = signers.filter(isTransactionSendingSigner);
  if (sendingSigners.length === 0) return null;
  const sendingOnlySigners = sendingSigners.filter(
    (signer) => !isTransactionModifyingSigner(signer) && !isTransactionPartialSigner(signer)
  );
  if (sendingOnlySigners.length > 0) {
    return sendingOnlySigners[0];
  }
  return sendingSigners[0];
}
function identifyTransactionModifyingSigners(signers) {
  const modifyingSigners = signers.filter(isTransactionModifyingSigner);
  if (modifyingSigners.length === 0) return [];
  const nonPartialSigners = modifyingSigners.filter((signer) => !isTransactionPartialSigner(signer));
  if (nonPartialSigners.length > 0) return nonPartialSigners;
  return [modifyingSigners[0]];
}
async function signModifyingAndPartialTransactionSigners(transaction, modifyingSigners = [], partialSigners = [], config) {
  const modifiedTransaction = await modifyingSigners.reduce(
    async (transaction2, modifyingSigner) => {
      config?.abortSignal?.throwIfAborted();
      const [tx] = await modifyingSigner.modifyAndSignTransactions([await transaction2], config);
      return Object.freeze(tx);
    },
    Promise.resolve(transaction)
  );
  config?.abortSignal?.throwIfAborted();
  const signatureDictionaries = await Promise.all(
    partialSigners.map(async (partialSigner) => {
      const [signatures] = await partialSigner.signTransactions([modifiedTransaction], config);
      return signatures;
    })
  );
  return Object.freeze({
    ...modifiedTransaction,
    signatures: Object.freeze(
      signatureDictionaries.reduce((signatures, signatureDictionary) => {
        return { ...signatures, ...signatureDictionary };
      }, modifiedTransaction.signatures ?? {})
    )
  });
}
var o = globalThis.TextEncoder;

// src/signable-message.ts
function createSignableMessage(content, signatures = {}) {
  return Object.freeze({
    content: typeof content === "string" ? new o().encode(content) : content,
    signatures: Object.freeze({ ...signatures })
  });
}
async function writeKeyPairSigner(signer, path, config) {
  return await keys.writeKeyPair(signer.keyPair, path, config);
}

exports.addSignersToInstruction = addSignersToInstruction;
exports.addSignersToTransactionMessage = addSignersToTransactionMessage;
exports.assertContainsResolvableTransactionSendingSigner = assertContainsResolvableTransactionSendingSigner;
exports.assertIsKeyPairSigner = assertIsKeyPairSigner;
exports.assertIsMessageModifyingSigner = assertIsMessageModifyingSigner;
exports.assertIsMessagePartialSigner = assertIsMessagePartialSigner;
exports.assertIsMessageSigner = assertIsMessageSigner;
exports.assertIsTransactionMessageWithSingleSendingSigner = assertIsTransactionMessageWithSingleSendingSigner;
exports.assertIsTransactionModifyingSigner = assertIsTransactionModifyingSigner;
exports.assertIsTransactionPartialSigner = assertIsTransactionPartialSigner;
exports.assertIsTransactionSendingSigner = assertIsTransactionSendingSigner;
exports.assertIsTransactionSigner = assertIsTransactionSigner;
exports.createKeyPairSignerFromBytes = createKeyPairSignerFromBytes;
exports.createKeyPairSignerFromPrivateKeyBytes = createKeyPairSignerFromPrivateKeyBytes;
exports.createNoopSigner = createNoopSigner;
exports.createSignableMessage = createSignableMessage;
exports.createSignerFromKeyPair = createSignerFromKeyPair;
exports.generateKeyPairSigner = generateKeyPairSigner;
exports.getSignersFromInstruction = getSignersFromInstruction;
exports.getSignersFromOffchainMessage = getSignersFromOffchainMessage;
exports.getSignersFromTransactionMessage = getSignersFromTransactionMessage;
exports.grindKeyPairSigner = grindKeyPairSigner;
exports.grindKeyPairSigners = grindKeyPairSigners;
exports.isKeyPairSigner = isKeyPairSigner;
exports.isMessageModifyingSigner = isMessageModifyingSigner;
exports.isMessagePartialSigner = isMessagePartialSigner;
exports.isMessageSigner = isMessageSigner;
exports.isTransactionMessageWithSingleSendingSigner = isTransactionMessageWithSingleSendingSigner;
exports.isTransactionModifyingSigner = isTransactionModifyingSigner;
exports.isTransactionPartialSigner = isTransactionPartialSigner;
exports.isTransactionSendingSigner = isTransactionSendingSigner;
exports.isTransactionSigner = isTransactionSigner;
exports.partiallySignOffchainMessageWithSigners = partiallySignOffchainMessageWithSigners;
exports.partiallySignTransactionMessageWithSigners = partiallySignTransactionMessageWithSigners;
exports.partiallySignTransactionWithSigners = partiallySignTransactionWithSigners;
exports.setTransactionMessageFeePayerSigner = setTransactionMessageFeePayerSigner;
exports.signAndSendTransactionMessageWithSigners = signAndSendTransactionMessageWithSigners;
exports.signAndSendTransactionWithSigners = signAndSendTransactionWithSigners;
exports.signOffchainMessageWithSigners = signOffchainMessageWithSigners;
exports.signTransactionMessageWithSigners = signTransactionMessageWithSigners;
exports.signTransactionWithSigners = signTransactionWithSigners;
exports.writeKeyPairSigner = writeKeyPairSigner;
//# sourceMappingURL=index.node.cjs.map
//# sourceMappingURL=index.node.cjs.map