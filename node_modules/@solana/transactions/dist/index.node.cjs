'use strict';

var addresses = require('@solana/addresses');
var codecsCore = require('@solana/codecs-core');
var codecsDataStructures = require('@solana/codecs-data-structures');
var codecsNumbers = require('@solana/codecs-numbers');
var errors = require('@solana/errors');
var transactionMessages = require('@solana/transaction-messages');
var rpcTypes = require('@solana/rpc-types');
var codecsStrings = require('@solana/codecs-strings');
var keys = require('@solana/keys');

// src/codecs/transaction-codec.ts
function getSignaturesToEncode(signaturesMap) {
  const signatures = Object.values(signaturesMap);
  if (signatures.length === 0) {
    throw new errors.SolanaError(errors.SOLANA_ERROR__TRANSACTION__CANNOT_ENCODE_WITH_EMPTY_SIGNATURES);
  }
  return signatures.map((signature) => {
    if (!signature) {
      return new Uint8Array(64).fill(0);
    }
    return signature;
  });
}
function getSignaturesEncoderWithSizePrefix() {
  return codecsCore.transformEncoder(
    codecsDataStructures.getArrayEncoder(codecsCore.fixEncoderSize(codecsDataStructures.getBytesEncoder(), 64), { size: codecsNumbers.getShortU16Encoder() }),
    getSignaturesToEncode
  );
}
function getSignaturesEncoderWithLength(size) {
  return codecsCore.transformEncoder(
    codecsDataStructures.getArrayEncoder(codecsCore.fixEncoderSize(codecsDataStructures.getBytesEncoder(), 64), { description: "signatures", size }),
    getSignaturesToEncode
  );
}

