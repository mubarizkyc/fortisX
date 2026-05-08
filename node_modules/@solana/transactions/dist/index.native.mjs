import { getAddressDecoder, isAddress, getAddressFromPublicKey } from '@solana/addresses';
import { createEncoder, transformDecoder, fixDecoderSize, createDecoder, combineCodec, padRightDecoder, bytesEqual, transformEncoder, fixEncoderSize } from '@solana/codecs-core';
import { getPredicateEncoder, getStructEncoder, getBytesEncoder, getPredicateDecoder, getStructDecoder, getArrayDecoder, getBytesDecoder, getTupleDecoder, getArrayEncoder } from '@solana/codecs-data-structures';
import { getShortU16Decoder, getU8Decoder, getShortU16Encoder } from '@solana/codecs-numbers';
import { SolanaError, SOLANA_ERROR__TRANSACTION__SIGNATURE_COUNT_TOO_HIGH_FOR_TRANSACTION_BYTES, SOLANA_ERROR__TRANSACTION__MESSAGE_SIGNATURES_MISMATCH, SOLANA_ERROR__TRANSACTION__NONCE_ACCOUNT_CANNOT_BE_IN_LOOKUP_TABLE, SOLANA_ERROR__TRANSACTION__INVALID_NONCE_ACCOUNT_INDEX, SOLANA_ERROR__TRANSACTION__VERSION_NUMBER_NOT_SUPPORTED, SOLANA_ERROR__TRANSACTION__EXPECTED_BLOCKHASH_LIFETIME, SOLANA_ERROR__TRANSACTION__EXPECTED_NONCE_LIFETIME, SOLANA_ERROR__TRANSACTION__FEE_PAYER_SIGNATURE_MISSING, SOLANA_ERROR__TRANSACTION__ADDRESSES_CANNOT_SIGN_TRANSACTION, SOLANA_ERROR__TRANSACTION__SIGNATURES_MISSING, SOLANA_ERROR__TRANSACTION__EXCEEDS_SIZE_LIMIT, SOLANA_ERROR__TRANSACTION__CANNOT_ENCODE_WITH_EMPTY_MESSAGE_BYTES, SOLANA_ERROR__TRANSACTION__MALFORMED_MESSAGE_BYTES, SOLANA_ERROR__TRANSACTION__CANNOT_DECODE_EMPTY_TRANSACTION_BYTES, SOLANA_ERROR__TRANSACTION__VERSION_ZERO_MUST_BE_ENCODED_WITH_SIGNATURES_FIRST, SOLANA_ERROR__TRANSACTION__CANNOT_ENCODE_WITH_EMPTY_SIGNATURES } from '@solana/errors';
import { getTransactionVersionDecoder, compileTransactionMessage, getCompiledTransactionMessageEncoder, isTransactionMessageWithBlockhashLifetime, isTransactionMessageWithDurableNonceLifetime } from '@solana/transaction-messages';
import { isBlockhash } from '@solana/rpc-types';
import { getBase58Decoder, getBase64Decoder } from '@solana/codecs-strings';
import { signBytes } from '@solana/keys';

// src/codecs/transaction-codec.ts
function getSignaturesToEncode(signaturesMap) {
  const signatures = Object.values(signaturesMap);
  if (signatures.length === 0) {
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__CANNOT_ENCODE_WITH_EMPTY_SIGNATURES);
  }
  return signatures.map((signature) => {
    if (!signature) {
      return new Uint8Array(64).fill(0);
    }
    return signature;
  });
}
function getSignaturesEncoderWithSizePrefix() {
  return transformEncoder(
    getArrayEncoder(fixEncoderSize(getBytesEncoder(), 64), { size: getShortU16Encoder() }),
    getSignaturesToEncode
  );
}
function getSignaturesEncoderWithLength(size) {
  return transformEncoder(
    getArrayEncoder(fixEncoderSize(getBytesEncoder(), 64), { description: "signatures", size }),
    getSignaturesToEncode
  );
}