// src/codecs/transaction-codec.ts
var SIGNATURE_COUNT_FLAG_MASK = 128;
var VERSION_FLAG_MASK = 127;
function getEnvelopeShapeFromMessageBytes(messageBytes) {
  if (messageBytes.length === 0) {
    throw new errors.SolanaError(errors.SOLANA_ERROR__TRANSACTION__CANNOT_ENCODE_WITH_EMPTY_MESSAGE_BYTES);
  }
  const version = transactionMessages.getTransactionVersionDecoder().decode(messageBytes);
  return version === 1 ? "messageFirst" : "signaturesFirst";
}
function getEnvelopeShapeFromTransactionBytes(transactionBytes) {
  if (transactionBytes.length === 0) {
    throw new errors.SolanaError(errors.SOLANA_ERROR__TRANSACTION__CANNOT_DECODE_EMPTY_TRANSACTION_BYTES);
  }
  const firstByte = transactionBytes[0];
  if ((firstByte & SIGNATURE_COUNT_FLAG_MASK) === 0) {
    return "signaturesFirst";
  }
  const version = firstByte & VERSION_FLAG_MASK;
  if (version === 0) {
    throw new errors.SolanaError(errors.SOLANA_ERROR__TRANSACTION__VERSION_ZERO_MUST_BE_ENCODED_WITH_SIGNATURES_FIRST, {
      firstByte,
      transactionBytes
    });
  }
  if (version === 1) {
    return "messageFirst";
  }
  throw new errors.SolanaError(errors.SOLANA_ERROR__TRANSACTION__VERSION_NUMBER_NOT_SUPPORTED, {
    unsupportedVersion: version
  });
}
function getTransactionEncoder() {
  return codecsDataStructures.getPredicateEncoder(
    (transaction) => getEnvelopeShapeFromMessageBytes(transaction.messageBytes) === "signaturesFirst",
    getTransactionEncoderWithSignaturesFirst(),
    getTransactionEncoderWithMessageFirst()
  );
}
function getTransactionEncoderWithSignaturesFirst() {
  return codecsDataStructures.getStructEncoder([
    ["signatures", getSignaturesEncoderWithSizePrefix()],
    ["messageBytes", codecsDataStructures.getBytesEncoder()]
  ]);
}
function getSignatureCountForVersionedOrThrow(messageBytes, offset) {
  if (messageBytes.length < offset + 2) {
    throw new errors.SolanaError(errors.SOLANA_ERROR__TRANSACTION__MALFORMED_MESSAGE_BYTES, {
      messageBytes
    });
  }
  return messageBytes[offset + 1];
}
function getTransactionEncoderWithMessageFirst() {
  const bytesEncoder = codecsDataStructures.getBytesEncoder();
  return codecsCore.createEncoder({
    getSizeFromValue: (transaction) => {
      const signatureCount = getSignatureCountForVersionedOrThrow(transaction.messageBytes, 0);
      return transaction.messageBytes.length + signatureCount * 64;
    },
    write: (transaction, bytes, offset) => {
      offset = bytesEncoder.write(transaction.messageBytes, bytes, offset);
      const signatureCount = getSignatureCountForVersionedOrThrow(transaction.messageBytes, 0);
      const signaturesEncoder = getSignaturesEncoderWithLength(signatureCount);
      offset = signaturesEncoder.write(transaction.signatures, bytes, offset);
      return offset;
    }
  });
}
function getTransactionDecoder() {
  return codecsDataStructures.getPredicateDecoder(
    (transactionBytes) => getEnvelopeShapeFromTransactionBytes(transactionBytes) === "signaturesFirst",
    getTransactionDecoderWithSignaturesFirst(),
    getTransactionDecoderWithMessageFirst()
  );
}
function getTransactionDecoderWithSignaturesFirst() {
  return codecsCore.transformDecoder(
    codecsDataStructures.getStructDecoder([
      ["signatures", codecsDataStructures.getArrayDecoder(codecsCore.fixDecoderSize(codecsDataStructures.getBytesDecoder(), 64), { size: codecsNumbers.getShortU16Decoder() })],
      ["messageBytes", codecsDataStructures.getBytesDecoder()]
    ]),
    decodePartiallyDecodedLegacyOrV0Transaction
  );
}
function getTransactionDecoderWithMessageFirst() {
  return codecsCore.transformDecoder(
    getPartiallyDecodedTransactionDecoderWithMessageFirst(),
    decodePartiallyDecodedV1Transaction
  );
}
function getPartiallyDecodedTransactionDecoderWithMessageFirst() {
  return codecsCore.createDecoder({
    read(bytes, offset) {
      const signatureCount = getSignatureCountForVersionedOrThrow(bytes, offset);
      const signatureByteLength = signatureCount * 64;
      const messageBytesLength = bytes.length - offset - signatureByteLength;
      if (messageBytesLength < 0) {
        throw new errors.SolanaError(errors.SOLANA_ERROR__TRANSACTION__SIGNATURE_COUNT_TOO_HIGH_FOR_TRANSACTION_BYTES, {
          numExpectedSignatures: signatureCount,
          transactionBytes: bytes.subarray(offset),
          transactionBytesLength: bytes.length - offset
        });
      }
      const messageBytes = bytes.subarray(offset, offset + messageBytesLength);
      const [signatures, finalOffset] = codecsDataStructures.getArrayDecoder(codecsCore.fixDecoderSize(codecsDataStructures.getBytesDecoder(), 64), {
        size: signatureCount
      }).read(bytes, offset + messageBytesLength);
      return [
        {
          messageBytes,
          signatures
        },
        finalOffset
      ];
    }
  });
}
function getTransactionCodec() {
  return codecsCore.combineCodec(getTransactionEncoder(), getTransactionDecoder());
}
function decodePartiallyDecodedLegacyOrV0Transaction(transaction) {
  const { messageBytes, signatures } = transaction;
  const signerAddressesDecoder = codecsDataStructures.getTupleDecoder([
    // read transaction version
    transactionMessages.getTransactionVersionDecoder(),
    // read first byte of header, `numSignerAccounts`
    // padRight to skip the next 2 bytes, `numReadOnlySignedAccounts` and `numReadOnlyUnsignedAccounts` which we don't need
    codecsCore.padRightDecoder(codecsNumbers.getU8Decoder(), 2),
    // read static addresses
    codecsDataStructures.getArrayDecoder(addresses.getAddressDecoder(), { size: codecsNumbers.getShortU16Decoder() })
  ]);
  const [_txVersion, numRequiredSignatures, staticAddresses] = signerAddressesDecoder.decode(messageBytes);
  const signerAddresses = staticAddresses.slice(0, numRequiredSignatures);
  if (signerAddresses.length !== signatures.length) {
    throw new errors.SolanaError(errors.SOLANA_ERROR__TRANSACTION__MESSAGE_SIGNATURES_MISMATCH, {
      numRequiredSignatures,
      signaturesLength: signatures.length,
      signerAddresses
    });
  }
  const signaturesMap = makeSignaturesMap(signerAddresses, signatures);
  return {
    messageBytes,
    signatures: Object.freeze(signaturesMap)
  };
}
function decodePartiallyDecodedV1Transaction(transaction) {
  const { messageBytes, signatures } = transaction;
  const numRequiredSignatures = messageBytes[1];
  const staticAddressOffset = 1 + 3 + 4 + 32 + 1 + 1;
  const signerAddresses = codecsDataStructures.getArrayDecoder(addresses.getAddressDecoder(), { size: numRequiredSignatures }).decode(
    messageBytes,
    staticAddressOffset
  );
  if (signerAddresses.length !== signatures.length) {
    throw new errors.SolanaError(errors.SOLANA_ERROR__TRANSACTION__MESSAGE_SIGNATURES_MISMATCH, {
      numRequiredSignatures,
      signaturesLength: signatures.length,
      signerAddresses
    });
  }
  const signaturesMap = makeSignaturesMap(signerAddresses, signatures);
  return {
    messageBytes,
    signatures: signaturesMap
  };
}
function makeSignaturesMap(signerAddresses, signatures) {
  const signaturesMap = {};
  signerAddresses.forEach((address, index) => {
    const signatureForAddress = signatures[index];
    if (signatureForAddress.every((b) => b === 0)) {
      signaturesMap[address] = null;
    } else {
      signaturesMap[address] = signatureForAddress;
    }
  });
  return Object.freeze(signaturesMap);
}
var SYSTEM_PROGRAM_ADDRESS = "11111111111111111111111111111111";
function compiledV1InstructionIsAdvanceNonceInstruction(instructionHeader, instructionPayload, staticAddresses) {
  return staticAddresses[instructionHeader.programAccountIndex] === SYSTEM_PROGRAM_ADDRESS && // Test for `AdvanceNonceAccount` instruction data
  isAdvanceNonceAccountInstructionData(instructionPayload.instructionData) && // Test for exactly 3 accounts
  instructionHeader.numInstructionAccounts === 3;
}
function compiledLegacyInstructionIsAdvanceNonceInstruction(instruction, staticAddresses) {
  return staticAddresses[instruction.programAddressIndex] === SYSTEM_PROGRAM_ADDRESS && // Test for `AdvanceNonceAccount` instruction data
  instruction.data != null && isAdvanceNonceAccountInstructionData(instruction.data) && // Test for exactly 3 accounts
  instruction.accountIndices?.length === 3;
}
function isAdvanceNonceAccountInstructionData(data) {
  return data.byteLength === 4 && data[0] === 4 && data[1] === 0 && data[2] === 0 && data[3] === 0;
}
async function getTransactionLifetimeConstraintFromCompiledTransactionMessage(compiledTransactionMessage) {
  const { version } = compiledTransactionMessage;
  if (version === "legacy" || version === 0) {
    const firstInstruction = compiledTransactionMessage.instructions[0];
    const { staticAccounts } = compiledTransactionMessage;
    if (firstInstruction && compiledLegacyInstructionIsAdvanceNonceInstruction(firstInstruction, staticAccounts)) {
      const nonceAccountAddress = staticAccounts[firstInstruction.accountIndices[0]];
      if (!nonceAccountAddress) {
        throw new errors.SolanaError(errors.SOLANA_ERROR__TRANSACTION__NONCE_ACCOUNT_CANNOT_BE_IN_LOOKUP_TABLE, {
          nonce: compiledTransactionMessage.lifetimeToken
        });
      }
      return {
        nonce: compiledTransactionMessage.lifetimeToken,
        nonceAccountAddress
      };
    } else {
      return {
        blockhash: compiledTransactionMessage.lifetimeToken,
        // This is not known from the compiled message, so we set it to the maximum possible value
        lastValidBlockHeight: 0xffffffffffffffffn
      };
    }
  }
  if (version === 1) {
    const firstInstructionHeader = compiledTransactionMessage.instructionHeaders[0];
    const firstInstructionPayload = compiledTransactionMessage.instructionPayloads[0];
    const { staticAccounts } = compiledTransactionMessage;
    if (firstInstructionHeader && firstInstructionPayload && compiledV1InstructionIsAdvanceNonceInstruction(
      firstInstructionHeader,
      firstInstructionPayload,
      staticAccounts
    )) {
      const nonceAccountAddress = staticAccounts[firstInstructionPayload.instructionAccountIndices[0]];
      if (!nonceAccountAddress) {
        throw new errors.SolanaError(errors.SOLANA_ERROR__TRANSACTION__INVALID_NONCE_ACCOUNT_INDEX, {
          nonce: compiledTransactionMessage.lifetimeToken,
          nonceAccountIndex: firstInstructionPayload.instructionAccountIndices[0],
          numberOfStaticAccounts: staticAccounts.length
        });
      }
      return {
        nonce: compiledTransactionMessage.lifetimeToken,
        nonceAccountAddress
      };
    } else {
      return {
        blockhash: compiledTransactionMessage.lifetimeToken,
        // This is not known from the compiled message, so we set it to the maximum possible value
        lastValidBlockHeight: 0xffffffffffffffffn
      };
    }
  }
  throw new errors.SolanaError(errors.SOLANA_ERROR__TRANSACTION__VERSION_NUMBER_NOT_SUPPORTED, {
    unsupportedVersion: version
  });
}
function isTransactionWithBlockhashLifetime(transaction) {
  return "lifetimeConstraint" in transaction && "blockhash" in transaction.lifetimeConstraint && typeof transaction.lifetimeConstraint.blockhash === "string" && typeof transaction.lifetimeConstraint.lastValidBlockHeight === "bigint" && rpcTypes.isBlockhash(transaction.lifetimeConstraint.blockhash);
}
function assertIsTransactionWithBlockhashLifetime(transaction) {
  if (!isTransactionWithBlockhashLifetime(transaction)) {
    throw new errors.SolanaError(errors.SOLANA_ERROR__TRANSACTION__EXPECTED_BLOCKHASH_LIFETIME);
  }
}
function isTransactionWithDurableNonceLifetime(transaction) {
  return "lifetimeConstraint" in transaction && "nonce" in transaction.lifetimeConstraint && typeof transaction.lifetimeConstraint.nonce === "string" && typeof transaction.lifetimeConstraint.nonceAccountAddress === "string" && addresses.isAddress(transaction.lifetimeConstraint.nonceAccountAddress);
}
function assertIsTransactionWithDurableNonceLifetime(transaction) {
  if (!isTransactionWithDurableNonceLifetime(transaction)) {
    throw new errors.SolanaError(errors.SOLANA_ERROR__TRANSACTION__EXPECTED_NONCE_LIFETIME);
  }
}
function compileTransaction(transactionMessage) {
  const compiledMessage = transactionMessages.compileTransactionMessage(transactionMessage);
  const messageBytes = transactionMessages.getCompiledTransactionMessageEncoder().encode(compiledMessage);
  const transactionSigners = compiledMessage.staticAccounts.slice(0, compiledMessage.header.numSignerAccounts);
  const signatures = {};
  for (const signerAddress of transactionSigners) {
    signatures[signerAddress] = null;
  }
  let lifetimeConstraint;
  if (transactionMessages.isTransactionMessageWithBlockhashLifetime(transactionMessage)) {
    lifetimeConstraint = {
      blockhash: transactionMessage.lifetimeConstraint.blockhash,
      lastValidBlockHeight: transactionMessage.lifetimeConstraint.lastValidBlockHeight
    };
  } else if (transactionMessages.isTransactionMessageWithDurableNonceLifetime(transactionMessage)) {
    lifetimeConstraint = {
      nonce: transactionMessage.lifetimeConstraint.nonce,
      nonceAccountAddress: transactionMessage.instructions[0].accounts[0].address
    };
  }
  return Object.freeze({
    ...lifetimeConstraint ? { lifetimeConstraint } : void 0,
    messageBytes,
    signatures: Object.freeze(signatures)
  });
}
var base58Decoder;
function getSignatureFromTransaction(transaction) {
  if (!base58Decoder) base58Decoder = codecsStrings.getBase58Decoder();
  const signatureBytes = Object.values(transaction.signatures)[0];
  if (!signatureBytes) {
    throw new errors.SolanaError(errors.SOLANA_ERROR__TRANSACTION__FEE_PAYER_SIGNATURE_MISSING);
  }
  const transactionSignature = base58Decoder.decode(signatureBytes);
  return transactionSignature;
}
async function partiallySignTransaction(keyPairs, transaction) {
  let newSignatures;
  let unexpectedSigners;
  await Promise.all(
    keyPairs.map(async (keyPair) => {
      const address = await addresses.getAddressFromPublicKey(keyPair.publicKey);
      const existingSignature = transaction.signatures[address];
      if (existingSignature === void 0) {
        unexpectedSigners ||= /* @__PURE__ */ new Set();
        unexpectedSigners.add(address);
        return;
      }
      if (unexpectedSigners) {
        return;
      }
      const newSignature = await keys.signBytes(keyPair.privateKey, transaction.messageBytes);
      if (existingSignature !== null && codecsCore.bytesEqual(newSignature, existingSignature)) {
        return;
      }
      newSignatures ||= {};
      newSignatures[address] = newSignature;
    })
  );
  if (unexpectedSigners && unexpectedSigners.size > 0) {
    const expectedSigners = Object.keys(transaction.signatures);
    throw new errors.SolanaError(errors.SOLANA_ERROR__TRANSACTION__ADDRESSES_CANNOT_SIGN_TRANSACTION, {
      expectedAddresses: expectedSigners,
      unexpectedAddresses: [...unexpectedSigners]
    });
  }
  if (!newSignatures) {
    return transaction;
  }
  return Object.freeze({
    ...transaction,
    signatures: Object.freeze({
      ...transaction.signatures,
      ...newSignatures
    })
  });
}
async function signTransaction(keyPairs, transaction) {
  const out = await partiallySignTransaction(keyPairs, transaction);
  assertIsFullySignedTransaction(out);
  Object.freeze(out);
  return out;
}
function isFullySignedTransaction(transaction) {
  return Object.entries(transaction.signatures).every(([_, signatureBytes]) => !!signatureBytes);
}
function assertIsFullySignedTransaction(transaction) {
  const missingSigs = [];
  Object.entries(transaction.signatures).forEach(([address, signatureBytes]) => {
    if (!signatureBytes) {
      missingSigs.push(address);
    }
  });
  if (missingSigs.length > 0) {
    throw new errors.SolanaError(errors.SOLANA_ERROR__TRANSACTION__SIGNATURES_MISSING, {
      addresses: missingSigs
    });
  }
}
function getBase64EncodedWireTransaction(transaction) {
  const wireTransactionBytes = getTransactionEncoder().encode(transaction);
  return codecsStrings.getBase64Decoder().decode(wireTransactionBytes);
}

// src/transaction-size-limits.ts
var LEGACY_TRANSACTION_SIZE_LIMIT = 1232;
var V1_TRANSACTION_SIZE_LIMIT = 4096;

// src/transaction-size.ts
var TRANSACTION_PACKET_SIZE = 1280;
var TRANSACTION_PACKET_HEADER = 40 + 8;
var TRANSACTION_SIZE_LIMIT = TRANSACTION_PACKET_SIZE - TRANSACTION_PACKET_HEADER;
function getTransactionSize(transaction) {
  return getTransactionEncoder().getSizeFromValue(transaction);
}
function getTransactionSizeLimit(transaction) {
  const VERSION_FLAG_MASK2 = 127;
  const firstByte = transaction.messageBytes[0];
  return (firstByte & VERSION_FLAG_MASK2) === 1 ? V1_TRANSACTION_SIZE_LIMIT : LEGACY_TRANSACTION_SIZE_LIMIT;
}
function isTransactionWithinSizeLimit(transaction) {
  if (transaction.messageBytes.length === 0) {
    return true;
  }
  const sizeLimit = getTransactionSizeLimit(transaction);
  return getTransactionSize(transaction) <= sizeLimit;
}
function assertIsTransactionWithinSizeLimit(transaction) {
  if (transaction.messageBytes.length === 0) {
    return;
  }
  const sizeLimit = getTransactionSizeLimit(transaction);
  const transactionSize = getTransactionSize(transaction);
  if (transactionSize > sizeLimit) {
    throw new errors.SolanaError(errors.SOLANA_ERROR__TRANSACTION__EXCEEDS_SIZE_LIMIT, {
      transactionSize,
      transactionSizeLimit: sizeLimit
    });
  }
}