// src/codecs/transaction-codec.ts
var SIGNATURE_COUNT_FLAG_MASK = 128;
var VERSION_FLAG_MASK = 127;
function getEnvelopeShapeFromMessageBytes(messageBytes) {
  if (messageBytes.length === 0) {
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__CANNOT_ENCODE_WITH_EMPTY_MESSAGE_BYTES);
  }
  const version = getTransactionVersionDecoder().decode(messageBytes);
  return version === 1 ? "messageFirst" : "signaturesFirst";
}
function getEnvelopeShapeFromTransactionBytes(transactionBytes) {
  if (transactionBytes.length === 0) {
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__CANNOT_DECODE_EMPTY_TRANSACTION_BYTES);
  }
  const firstByte = transactionBytes[0];
  if ((firstByte & SIGNATURE_COUNT_FLAG_MASK) === 0) {
    return "signaturesFirst";
  }
  const version = firstByte & VERSION_FLAG_MASK;
  if (version === 0) {
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__VERSION_ZERO_MUST_BE_ENCODED_WITH_SIGNATURES_FIRST, {
      firstByte,
      transactionBytes
    });
  }
  if (version === 1) {
    return "messageFirst";
  }
  throw new SolanaError(SOLANA_ERROR__TRANSACTION__VERSION_NUMBER_NOT_SUPPORTED, {
    unsupportedVersion: version
  });
}
function getTransactionEncoder() {
  return getPredicateEncoder(
    (transaction) => getEnvelopeShapeFromMessageBytes(transaction.messageBytes) === "signaturesFirst",
    getTransactionEncoderWithSignaturesFirst(),
    getTransactionEncoderWithMessageFirst()
  );
}
function getTransactionEncoderWithSignaturesFirst() {
  return getStructEncoder([
    ["signatures", getSignaturesEncoderWithSizePrefix()],
    ["messageBytes", getBytesEncoder()]
  ]);
}
function getSignatureCountForVersionedOrThrow(messageBytes, offset) {
  if (messageBytes.length < offset + 2) {
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__MALFORMED_MESSAGE_BYTES, {
      messageBytes
    });
  }
  return messageBytes[offset + 1];
}
function getTransactionEncoderWithMessageFirst() {
  const bytesEncoder = getBytesEncoder();
  return createEncoder({
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
  return getPredicateDecoder(
    (transactionBytes) => getEnvelopeShapeFromTransactionBytes(transactionBytes) === "signaturesFirst",
    getTransactionDecoderWithSignaturesFirst(),
    getTransactionDecoderWithMessageFirst()
  );
}
function getTransactionDecoderWithSignaturesFirst() {
  return transformDecoder(
    getStructDecoder([
      ["signatures", getArrayDecoder(fixDecoderSize(getBytesDecoder(), 64), { size: getShortU16Decoder() })],
      ["messageBytes", getBytesDecoder()]
    ]),
    decodePartiallyDecodedLegacyOrV0Transaction
  );
}
function getTransactionDecoderWithMessageFirst() {
  return transformDecoder(
    getPartiallyDecodedTransactionDecoderWithMessageFirst(),
    decodePartiallyDecodedV1Transaction
  );
}
function getPartiallyDecodedTransactionDecoderWithMessageFirst() {
  return createDecoder({
    read(bytes, offset) {
      const signatureCount = getSignatureCountForVersionedOrThrow(bytes, offset);
      const signatureByteLength = signatureCount * 64;
      const messageBytesLength = bytes.length - offset - signatureByteLength;
      if (messageBytesLength < 0) {
        throw new SolanaError(SOLANA_ERROR__TRANSACTION__SIGNATURE_COUNT_TOO_HIGH_FOR_TRANSACTION_BYTES, {
          numExpectedSignatures: signatureCount,
          transactionBytes: bytes.subarray(offset),
          transactionBytesLength: bytes.length - offset
        });
      }
      const messageBytes = bytes.subarray(offset, offset + messageBytesLength);
      const [signatures, finalOffset] = getArrayDecoder(fixDecoderSize(getBytesDecoder(), 64), {
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
  return combineCodec(getTransactionEncoder(), getTransactionDecoder());
}
function decodePartiallyDecodedLegacyOrV0Transaction(transaction) {
  const { messageBytes, signatures } = transaction;
  const signerAddressesDecoder = getTupleDecoder([
    // read transaction version
    getTransactionVersionDecoder(),
    // read first byte of header, `numSignerAccounts`
    // padRight to skip the next 2 bytes, `numReadOnlySignedAccounts` and `numReadOnlyUnsignedAccounts` which we don't need
    padRightDecoder(getU8Decoder(), 2),
    // read static addresses
    getArrayDecoder(getAddressDecoder(), { size: getShortU16Decoder() })
  ]);
  const [_txVersion, numRequiredSignatures, staticAddresses] = signerAddressesDecoder.decode(messageBytes);
  const signerAddresses = staticAddresses.slice(0, numRequiredSignatures);
  if (signerAddresses.length !== signatures.length) {
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__MESSAGE_SIGNATURES_MISMATCH, {
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
  const signerAddresses = getArrayDecoder(getAddressDecoder(), { size: numRequiredSignatures }).decode(
    messageBytes,
    staticAddressOffset
  );
  if (signerAddresses.length !== signatures.length) {
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__MESSAGE_SIGNATURES_MISMATCH, {
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
        throw new SolanaError(SOLANA_ERROR__TRANSACTION__NONCE_ACCOUNT_CANNOT_BE_IN_LOOKUP_TABLE, {
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
        throw new SolanaError(SOLANA_ERROR__TRANSACTION__INVALID_NONCE_ACCOUNT_INDEX, {
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
  throw new SolanaError(SOLANA_ERROR__TRANSACTION__VERSION_NUMBER_NOT_SUPPORTED, {
    unsupportedVersion: version
  });
}
function isTransactionWithBlockhashLifetime(transaction) {
  return "lifetimeConstraint" in transaction && "blockhash" in transaction.lifetimeConstraint && typeof transaction.lifetimeConstraint.blockhash === "string" && typeof transaction.lifetimeConstraint.lastValidBlockHeight === "bigint" && isBlockhash(transaction.lifetimeConstraint.blockhash);
}
function assertIsTransactionWithBlockhashLifetime(transaction) {
  if (!isTransactionWithBlockhashLifetime(transaction)) {
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__EXPECTED_BLOCKHASH_LIFETIME);
  }
}
function isTransactionWithDurableNonceLifetime(transaction) {
  return "lifetimeConstraint" in transaction && "nonce" in transaction.lifetimeConstraint && typeof transaction.lifetimeConstraint.nonce === "string" && typeof transaction.lifetimeConstraint.nonceAccountAddress === "string" && isAddress(transaction.lifetimeConstraint.nonceAccountAddress);
}
function assertIsTransactionWithDurableNonceLifetime(transaction) {
  if (!isTransactionWithDurableNonceLifetime(transaction)) {
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__EXPECTED_NONCE_LIFETIME);
  }
}
function compileTransaction(transactionMessage) {
  const compiledMessage = compileTransactionMessage(transactionMessage);
  const messageBytes = getCompiledTransactionMessageEncoder().encode(compiledMessage);
  const transactionSigners = compiledMessage.staticAccounts.slice(0, compiledMessage.header.numSignerAccounts);
  const signatures = {};
  for (const signerAddress of transactionSigners) {
    signatures[signerAddress] = null;
  }
  let lifetimeConstraint;
  if (isTransactionMessageWithBlockhashLifetime(transactionMessage)) {
    lifetimeConstraint = {
      blockhash: transactionMessage.lifetimeConstraint.blockhash,
      lastValidBlockHeight: transactionMessage.lifetimeConstraint.lastValidBlockHeight
    };
  } else if (isTransactionMessageWithDurableNonceLifetime(transactionMessage)) {
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
  if (!base58Decoder) base58Decoder = getBase58Decoder();
  const signatureBytes = Object.values(transaction.signatures)[0];
  if (!signatureBytes) {
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__FEE_PAYER_SIGNATURE_MISSING);
  }
  const transactionSignature = base58Decoder.decode(signatureBytes);
  return transactionSignature;
}
async function partiallySignTransaction(keyPairs, transaction) {
  let newSignatures;
  let unexpectedSigners;
  await Promise.all(
    keyPairs.map(async (keyPair) => {
      const address = await getAddressFromPublicKey(keyPair.publicKey);
      const existingSignature = transaction.signatures[address];
      if (existingSignature === void 0) {
        unexpectedSigners ||= /* @__PURE__ */ new Set();
        unexpectedSigners.add(address);
        return;
      }
      if (unexpectedSigners) {
        return;
      }
      const newSignature = await signBytes(keyPair.privateKey, transaction.messageBytes);
      if (existingSignature !== null && bytesEqual(newSignature, existingSignature)) {
        return;
      }
      newSignatures ||= {};
      newSignatures[address] = newSignature;
    })
  );
  if (unexpectedSigners && unexpectedSigners.size > 0) {
    const expectedSigners = Object.keys(transaction.signatures);
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__ADDRESSES_CANNOT_SIGN_TRANSACTION, {
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
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__SIGNATURES_MISSING, {
      addresses: missingSigs
    });
  }
}
function getBase64EncodedWireTransaction(transaction) {
  const wireTransactionBytes = getTransactionEncoder().encode(transaction);
  return getBase64Decoder().decode(wireTransactionBytes);
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
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__EXCEEDS_SIZE_LIMIT, {
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
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__EXCEEDS_SIZE_LIMIT, {
      transactionSize,
      transactionSizeLimit
    });
  }
}

export { TRANSACTION_PACKET_HEADER, TRANSACTION_PACKET_SIZE, TRANSACTION_SIZE_LIMIT, assertIsFullySignedTransaction, assertIsSendableTransaction, assertIsTransactionMessageWithinSizeLimit, assertIsTransactionWithBlockhashLifetime, assertIsTransactionWithDurableNonceLifetime, assertIsTransactionWithinSizeLimit, compileTransaction, getBase64EncodedWireTransaction, getSignatureFromTransaction, getTransactionCodec, getTransactionDecoder, getTransactionEncoder, getTransactionLifetimeConstraintFromCompiledTransactionMessage, getTransactionMessageSize, getTransactionMessageSizeLimit, getTransactionSize, getTransactionSizeLimit, isFullySignedTransaction, isSendableTransaction, isTransactionMessageWithinSizeLimit, isTransactionWithBlockhashLifetime, isTransactionWithDurableNonceLifetime, isTransactionWithinSizeLimit, partiallySignTransaction, signTransaction };
//# sourceMappingURL=index.native.mjs.map
//# sourceMappingURL=index.native.mjs.map