// src/sendable-transaction.ts
function isSendableTransaction(transaction) {
  return isFullySignedTransaction(transaction) && isTransactionWithinSizeLimit(transaction);
}
function assertIsSendableTransaction(transaction) {
  assertIsFullySignedTransaction(transaction);
  assertIsTransactionWithinSizeLimit(transaction);
}
function getTransactionMessageSize(transactionMessage) {
  return getTransactionSize(compileTransaction(transactionMessage));
}
function getTransactionMessageSizeLimit(transactionMessage) {
  return transactionMessage.version === 1 ? V1_TRANSACTION_SIZE_LIMIT : LEGACY_TRANSACTION_SIZE_LIMIT;
}
function isTransactionMessageWithinSizeLimit(transactionMessage) {
  return getTransactionMessageSize(transactionMessage) <= getTransactionMessageSizeLimit(transactionMessage);
}
function assertIsTransactionMessageWithinSizeLimit(transactionMessage) {
  const transactionSize = getTransactionMessageSize(transactionMessage);
  const transactionSizeLimit = getTransactionMessageSizeLimit(transactionMessage);
  if (transactionSize > transactionSizeLimit) {
    throw new errors.SolanaError(errors.SOLANA_ERROR__TRANSACTION__EXCEEDS_SIZE_LIMIT, {
      transactionSize,
      transactionSizeLimit
    });
  }
}

exports.TRANSACTION_PACKET_HEADER = TRANSACTION_PACKET_HEADER;
exports.TRANSACTION_PACKET_SIZE = TRANSACTION_PACKET_SIZE;
exports.TRANSACTION_SIZE_LIMIT = TRANSACTION_SIZE_LIMIT;
exports.assertIsFullySignedTransaction = assertIsFullySignedTransaction;
exports.assertIsSendableTransaction = assertIsSendableTransaction;
exports.assertIsTransactionMessageWithinSizeLimit = assertIsTransactionMessageWithinSizeLimit;
exports.assertIsTransactionWithBlockhashLifetime = assertIsTransactionWithBlockhashLifetime;
exports.assertIsTransactionWithDurableNonceLifetime = assertIsTransactionWithDurableNonceLifetime;
exports.assertIsTransactionWithinSizeLimit = assertIsTransactionWithinSizeLimit;
exports.compileTransaction = compileTransaction;
exports.getBase64EncodedWireTransaction = getBase64EncodedWireTransaction;
exports.getSignatureFromTransaction = getSignatureFromTransaction;
exports.getTransactionCodec = getTransactionCodec;
exports.getTransactionDecoder = getTransactionDecoder;
exports.getTransactionEncoder = getTransactionEncoder;
exports.getTransactionLifetimeConstraintFromCompiledTransactionMessage = getTransactionLifetimeConstraintFromCompiledTransactionMessage;
exports.getTransactionMessageSize = getTransactionMessageSize;
exports.getTransactionMessageSizeLimit = getTransactionMessageSizeLimit;
exports.getTransactionSize = getTransactionSize;
exports.getTransactionSizeLimit = getTransactionSizeLimit;
exports.isFullySignedTransaction = isFullySignedTransaction;
exports.isSendableTransaction = isSendableTransaction;
exports.isTransactionMessageWithinSizeLimit = isTransactionMessageWithinSizeLimit;
exports.isTransactionWithBlockhashLifetime = isTransactionWithBlockhashLifetime;
exports.isTransactionWithDurableNonceLifetime = isTransactionWithDurableNonceLifetime;
exports.isTransactionWithinSizeLimit = isTransactionWithinSizeLimit;
exports.partiallySignTransaction = partiallySignTransaction;
exports.signTransaction = signTransaction;
//# sourceMappingURL=index.node.cjs.map
//# sourceMappingURL=index.node.cjs.map