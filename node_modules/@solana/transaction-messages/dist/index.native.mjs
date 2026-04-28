import { SolanaError, SOLANA_ERROR__TRANSACTION__EXPECTED_BLOCKHASH_LIFETIME, SOLANA_ERROR__TRANSACTION__VERSION_NUMBER_OUT_OF_RANGE, SOLANA_ERROR__TRANSACTION__VERSION_NUMBER_NOT_SUPPORTED, SOLANA_ERROR__TRANSACTION__EXPECTED_NONCE_LIFETIME, SOLANA_ERROR__TRANSACTION__TOO_MANY_ACCOUNT_ADDRESSES, SOLANA_ERROR__TRANSACTION__TOO_MANY_SIGNER_ADDRESSES, SOLANA_ERROR__TRANSACTION__TOO_MANY_INSTRUCTIONS, SOLANA_ERROR__TRANSACTION__TOO_MANY_ACCOUNTS_IN_INSTRUCTION, SOLANA_ERROR__TRANSACTION__FAILED_TO_DECOMPILE_FEE_PAYER_MISSING, SOLANA_ERROR__TRANSACTION__FAILED_TO_DECOMPILE_ADDRESS_LOOKUP_TABLE_CONTENTS_MISSING, SOLANA_ERROR__TRANSACTION__FAILED_TO_DECOMPILE_ADDRESS_LOOKUP_TABLE_INDEX_OUT_OF_RANGE, SOLANA_ERROR__TRANSACTION__INVALID_CONFIG_VALUE_KIND, SOLANA_ERROR__TRANSACTION__INSTRUCTION_HEADERS_PAYLOADS_MISMATCH, SOLANA_ERROR__TRANSACTION__INVALID_CONFIG_MASK_PRIORITY_FEE_BITS, SOLANA_ERROR__TRANSACTION__FAILED_TO_DECOMPILE_INSTRUCTION_PROGRAM_ADDRESS_NOT_FOUND, SOLANA_ERROR__CODECS__INVALID_STRING_FOR_BASE, SOLANA_ERROR__TRANSACTION__INVOKED_PROGRAMS_MUST_NOT_BE_WRITABLE, SOLANA_ERROR__TRANSACTION__INVOKED_PROGRAMS_CANNOT_PAY_FEES } from '@solana/errors';
import { isBlockhash } from '@solana/rpc-types';
import { createEncoder, createDecoder, combineCodec, transformEncoder, transformDecoder, fixEncoderSize, addEncoderSizePrefix, fixDecoderSize, addDecoderSizePrefix } from '@solana/codecs-core';
import { getPatternMatchEncoder, getPatternMatchDecoder, getStructEncoder, getArrayEncoder, getStructDecoder, getArrayDecoder, getNullableEncoder, getBytesEncoder, getBytesDecoder, getUnitDecoder, getTupleDecoder } from '@solana/codecs-data-structures';
import { getAddressEncoder, getAddressDecoder, getAddressComparator, assertIsAddress } from '@solana/addresses';
import { getShortU16Encoder, getU32Encoder, getU8Encoder, getShortU16Decoder, getU32Decoder, getU8Decoder, getU64Decoder, getU64Encoder, getU16Encoder, getU16Decoder } from '@solana/codecs-numbers';
import { isSignerRole, AccountRole, isWritableRole, mergeRoles } from '@solana/instructions';
import { pipe } from '@solana/functional';

// src/blockhash.ts
function isTransactionMessageWithBlockhashLifetime(transactionMessage) {
  return "lifetimeConstraint" in transactionMessage && typeof transactionMessage.lifetimeConstraint.blockhash === "string" && typeof transactionMessage.lifetimeConstraint.lastValidBlockHeight === "bigint" && isBlockhash(transactionMessage.lifetimeConstraint.blockhash);
}
function assertIsTransactionMessageWithBlockhashLifetime(transactionMessage) {
  if (!isTransactionMessageWithBlockhashLifetime(transactionMessage)) {
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__EXPECTED_BLOCKHASH_LIFETIME);
  }
}
function setTransactionMessageLifetimeUsingBlockhash(blockhashLifetimeConstraint, transactionMessage) {
  if ("lifetimeConstraint" in transactionMessage && transactionMessage.lifetimeConstraint && "blockhash" in transactionMessage.lifetimeConstraint && transactionMessage.lifetimeConstraint.blockhash === blockhashLifetimeConstraint.blockhash && transactionMessage.lifetimeConstraint.lastValidBlockHeight === blockhashLifetimeConstraint.lastValidBlockHeight) {
    return transactionMessage;
  }
  return Object.freeze({
    ...transactionMessage,
    lifetimeConstraint: Object.freeze(blockhashLifetimeConstraint)
  });
}

// src/transaction-message.ts
var MAX_SUPPORTED_TRANSACTION_VERSION = 1;
var memoizedU8Encoder;
function getMemoizedU8Encoder() {
  if (!memoizedU8Encoder) memoizedU8Encoder = getU8Encoder();
  return memoizedU8Encoder;
}
var memoizedU8Decoder;
function getMemoizedU8Decoder() {
  if (!memoizedU8Decoder) memoizedU8Decoder = getU8Decoder();
  return memoizedU8Decoder;
}
function getMessageHeaderEncoder() {
  return getStructEncoder([
    ["numSignerAccounts", getMemoizedU8Encoder()],
    ["numReadonlySignerAccounts", getMemoizedU8Encoder()],
    ["numReadonlyNonSignerAccounts", getMemoizedU8Encoder()]
  ]);
}
function getMessageHeaderDecoder() {
  return getStructDecoder([
    ["numSignerAccounts", getMemoizedU8Decoder()],
    ["numReadonlySignerAccounts", getMemoizedU8Decoder()],
    ["numReadonlyNonSignerAccounts", getMemoizedU8Decoder()]
  ]);
}
var memoizedGetInstructionEncoder;
function getInstructionEncoder() {
  if (!memoizedGetInstructionEncoder) {
    memoizedGetInstructionEncoder = transformEncoder(
      getStructEncoder([
        ["programAddressIndex", getU8Encoder()],
        ["accountIndices", getArrayEncoder(getU8Encoder(), { size: getShortU16Encoder() })],
        ["data", addEncoderSizePrefix(getBytesEncoder(), getShortU16Encoder())]
      ]),
      // Convert an instruction to have all fields defined
      (instruction) => {
        if (instruction.accountIndices !== void 0 && instruction.data !== void 0) {
          return instruction;
        }
        return {
          ...instruction,
          accountIndices: instruction.accountIndices ?? [],
          data: instruction.data ?? new Uint8Array(0)
        };
      }
    );
  }
  return memoizedGetInstructionEncoder;
}
var memoizedGetInstructionDecoder;
function getInstructionDecoder() {
  if (!memoizedGetInstructionDecoder) {
    memoizedGetInstructionDecoder = transformDecoder(
      getStructDecoder([
        ["programAddressIndex", getU8Decoder()],
        ["accountIndices", getArrayDecoder(getU8Decoder(), { size: getShortU16Decoder() })],
        [
          "data",
          addDecoderSizePrefix(getBytesDecoder(), getShortU16Decoder())
        ]
      ]),
      // Convert an instruction to exclude optional fields if they are empty
      (instruction) => {
        if (instruction.accountIndices.length && instruction.data.byteLength) {
          return instruction;
        }
        const { accountIndices, data, ...rest } = instruction;
        return {
          ...rest,
          ...accountIndices.length ? { accountIndices } : null,
          ...data.byteLength ? { data } : null
        };
      }
    );
  }
  return memoizedGetInstructionDecoder;
}
function assertValidBaseString(alphabet4, testValue, givenValue = testValue) {
  if (!testValue.match(new RegExp(`^[${alphabet4}]*$`))) {
    throw new SolanaError(SOLANA_ERROR__CODECS__INVALID_STRING_FOR_BASE, {
      alphabet: alphabet4,
      base: alphabet4.length,
      value: givenValue
    });
  }
}
var getBaseXEncoder = (alphabet4) => {
  return createEncoder({
    getSizeFromValue: (value) => {
      const [leadingZeroes, tailChars] = partitionLeadingZeroes(value, alphabet4[0]);
      if (!tailChars) return value.length;
      const base10Number = getBigIntFromBaseX(tailChars, alphabet4);
      return leadingZeroes.length + Math.ceil(base10Number.toString(16).length / 2);
    },
    write(value, bytes, offset) {
      assertValidBaseString(alphabet4, value);
      if (value === "") return offset;
      const [leadingZeroes, tailChars] = partitionLeadingZeroes(value, alphabet4[0]);
      if (!tailChars) {
        bytes.set(new Uint8Array(leadingZeroes.length).fill(0), offset);
        return offset + leadingZeroes.length;
      }
      let base10Number = getBigIntFromBaseX(tailChars, alphabet4);
      const tailBytes = [];
      while (base10Number > 0n) {
        tailBytes.unshift(Number(base10Number % 256n));
        base10Number /= 256n;
      }
      const bytesToAdd = [...Array(leadingZeroes.length).fill(0), ...tailBytes];
      bytes.set(bytesToAdd, offset);
      return offset + bytesToAdd.length;
    }
  });
};
var getBaseXDecoder = (alphabet4) => {
  return createDecoder({
    read(rawBytes, offset) {
      const bytes = offset === 0 || offset <= -rawBytes.byteLength ? rawBytes : rawBytes.slice(offset);
      if (bytes.length === 0) return ["", 0];
      let trailIndex = bytes.findIndex((n) => n !== 0);
      trailIndex = trailIndex === -1 ? bytes.length : trailIndex;
      const leadingZeroes = alphabet4[0].repeat(trailIndex);
      if (trailIndex === bytes.length) return [leadingZeroes, rawBytes.length];
      const base10Number = bytes.slice(trailIndex).reduce((sum, byte) => sum * 256n + BigInt(byte), 0n);
      const tailChars = getBaseXFromBigInt(base10Number, alphabet4);
      return [leadingZeroes + tailChars, rawBytes.length];
    }
  });
};
function partitionLeadingZeroes(value, zeroCharacter) {
  const [leadingZeros, tailChars] = value.split(new RegExp(`((?!${zeroCharacter}).*)`));
  return [leadingZeros, tailChars];
}
function getBigIntFromBaseX(value, alphabet4) {
  const base = BigInt(alphabet4.length);
  let sum = 0n;
  for (const char of value) {
    sum *= base;
    sum += BigInt(alphabet4.indexOf(char));
  }
  return sum;
}
function getBaseXFromBigInt(value, alphabet4) {
  const base = BigInt(alphabet4.length);
  const tailChars = [];
  while (value > 0n) {
    tailChars.unshift(alphabet4[Number(value % base)]);
    value /= base;
  }
  return tailChars.join("");
}
var alphabet2 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
var getBase58Encoder = () => getBaseXEncoder(alphabet2);
var getBase58Decoder = () => getBaseXDecoder(alphabet2);

// src/codecs/legacy/lifetime-token.ts
function getLifetimeTokenEncoder() {
  return transformEncoder(
    getNullableEncoder(fixEncoderSize(getBase58Encoder(), 32), {
      noneValue: "zeroes",
      prefix: null
    }),
    (token) => token ?? null
  );
}
function getLifetimeTokenDecoder() {
  return fixDecoderSize(getBase58Decoder(), 32);
}

// src/codecs/legacy/message.ts
function getMessageEncoder() {
  return transformEncoder(
    getStructEncoder([
      ["header", getMessageHeaderEncoder()],
      ["staticAccounts", getArrayEncoder(getAddressEncoder(), { size: getShortU16Encoder() })],
      ["lifetimeToken", getLifetimeTokenEncoder()],
      ["instructions", getArrayEncoder(getInstructionEncoder(), { size: getShortU16Encoder() })]
    ]),
    (value) => ({
      ...value,
      lifetimeToken: "lifetimeToken" in value ? value.lifetimeToken : void 0
    })
  );
}
function getMessageDecoder() {
  return transformDecoder(
    getStructDecoder([
      ["header", getMessageHeaderDecoder()],
      ["staticAccounts", getArrayDecoder(getAddressDecoder(), { size: getShortU16Decoder() })],
      ["lifetimeToken", getLifetimeTokenDecoder()],
      ["instructions", getArrayDecoder(getInstructionDecoder(), { size: getShortU16Decoder() })]
    ]),
    (value) => ({
      ...value,
      version: "legacy"
    })
  );
}
var VERSION_FLAG_MASK = 128;
function getTransactionVersionEncoder() {
  return createEncoder({
    getSizeFromValue: (value) => value === "legacy" ? 0 : 1,
    maxSize: 1,
    write: (value, bytes, offset) => {
      if (value === "legacy") {
        return offset;
      }
      if (value < 0 || value > 127) {
        throw new SolanaError(SOLANA_ERROR__TRANSACTION__VERSION_NUMBER_OUT_OF_RANGE, {
          actualVersion: value
        });
      }
      if (value > MAX_SUPPORTED_TRANSACTION_VERSION) {
        throw new SolanaError(SOLANA_ERROR__TRANSACTION__VERSION_NUMBER_NOT_SUPPORTED, {
          unsupportedVersion: value
        });
      }
      bytes.set([value | VERSION_FLAG_MASK], offset);
      return offset + 1;
    }
  });
}
function getTransactionVersionDecoder() {
  return createDecoder({
    maxSize: 1,
    read: (bytes, offset) => {
      const firstByte = bytes[offset];
      if ((firstByte & VERSION_FLAG_MASK) === 0) {
        return ["legacy", offset];
      } else {
        const version = firstByte ^ VERSION_FLAG_MASK;
        if (version > MAX_SUPPORTED_TRANSACTION_VERSION) {
          throw new SolanaError(SOLANA_ERROR__TRANSACTION__VERSION_NUMBER_NOT_SUPPORTED, {
            unsupportedVersion: version
          });
        }
        return [version, offset + 1];
      }
    }
  });
}
function getTransactionVersionCodec() {
  return combineCodec(getTransactionVersionEncoder(), getTransactionVersionDecoder());
}
var memoizedAddressTableLookupEncoder;
function getAddressTableLookupEncoder() {
  if (!memoizedAddressTableLookupEncoder) {
    const indexEncoder = getArrayEncoder(getU8Encoder(), { size: getShortU16Encoder() });
    memoizedAddressTableLookupEncoder = getStructEncoder([
      ["lookupTableAddress", getAddressEncoder()],
      ["writableIndexes", indexEncoder],
      ["readonlyIndexes", indexEncoder]
    ]);
  }
  return memoizedAddressTableLookupEncoder;
}
var memoizedAddressTableLookupDecoder;
function getAddressTableLookupDecoder() {
  if (!memoizedAddressTableLookupDecoder) {
    const indexEncoder = getArrayDecoder(getU8Decoder(), { size: getShortU16Decoder() });
    memoizedAddressTableLookupDecoder = getStructDecoder([
      ["lookupTableAddress", getAddressDecoder()],
      ["writableIndexes", indexEncoder],
      ["readonlyIndexes", indexEncoder]
    ]);
  }
  return memoizedAddressTableLookupDecoder;
}

// src/codecs/v0/message.ts
function getMessageEncoder2() {
  return transformEncoder(
    getStructEncoder([
      ["version", getTransactionVersionEncoder()],
      ["header", getMessageHeaderEncoder()],
      ["staticAccounts", getArrayEncoder(getAddressEncoder(), { size: getShortU16Encoder() })],
      ["lifetimeToken", getLifetimeTokenEncoder()],
      ["instructions", getArrayEncoder(getInstructionEncoder(), { size: getShortU16Encoder() })],
      ["addressTableLookups", getArrayEncoder(getAddressTableLookupEncoder(), { size: getShortU16Encoder() })]
    ]),
    (value) => ({
      ...value,
      addressTableLookups: value.addressTableLookups ?? [],
      lifetimeToken: "lifetimeToken" in value ? value.lifetimeToken : void 0
    })
  );
}
function getMessageDecoder2() {
  return transformDecoder(
    getStructDecoder([
      ["version", getTransactionVersionDecoder()],
      ["header", getMessageHeaderDecoder()],
      ["staticAccounts", getArrayDecoder(getAddressDecoder(), { size: getShortU16Decoder() })],
      ["lifetimeToken", getLifetimeTokenDecoder()],
      ["instructions", getArrayDecoder(getInstructionDecoder(), { size: getShortU16Decoder() })],
      ["addressTableLookups", getArrayDecoder(getAddressTableLookupDecoder(), { size: getShortU16Decoder() })]
    ]),
    ({ addressTableLookups, ...restOfMessage }) => {
      if (!addressTableLookups?.length) {
        return { ...restOfMessage, version: 0 };
      }
      return { ...restOfMessage, addressTableLookups, version: 0 };
    }
  );
}
function isV1ConfigEmpty(config) {
  return config.computeUnitLimit === void 0 && config.heapSize === void 0 && config.loadedAccountsDataSizeLimit === void 0 && config.priorityFeeLamports === void 0;
}
function areV1ConfigsEqual(config1, config2) {
  return config1.computeUnitLimit === config2.computeUnitLimit && config1.heapSize === config2.heapSize && config1.loadedAccountsDataSizeLimit === config2.loadedAccountsDataSizeLimit && config1.priorityFeeLamports === config2.priorityFeeLamports;
}
function setTransactionMessageConfig(config, transactionMessage) {
  const mergedConfig = {
    ...transactionMessage.config,
    ...config
  };
  if (isV1ConfigEmpty(mergedConfig)) {
    if (!transactionMessage.config) {
      return transactionMessage;
    }
    const { config: config2, ...rest } = transactionMessage;
    return Object.freeze(rest);
  }
  if (transactionMessage.config && areV1ConfigsEqual(transactionMessage.config, mergedConfig)) {
    return transactionMessage;
  }
  return Object.freeze({
    ...transactionMessage,
    config: Object.freeze(mergedConfig)
  });
}
var TRANSACTION_CONFIG_PRIORITY_FEE_LAMPORTS_BIT_MASK = 3;
var TRANSACTION_CONFIG_COMPUTE_UNIT_LIMIT_BIT_MASK = 4;
var TRANSACTION_CONFIG_LOADED_ACCOUNTS_DATA_SIZE_LIMIT_BIT_MASK = 8;
var TRANSACTION_CONFIG_HEAP_SIZE_BIT_MASK = 16;
function transactionConfigMaskHasPriorityFee(mask) {
  const priorityFeeBits = mask & TRANSACTION_CONFIG_PRIORITY_FEE_LAMPORTS_BIT_MASK;
  if (priorityFeeBits === 1 || priorityFeeBits === 2) {
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__INVALID_CONFIG_MASK_PRIORITY_FEE_BITS, { mask });
  }
  return priorityFeeBits === TRANSACTION_CONFIG_PRIORITY_FEE_LAMPORTS_BIT_MASK;
}
function transactionConfigMaskHasComputeUnitLimit(mask) {
  return (mask & TRANSACTION_CONFIG_COMPUTE_UNIT_LIMIT_BIT_MASK) !== 0;
}
function transactionConfigMaskHasLoadedAccountsDataSizeLimit(mask) {
  return (mask & TRANSACTION_CONFIG_LOADED_ACCOUNTS_DATA_SIZE_LIMIT_BIT_MASK) !== 0;
}
function transactionConfigMaskHasHeapSize(mask) {
  return (mask & TRANSACTION_CONFIG_HEAP_SIZE_BIT_MASK) !== 0;
}

// src/codecs/v1/config.ts
function getCompiledTransactionConfigValueEncoder() {
  return getPatternMatchEncoder([
    [(value) => value.kind === "u32", getStructEncoder([["value", getU32Encoder()]])],
    [(value) => value.kind === "u64", getStructEncoder([["value", getU64Encoder()]])]
  ]);
}
function getCompiledTransactionConfigValuesEncoder() {
  return getArrayEncoder(getCompiledTransactionConfigValueEncoder(), { size: "remainder" });
}
function getCompiledTransactionConfigValuesDecoder(mask) {
  const hasPriorityFee = transactionConfigMaskHasPriorityFee(mask);
  const hasComputeUnitLimit = transactionConfigMaskHasComputeUnitLimit(mask);
  const hasLoadedAccountsDataSizeLimit = transactionConfigMaskHasLoadedAccountsDataSizeLimit(mask);
  const hasHeapSize = transactionConfigMaskHasHeapSize(mask);
  const u32Decoder = transformDecoder(getU32Decoder(), (value) => ({ kind: "u32", value }));
  const u64Decoder = transformDecoder(getU64Decoder(), (value) => ({ kind: "u64", value }));
  const unitDecoder = getUnitDecoder();
  return transformDecoder(
    getTupleDecoder([
      hasPriorityFee ? u64Decoder : unitDecoder,
      hasComputeUnitLimit ? u32Decoder : unitDecoder,
      hasLoadedAccountsDataSizeLimit ? u32Decoder : unitDecoder,
      hasHeapSize ? u32Decoder : unitDecoder
    ]),
    (arr) => arr.filter(Boolean)
  );
}
function getInstructionHeaderEncoder() {
  return getStructEncoder([
    ["programAccountIndex", getU8Encoder()],
    ["numInstructionAccounts", getU8Encoder()],
    ["numInstructionDataBytes", getU16Encoder()]
  ]);
}
function getInstructionHeaderDecoder() {
  return getStructDecoder([
    ["programAccountIndex", getU8Decoder()],
    ["numInstructionAccounts", getU8Decoder()],
    ["numInstructionDataBytes", getU16Decoder()]
  ]);
}
function getInstructionPayloadEncoder() {
  return getStructEncoder([
    ["instructionAccountIndices", getArrayEncoder(getU8Encoder(), { size: "remainder" })],
    ["instructionData", getBytesEncoder()]
  ]);
}
function getInstructionPayloadDecoder(instructionHeader) {
  return getStructDecoder([
    [
      "instructionAccountIndices",
      getArrayDecoder(getU8Decoder(), { size: instructionHeader.numInstructionAccounts })
    ],
    ["instructionData", fixDecoderSize(getBytesDecoder(), instructionHeader.numInstructionDataBytes)]
  ]);
}

// src/codecs/v1/message.ts
function getMessageEncoder3() {
  return transformEncoder(
    getStructEncoder([
      ["version", getTransactionVersionEncoder()],
      ["header", getMessageHeaderEncoder()],
      ["configMask", getU32Encoder()],
      ["lifetimeToken", getLifetimeTokenEncoder()],
      ["numInstructions", getU8Encoder()],
      ["numStaticAccounts", getU8Encoder()],
      ["staticAccounts", getArrayEncoder(getAddressEncoder(), { size: "remainder" })],
      ["configValues", getCompiledTransactionConfigValuesEncoder()],
      ["instructionHeaders", getArrayEncoder(getInstructionHeaderEncoder(), { size: "remainder" })],
      ["instructionPayloads", getArrayEncoder(getInstructionPayloadEncoder(), { size: "remainder" })]
    ]),
    (value) => ({
      ...value,
      lifetimeToken: "lifetimeToken" in value ? value.lifetimeToken : void 0
    })
  );
}
function getMessageDecoder3() {
  return createDecoder({
    read(bytes, offset) {
      const [{ header, configMask, lifetimeToken, numInstructions, numStaticAccounts }, afterFixedFields] = getStructDecoder([
        ["version", getTransactionVersionDecoder()],
        ["header", getMessageHeaderDecoder()],
        ["configMask", getU32Decoder()],
        ["lifetimeToken", getLifetimeTokenDecoder()],
        ["numInstructions", getU8Decoder()],
        ["numStaticAccounts", getU8Decoder()]
      ]).read(bytes, offset);
      let nextOffset = afterFixedFields;
      const [staticAccounts, afterAddresses] = getArrayDecoder(getAddressDecoder(), {
        size: numStaticAccounts
      }).read(bytes, nextOffset);
      nextOffset = afterAddresses;
      const [configValues, afterConfig] = getCompiledTransactionConfigValuesDecoder(configMask).read(
        bytes,
        nextOffset
      );
      nextOffset = afterConfig;
      const [instructionHeaders, afterHeaders] = getArrayDecoder(getInstructionHeaderDecoder(), {
        size: numInstructions
      }).read(bytes, nextOffset);
      nextOffset = afterHeaders;
      const instructionPayloads = [];
      for (const header2 of instructionHeaders) {
        const [payload, next] = getInstructionPayloadDecoder(header2).read(bytes, nextOffset);
        instructionPayloads.push(payload);
        nextOffset = next;
      }
      const compiledMessage = {
        configMask,
        configValues,
        header,
        instructionHeaders,
        instructionPayloads,
        lifetimeToken,
        numInstructions,
        numStaticAccounts,
        staticAccounts,
        version: 1
      };
      return [compiledMessage, nextOffset];
    }
  });
}

// src/codecs/message.ts
function getCompiledTransactionMessageEncoder() {
  return transformEncoder(
    getPatternMatchEncoder([
      [(m) => m.version === "legacy", getMessageEncoder()],
      [(m) => m.version === 0, getMessageEncoder2()],
      [(m) => m.version === 1, getMessageEncoder3()]
    ]),
    (value) => {
      if (value.version !== "legacy" && value.version > MAX_SUPPORTED_TRANSACTION_VERSION) {
        throw new SolanaError(SOLANA_ERROR__TRANSACTION__VERSION_NUMBER_NOT_SUPPORTED, {
          unsupportedVersion: value.version
        });
      }
      return value;
    }
  );
}
function getCompiledTransactionMessageDecoder() {
  return createDecoder({
    read(bytes, offset) {
      const [version] = getTransactionVersionDecoder().read(bytes, offset);
      return getPatternMatchDecoder([
        [() => version === "legacy", getMessageDecoder()],
        [() => version === 0, getMessageDecoder2()],
        [() => version === 1, getMessageDecoder3()]
      ]).read(bytes, offset);
    }
  });
}
function getCompiledTransactionMessageCodec() {
  return combineCodec(getCompiledTransactionMessageEncoder(), getCompiledTransactionMessageDecoder());
}
function upsert(addressMap, address, update) {
  addressMap[address] = update(addressMap[address] ?? { role: AccountRole.READONLY });
}
var TYPE = Symbol("AddressMapTypeProperty");
function getAddressMapFromInstructions(feePayer, instructions) {
  const addressMap = {
    [feePayer]: { [TYPE]: 0 /* FEE_PAYER */, role: AccountRole.WRITABLE_SIGNER }
  };
  const addressesOfInvokedPrograms = /* @__PURE__ */ new Set();
  for (const instruction of instructions) {
    upsert(addressMap, instruction.programAddress, (entry) => {
      addressesOfInvokedPrograms.add(instruction.programAddress);
      if (TYPE in entry) {
        if (isWritableRole(entry.role)) {
          switch (entry[TYPE]) {
            case 0 /* FEE_PAYER */:
              throw new SolanaError(SOLANA_ERROR__TRANSACTION__INVOKED_PROGRAMS_CANNOT_PAY_FEES, {
                programAddress: instruction.programAddress
              });
            default:
              throw new SolanaError(SOLANA_ERROR__TRANSACTION__INVOKED_PROGRAMS_MUST_NOT_BE_WRITABLE, {
                programAddress: instruction.programAddress
              });
          }
        }
        if (entry[TYPE] === 1 /* STATIC */) {
          return entry;
        }
      }
      return { [TYPE]: 1 /* STATIC */, role: AccountRole.READONLY };
    });
    if (!instruction.accounts) {
      continue;
    }
    for (const account of instruction.accounts) {
      upsert(addressMap, account.address, (entry) => {
        const {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          address: _,
          ...accountMeta
        } = account;
        if (TYPE in entry) {
          switch (entry[TYPE]) {
            case 0 /* FEE_PAYER */:
              return entry;
            case 1 /* STATIC */: {
              const nextRole = mergeRoles(entry.role, accountMeta.role);
              if (
                // Check to see if this address represents a program that is invoked
                // in this transaction.
                addressesOfInvokedPrograms.has(account.address)
              ) {
                if (isWritableRole(accountMeta.role)) {
                  throw new SolanaError(
                    SOLANA_ERROR__TRANSACTION__INVOKED_PROGRAMS_MUST_NOT_BE_WRITABLE,
                    {
                      programAddress: account.address
                    }
                  );
                }
                if (entry.role !== nextRole) {
                  return {
                    ...entry,
                    role: nextRole
                  };
                } else {
                  return entry;
                }
              } else {
                if (entry.role !== nextRole) {
                  return {
                    ...entry,
                    role: nextRole
                  };
                } else {
                  return entry;
                }
              }
            }
          }
        }
        return {
          ...accountMeta,
          [TYPE]: 1 /* STATIC */
        };
      });
    }
  }
  return addressMap;
}
function getOrderedAccountsFromAddressMap(addressMap) {
  let addressComparator;
  const orderedAccounts = Object.entries(addressMap).sort(([leftAddress, leftEntry], [rightAddress, rightEntry]) => {
    if (leftEntry[TYPE] !== rightEntry[TYPE]) {
      if (leftEntry[TYPE] === 0 /* FEE_PAYER */) {
        return -1;
      } else if (rightEntry[TYPE] === 0 /* FEE_PAYER */) {
        return 1;
      } else if (leftEntry[TYPE] === 1 /* STATIC */) {
        return -1;
      } else if (rightEntry[TYPE] === 1 /* STATIC */) {
        return 1;
      }
    }
    const leftIsSigner = isSignerRole(leftEntry.role);
    if (leftIsSigner !== isSignerRole(rightEntry.role)) {
      return leftIsSigner ? -1 : 1;
    }
    const leftIsWritable = isWritableRole(leftEntry.role);
    if (leftIsWritable !== isWritableRole(rightEntry.role)) {
      return leftIsWritable ? -1 : 1;
    }
    addressComparator ||= getAddressComparator();
    return addressComparator(leftAddress, rightAddress);
  }).map(([address, addressMeta]) => ({
    address,
    ...addressMeta
  }));
  return orderedAccounts;
}
function getCompiledMessageHeader(orderedAccounts) {
  let numReadonlyNonSignerAccounts = 0;
  let numReadonlySignerAccounts = 0;
  let numSignerAccounts = 0;
  for (const account of orderedAccounts) {
    if ("lookupTableAddress" in account) {
      break;
    }
    const accountIsWritable = isWritableRole(account.role);
    if (isSignerRole(account.role)) {
      numSignerAccounts++;
      if (!accountIsWritable) {
        numReadonlySignerAccounts++;
      }
    } else if (!accountIsWritable) {
      numReadonlyNonSignerAccounts++;
    }
  }
  return {
    numReadonlyNonSignerAccounts,
    numReadonlySignerAccounts,
    numSignerAccounts
  };
}

// src/compile/legacy/instructions.ts
function getAccountIndex(orderedAccounts) {
  const out = {};
  for (const [index, account] of orderedAccounts.entries()) {
    out[account.address] = index;
  }
  return out;
}
function getCompiledInstructions(instructions, orderedAccounts) {
  const accountIndex = getAccountIndex(orderedAccounts);
  return instructions.map(({ accounts, data, programAddress }) => {
    return {
      programAddressIndex: accountIndex[programAddress],
      ...accounts ? { accountIndices: accounts.map(({ address }) => accountIndex[address]) } : null,
      ...data ? { data } : null
    };
  });
}

// src/compile/legacy/lifetime-token.ts
function getCompiledLifetimeToken(lifetimeConstraint) {
  if ("nonce" in lifetimeConstraint) {
    return lifetimeConstraint.nonce;
  }
  return lifetimeConstraint.blockhash;
}

// src/compile/legacy/message.ts
function compileTransactionMessage(transactionMessage) {
  const addressMap = getAddressMapFromInstructions(
    transactionMessage.feePayer.address,
    transactionMessage.instructions
  );
  const orderedAccounts = getOrderedAccountsFromAddressMap(addressMap);
  const numAccounts = orderedAccounts.length;
  if (numAccounts > 64) {
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__TOO_MANY_ACCOUNT_ADDRESSES, {
      actualCount: numAccounts,
      maxAllowed: 64
    });
  }
  const numSigners = orderedAccounts.filter((account) => isSignerRole(account.role)).length;
  if (numSigners > 12) {
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__TOO_MANY_SIGNER_ADDRESSES, {
      actualCount: numSigners,
      maxAllowed: 12
    });
  }
  const numInstructions = transactionMessage.instructions.length;
  if (numInstructions > 64) {
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__TOO_MANY_INSTRUCTIONS, {
      actualCount: numInstructions,
      maxAllowed: 64
    });
  }
  for (let i = 0; i < transactionMessage.instructions.length; i++) {
    const numAccountsInInstruction = transactionMessage.instructions[i].accounts?.length ?? 0;
    if (numAccountsInInstruction > 255) {
      throw new SolanaError(SOLANA_ERROR__TRANSACTION__TOO_MANY_ACCOUNTS_IN_INSTRUCTION, {
        actualCount: numAccountsInInstruction,
        instructionIndex: i,
        maxAllowed: 255
      });
    }
  }
  const lifetimeConstraint = transactionMessage.lifetimeConstraint;
  return {
    ...lifetimeConstraint ? { lifetimeToken: getCompiledLifetimeToken(lifetimeConstraint) } : null,
    header: getCompiledMessageHeader(orderedAccounts),
    instructions: getCompiledInstructions(transactionMessage.instructions, orderedAccounts),
    staticAccounts: orderedAccounts.map((account) => account.address),
    version: transactionMessage.version
  };
}
function upsert2(addressMap, address, update) {
  addressMap[address] = update(addressMap[address] ?? { role: AccountRole.READONLY });
}
var TYPE2 = Symbol("AddressMapTypeProperty");
function getAddressMapFromInstructions2(feePayer, instructions) {
  const addressMap = {
    [feePayer]: { [TYPE2]: 0 /* FEE_PAYER */, role: AccountRole.WRITABLE_SIGNER }
  };
  const addressesOfInvokedPrograms = /* @__PURE__ */ new Set();
  for (const instruction of instructions) {
    upsert2(addressMap, instruction.programAddress, (entry) => {
      addressesOfInvokedPrograms.add(instruction.programAddress);
      if (TYPE2 in entry) {
        if (isWritableRole(entry.role)) {
          switch (entry[TYPE2]) {
            case 0 /* FEE_PAYER */:
              throw new SolanaError(SOLANA_ERROR__TRANSACTION__INVOKED_PROGRAMS_CANNOT_PAY_FEES, {
                programAddress: instruction.programAddress
              });
            default:
              throw new SolanaError(SOLANA_ERROR__TRANSACTION__INVOKED_PROGRAMS_MUST_NOT_BE_WRITABLE, {
                programAddress: instruction.programAddress
              });
          }
        }
        if (entry[TYPE2] === 2 /* STATIC */) {
          return entry;
        }
      }
      return { [TYPE2]: 2 /* STATIC */, role: AccountRole.READONLY };
    });
    let addressComparator;
    if (!instruction.accounts) {
      continue;
    }
    for (const account of instruction.accounts) {
      upsert2(addressMap, account.address, (entry) => {
        const {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          address: _,
          ...accountMeta
        } = account;
        if (TYPE2 in entry) {
          switch (entry[TYPE2]) {
            case 0 /* FEE_PAYER */:
              return entry;
            case 1 /* LOOKUP_TABLE */: {
              const nextRole = mergeRoles(entry.role, accountMeta.role);
              if ("lookupTableAddress" in accountMeta) {
                const shouldReplaceEntry = (
                  // Consider using the new LOOKUP_TABLE if its address is different...
                  entry.lookupTableAddress !== accountMeta.lookupTableAddress && // ...and sorts before the existing one.
                  (addressComparator ||= getAddressComparator())(
                    accountMeta.lookupTableAddress,
                    entry.lookupTableAddress
                  ) < 0
                );
                if (shouldReplaceEntry) {
                  return {
                    [TYPE2]: 1 /* LOOKUP_TABLE */,
                    ...accountMeta,
                    role: nextRole
                  };
                }
              } else if (isSignerRole(accountMeta.role)) {
                return {
                  [TYPE2]: 2 /* STATIC */,
                  role: nextRole
                };
              }
              if (entry.role !== nextRole) {
                return {
                  ...entry,
                  role: nextRole
                };
              } else {
                return entry;
              }
            }
            case 2 /* STATIC */: {
              const nextRole = mergeRoles(entry.role, accountMeta.role);
              if (
                // Check to see if this address represents a program that is invoked
                // in this transaction.
                addressesOfInvokedPrograms.has(account.address)
              ) {
                if (isWritableRole(accountMeta.role)) {
                  throw new SolanaError(
                    SOLANA_ERROR__TRANSACTION__INVOKED_PROGRAMS_MUST_NOT_BE_WRITABLE,
                    {
                      programAddress: account.address
                    }
                  );
                }
                if (entry.role !== nextRole) {
                  return {
                    ...entry,
                    role: nextRole
                  };
                } else {
                  return entry;
                }
              } else if ("lookupTableAddress" in accountMeta && // Static accounts can be 'upgraded' to lookup table accounts as
              // long as they are not require to sign the transaction.
              !isSignerRole(entry.role)) {
                return {
                  ...accountMeta,
                  [TYPE2]: 1 /* LOOKUP_TABLE */,
                  role: nextRole
                };
              } else {
                if (entry.role !== nextRole) {
                  return {
                    ...entry,
                    role: nextRole
                  };
                } else {
                  return entry;
                }
              }
            }
          }
        }
        if ("lookupTableAddress" in accountMeta) {
          return {
            ...accountMeta,
            [TYPE2]: 1 /* LOOKUP_TABLE */
          };
        } else {
          return {
            ...accountMeta,
            [TYPE2]: 2 /* STATIC */
          };
        }
      });
    }
  }
  return addressMap;
}
function getOrderedAccountsFromAddressMap2(addressMap) {
  let addressComparator;
  const orderedAccounts = Object.entries(addressMap).sort(([leftAddress, leftEntry], [rightAddress, rightEntry]) => {
    if (leftEntry[TYPE2] !== rightEntry[TYPE2]) {
      if (leftEntry[TYPE2] === 0 /* FEE_PAYER */) {
        return -1;
      } else if (rightEntry[TYPE2] === 0 /* FEE_PAYER */) {
        return 1;
      } else if (leftEntry[TYPE2] === 2 /* STATIC */) {
        return -1;
      } else if (rightEntry[TYPE2] === 2 /* STATIC */) {
        return 1;
      }
    }
    const leftIsSigner = isSignerRole(leftEntry.role);
    if (leftIsSigner !== isSignerRole(rightEntry.role)) {
      return leftIsSigner ? -1 : 1;
    }
    const leftIsWritable = isWritableRole(leftEntry.role);
    if (leftIsWritable !== isWritableRole(rightEntry.role)) {
      return leftIsWritable ? -1 : 1;
    }
    addressComparator ||= getAddressComparator();
    if (leftEntry[TYPE2] === 1 /* LOOKUP_TABLE */ && rightEntry[TYPE2] === 1 /* LOOKUP_TABLE */ && leftEntry.lookupTableAddress !== rightEntry.lookupTableAddress) {
      return addressComparator(leftEntry.lookupTableAddress, rightEntry.lookupTableAddress);
    } else {
      return addressComparator(leftAddress, rightAddress);
    }
  }).map(([address, addressMeta]) => ({
    address,
    ...addressMeta
  }));
  return orderedAccounts;
}
function getCompiledAddressTableLookups(orderedAccounts) {
  const index = {};
  for (const account of orderedAccounts) {
    if (!("lookupTableAddress" in account)) {
      continue;
    }
    const entry = index[account.lookupTableAddress] ||= {
      readonlyIndexes: [],
      writableIndexes: []
    };
    if (account.role === AccountRole.WRITABLE) {
      entry.writableIndexes.push(account.addressIndex);
    } else {
      entry.readonlyIndexes.push(account.addressIndex);
    }
  }
  return Object.keys(index).sort(getAddressComparator()).map((lookupTableAddress) => ({
    lookupTableAddress,
    ...index[lookupTableAddress]
  }));
}

// src/compile/v0/instructions.ts
function getAccountIndex2(orderedAccounts) {
  const out = {};
  for (const [index, account] of orderedAccounts.entries()) {
    out[account.address] = index;
  }
  return out;
}
function getCompiledInstructions2(instructions, orderedAccounts) {
  const accountIndex = getAccountIndex2(orderedAccounts);
  return instructions.map(({ accounts, data, programAddress }) => {
    return {
      programAddressIndex: accountIndex[programAddress],
      ...accounts ? { accountIndices: accounts.map(({ address }) => accountIndex[address]) } : null,
      ...data ? { data } : null
    };
  });
}

// src/compile/v0/static-accounts.ts
function getCompiledStaticAccounts(orderedAccounts) {
  const firstLookupTableAccountIndex = orderedAccounts.findIndex((account) => "lookupTableAddress" in account);
  const orderedStaticAccounts = firstLookupTableAccountIndex === -1 ? orderedAccounts : orderedAccounts.slice(0, firstLookupTableAccountIndex);
  return orderedStaticAccounts.map(({ address }) => address);
}

// src/compile/v0/message.ts
function compileTransactionMessage2(transactionMessage) {
  const addressMap = getAddressMapFromInstructions2(
    transactionMessage.feePayer.address,
    transactionMessage.instructions
  );
  const orderedAccounts = getOrderedAccountsFromAddressMap2(addressMap);
  const numAccounts = orderedAccounts.length;
  if (numAccounts > 64) {
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__TOO_MANY_ACCOUNT_ADDRESSES, {
      actualCount: numAccounts,
      maxAllowed: 64
    });
  }
  const numSigners = orderedAccounts.filter((account) => isSignerRole(account.role)).length;
  if (numSigners > 12) {
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__TOO_MANY_SIGNER_ADDRESSES, {
      actualCount: numSigners,
      maxAllowed: 12
    });
  }
  const numInstructions = transactionMessage.instructions.length;
  if (numInstructions > 64) {
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__TOO_MANY_INSTRUCTIONS, {
      actualCount: numInstructions,
      maxAllowed: 64
    });
  }
  for (let i = 0; i < transactionMessage.instructions.length; i++) {
    const numAccountsInInstruction = transactionMessage.instructions[i].accounts?.length ?? 0;
    if (numAccountsInInstruction > 255) {
      throw new SolanaError(SOLANA_ERROR__TRANSACTION__TOO_MANY_ACCOUNTS_IN_INSTRUCTION, {
        actualCount: numAccountsInInstruction,
        instructionIndex: i,
        maxAllowed: 255
      });
    }
  }
  const lifetimeConstraint = transactionMessage.lifetimeConstraint;
  return {
    addressTableLookups: getCompiledAddressTableLookups(orderedAccounts),
    ...lifetimeConstraint ? { lifetimeToken: getCompiledLifetimeToken(lifetimeConstraint) } : null,
    header: getCompiledMessageHeader(orderedAccounts),
    instructions: getCompiledInstructions2(transactionMessage.instructions, orderedAccounts),
    staticAccounts: getCompiledStaticAccounts(orderedAccounts),
    version: transactionMessage.version
  };
}

// src/compile/v1/config.ts
function getTransactionConfigMask(config) {
  let mask = 0;
  if (config.priorityFeeLamports !== void 0) mask |= TRANSACTION_CONFIG_PRIORITY_FEE_LAMPORTS_BIT_MASK;
  if (config.computeUnitLimit !== void 0) mask |= TRANSACTION_CONFIG_COMPUTE_UNIT_LIMIT_BIT_MASK;
  if (config.loadedAccountsDataSizeLimit !== void 0)
    mask |= TRANSACTION_CONFIG_LOADED_ACCOUNTS_DATA_SIZE_LIMIT_BIT_MASK;
  if (config.heapSize !== void 0) mask |= TRANSACTION_CONFIG_HEAP_SIZE_BIT_MASK;
  return mask;
}
function getTransactionConfigValues(config) {
  const values = [];
  if (config.priorityFeeLamports !== void 0) {
    values.push({ kind: "u64", value: config.priorityFeeLamports });
  }
  if (config.computeUnitLimit !== void 0) {
    values.push({ kind: "u32", value: config.computeUnitLimit });
  }
  if (config.loadedAccountsDataSizeLimit !== void 0) {
    values.push({ kind: "u32", value: config.loadedAccountsDataSizeLimit });
  }
  if (config.heapSize !== void 0) {
    values.push({ kind: "u32", value: config.heapSize });
  }
  return values;
}

// src/compile/v1/instructions.ts
function getInstructionHeader(instruction, accountIndex) {
  return {
    numInstructionAccounts: instruction.accounts?.length ?? 0,
    numInstructionDataBytes: instruction.data?.byteLength ?? 0,
    programAccountIndex: accountIndex[instruction.programAddress]
  };
}
function getInstructionPayload(instruction, accountIndex) {
  return {
    instructionAccountIndices: instruction.accounts?.map(({ address }) => accountIndex[address]) ?? [],
    instructionData: instruction.data ?? new Uint8Array()
  };
}

// src/compile/v1/message.ts
function compileTransactionMessage3(transactionMessage) {
  const addressMap = getAddressMapFromInstructions(
    transactionMessage.feePayer.address,
    transactionMessage.instructions
  );
  const orderedAccounts = getOrderedAccountsFromAddressMap(addressMap);
  const numAccounts = orderedAccounts.length;
  if (numAccounts > 64) {
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__TOO_MANY_ACCOUNT_ADDRESSES, {
      actualCount: numAccounts,
      maxAllowed: 64
    });
  }
  const numSigners = orderedAccounts.filter((account) => isSignerRole(account.role)).length;
  if (numSigners > 12) {
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__TOO_MANY_SIGNER_ADDRESSES, {
      actualCount: numSigners,
      maxAllowed: 12
    });
  }
  const numInstructions = transactionMessage.instructions.length;
  if (numInstructions > 64) {
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__TOO_MANY_INSTRUCTIONS, {
      actualCount: numInstructions,
      maxAllowed: 64
    });
  }
  for (let i = 0; i < transactionMessage.instructions.length; i++) {
    const numAccountsInInstruction = transactionMessage.instructions[i].accounts?.length ?? 0;
    if (numAccountsInInstruction > 255) {
      throw new SolanaError(SOLANA_ERROR__TRANSACTION__TOO_MANY_ACCOUNTS_IN_INSTRUCTION, {
        actualCount: numAccountsInInstruction,
        instructionIndex: i,
        maxAllowed: 255
      });
    }
  }
  const accountIndex = getAccountIndex(orderedAccounts);
  const lifetimeConstraint = transactionMessage.lifetimeConstraint;
  return {
    version: 1,
    ...lifetimeConstraint ? { lifetimeToken: getCompiledLifetimeToken(lifetimeConstraint) } : null,
    configMask: getTransactionConfigMask(transactionMessage.config ?? {}),
    configValues: getTransactionConfigValues(transactionMessage.config ?? {}),
    header: getCompiledMessageHeader(orderedAccounts),
    instructionHeaders: transactionMessage.instructions.map(
      (instruction) => getInstructionHeader(instruction, accountIndex)
    ),
    instructionPayloads: transactionMessage.instructions.map(
      (instruction) => getInstructionPayload(instruction, accountIndex)
    ),
    numInstructions: transactionMessage.instructions.length,
    numStaticAccounts: orderedAccounts.length,
    staticAccounts: orderedAccounts.map((account) => account.address)
  };
}

// src/compile/message.ts
function compileTransactionMessage4(transactionMessage) {
  const version = transactionMessage.version;
  if (version === "legacy") {
    return compileTransactionMessage(transactionMessage);
  } else if (version === 0) {
    return compileTransactionMessage2(transactionMessage);
  } else if (version === 1) {
    return compileTransactionMessage3(transactionMessage);
  } else {
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__VERSION_NUMBER_NOT_SUPPORTED, {
      version
    });
  }
}
function findAddressInLookupTables(address, role, addressesByLookupTableAddress) {
  for (const [lookupTableAddress, addresses] of Object.entries(addressesByLookupTableAddress)) {
    for (let i = 0; i < addresses.length; i++) {
      if (address === addresses[i]) {
        return {
          address,
          addressIndex: i,
          lookupTableAddress,
          role
        };
      }
    }
  }
}
function compressTransactionMessageUsingAddressLookupTables(transactionMessage, addressesByLookupTableAddress) {
  const programAddresses = new Set(transactionMessage.instructions.map((ix) => ix.programAddress));
  const eligibleLookupAddresses = new Set(
    Object.values(addressesByLookupTableAddress).flatMap((a) => a).filter((address) => !programAddresses.has(address))
  );
  const newInstructions = [];
  let updatedAnyInstructions = false;
  for (const instruction of transactionMessage.instructions) {
    if (!instruction.accounts) {
      newInstructions.push(instruction);
      continue;
    }
    const newAccounts = [];
    let updatedAnyAccounts = false;
    for (const account of instruction.accounts) {
      if ("lookupTableAddress" in account || !eligibleLookupAddresses.has(account.address) || isSignerRole(account.role)) {
        newAccounts.push(account);
        continue;
      }
      const lookupMetaAccount = findAddressInLookupTables(
        account.address,
        account.role,
        addressesByLookupTableAddress
      );
      newAccounts.push(Object.freeze(lookupMetaAccount));
      updatedAnyAccounts = true;
      updatedAnyInstructions = true;
    }
    newInstructions.push(
      Object.freeze(updatedAnyAccounts ? { ...instruction, accounts: newAccounts } : instruction)
    );
  }
  return Object.freeze(
    updatedAnyInstructions ? { ...transactionMessage, instructions: newInstructions } : transactionMessage
  );
}
var COMPUTE_BUDGET_PROGRAM_ADDRESS = "ComputeBudget111111111111111111111111111111";
var REQUEST_HEAP_FRAME_DISCRIMINATOR = 1;
var SET_COMPUTE_UNIT_LIMIT_DISCRIMINATOR = 2;
var SET_COMPUTE_UNIT_PRICE_DISCRIMINATOR = 3;
var SET_LOADED_ACCOUNTS_DATA_SIZE_LIMIT_DISCRIMINATOR = 4;
function getComputeBudgetInstruction(discriminator, value) {
  const data = getStructEncoder([
    ["discriminator", getU8Encoder()],
    ["value", getBytesEncoder()]
  ]).encode({ discriminator, value });
  return Object.freeze({
    data,
    programAddress: COMPUTE_BUDGET_PROGRAM_ADDRESS
  });
}
function isComputeBudgetInstruction(instruction, discriminator, expectedDataLength) {
  return instruction.programAddress === COMPUTE_BUDGET_PROGRAM_ADDRESS && "data" in instruction && instruction.data != null && instruction.data.byteLength === expectedDataLength && instruction.data[0] === discriminator;
}
function getSetComputeUnitLimitInstruction(units) {
  return getComputeBudgetInstruction(SET_COMPUTE_UNIT_LIMIT_DISCRIMINATOR, getU32Encoder().encode(units));
}
function isSetComputeUnitLimitInstruction(instruction) {
  return isComputeBudgetInstruction(instruction, SET_COMPUTE_UNIT_LIMIT_DISCRIMINATOR, 5);
}
function getComputeUnitLimitFromInstructionData(data) {
  return getU32Decoder().decode(data, 1);
}
function getSetComputeUnitPriceInstruction(microLamports) {
  return getComputeBudgetInstruction(SET_COMPUTE_UNIT_PRICE_DISCRIMINATOR, getU64Encoder().encode(microLamports));
}
function isSetComputeUnitPriceInstruction(instruction) {
  return isComputeBudgetInstruction(instruction, SET_COMPUTE_UNIT_PRICE_DISCRIMINATOR, 9);
}
function getPriorityFeeFromInstructionData(data) {
  return getU64Decoder().decode(data, 1);
}
function getRequestHeapFrameInstruction(bytes) {
  return getComputeBudgetInstruction(REQUEST_HEAP_FRAME_DISCRIMINATOR, getU32Encoder().encode(bytes));
}
function isRequestHeapFrameInstruction(instruction) {
  return isComputeBudgetInstruction(instruction, REQUEST_HEAP_FRAME_DISCRIMINATOR, 5);
}
function getHeapSizeFromInstructionData(data) {
  return getU32Decoder().decode(data, 1);
}
function getSetLoadedAccountsDataSizeLimitInstruction(limit) {
  return getComputeBudgetInstruction(
    SET_LOADED_ACCOUNTS_DATA_SIZE_LIMIT_DISCRIMINATOR,
    getU32Encoder().encode(limit)
  );
}
function isSetLoadedAccountsDataSizeLimitInstruction(instruction) {
  return isComputeBudgetInstruction(instruction, SET_LOADED_ACCOUNTS_DATA_SIZE_LIMIT_DISCRIMINATOR, 5);
}
function getLoadedAccountsDataSizeLimitFromInstructionData(data) {
  return getU32Decoder().decode(data, 1);
}
function replaceTransactionMessageInstruction(index, newInstruction, transactionMessage) {
  const nextInstructions = [...transactionMessage.instructions];
  nextInstructions[index] = newInstruction;
  return Object.freeze({
    ...transactionMessage,
    instructions: Object.freeze(nextInstructions)
  });
}
function removeTransactionMessageInstruction(index, transactionMessage) {
  return Object.freeze({
    ...transactionMessage,
    instructions: Object.freeze([
      ...transactionMessage.instructions.slice(0, index),
      ...transactionMessage.instructions.slice(index + 1)
    ])
  });
}

// src/instructions.ts
function appendTransactionMessageInstruction(instruction, transactionMessage) {
  return appendTransactionMessageInstructions([instruction], transactionMessage);
}
function appendTransactionMessageInstructions(instructions, transactionMessage) {
  return Object.freeze({
    ...transactionMessage,
    instructions: Object.freeze([
      ...transactionMessage.instructions,
      ...instructions
    ])
  });
}
function prependTransactionMessageInstruction(instruction, transactionMessage) {
  return prependTransactionMessageInstructions([instruction], transactionMessage);
}
function prependTransactionMessageInstructions(instructions, transactionMessage) {
  return Object.freeze({
    ...transactionMessage,
    instructions: Object.freeze([
      ...instructions,
      ...transactionMessage.instructions
    ])
  });
}

// src/compute-unit-limit.ts
function getTransactionMessageComputeUnitLimit(transactionMessage) {
  switch (transactionMessage.version) {
    case 1:
      return transactionMessage.config?.computeUnitLimit;
    default:
      return getTransactionMessageComputeUnitLimitUsingInstruction(transactionMessage);
  }
}
function getTransactionMessageComputeUnitLimitUsingInstruction(transactionMessage) {
  const instructions = transactionMessage.instructions;
  const existingInstruction = instructions.find(isSetComputeUnitLimitInstruction);
  return existingInstruction ? getComputeUnitLimitFromInstructionData(existingInstruction.data) : void 0;
}
function setTransactionMessageComputeUnitLimit(computeUnitLimit, transactionMessage) {
  switch (transactionMessage.version) {
    case 1:
      return setTransactionMessageComputeUnitLimitUsingConfig(
        computeUnitLimit,
        transactionMessage
      );
    default:
      return setTransactionMessageComputeUnitLimitUsingInstruction(computeUnitLimit, transactionMessage);
  }
}
function setTransactionMessageComputeUnitLimitUsingConfig(computeUnitLimit, transactionMessage) {
  const mergedConfig = { ...transactionMessage.config ?? {}, computeUnitLimit };
  const nextConfig = isV1ConfigEmpty(mergedConfig) ? void 0 : Object.freeze(mergedConfig);
  if (nextConfig === void 0) {
    const { config, ...rest } = transactionMessage;
    return Object.freeze(rest);
  }
  if (transactionMessage.config && areV1ConfigsEqual(transactionMessage.config, nextConfig)) {
    return transactionMessage;
  }
  return Object.freeze({ ...transactionMessage, config: nextConfig });
}
function setTransactionMessageComputeUnitLimitUsingInstruction(computeUnitLimit, transactionMessage) {
  const existingIndex = transactionMessage.instructions.findIndex(isSetComputeUnitLimitInstruction);
  if (computeUnitLimit === void 0) {
    return existingIndex === -1 ? transactionMessage : removeTransactionMessageInstruction(existingIndex, transactionMessage);
  }
  if (getTransactionMessageComputeUnitLimit(transactionMessage) === computeUnitLimit) {
    return transactionMessage;
  }
  const newInstruction = getSetComputeUnitLimitInstruction(computeUnitLimit);
  return existingIndex === -1 ? appendTransactionMessageInstruction(newInstruction, transactionMessage) : replaceTransactionMessageInstruction(existingIndex, newInstruction, transactionMessage);
}

// src/compute-unit-price.ts
function getTransactionMessageComputeUnitPrice(transactionMessage) {
  const instructions = transactionMessage.instructions;
  const existingInstruction = instructions.find(isSetComputeUnitPriceInstruction);
  return existingInstruction ? getPriorityFeeFromInstructionData(existingInstruction.data) : void 0;
}
function setTransactionMessageComputeUnitPrice(computeUnitPrice, transactionMessage) {
  const existingIndex = transactionMessage.instructions.findIndex(isSetComputeUnitPriceInstruction);
  if (computeUnitPrice === void 0) {
    return existingIndex === -1 ? transactionMessage : removeTransactionMessageInstruction(existingIndex, transactionMessage);
  }
  if (getTransactionMessageComputeUnitPrice(transactionMessage) === computeUnitPrice) {
    return transactionMessage;
  }
  const newInstruction = getSetComputeUnitPriceInstruction(computeUnitPrice);
  return existingIndex === -1 ? appendTransactionMessageInstruction(newInstruction, transactionMessage) : replaceTransactionMessageInstruction(existingIndex, newInstruction, transactionMessage);
}

// src/create-transaction-message.ts
function createTransactionMessage(config) {
  return Object.freeze({
    instructions: Object.freeze([]),
    version: config.version
  });
}

// src/fee-payer.ts
function setTransactionMessageFeePayer(feePayer, transactionMessage) {
  if ("feePayer" in transactionMessage && feePayer === transactionMessage.feePayer?.address && isAddressOnlyFeePayer(transactionMessage.feePayer)) {
    return transactionMessage;
  }
  const out = {
    ...transactionMessage,
    feePayer: Object.freeze({ address: feePayer })
  };
  Object.freeze(out);
  return out;
}
function isAddressOnlyFeePayer(feePayer) {
  return !!feePayer && "address" in feePayer && typeof feePayer.address === "string" && Object.keys(feePayer).length === 1;
}
function getAccountMetas(message) {
  const { header } = message;
  const numWritableSignerAccounts = header.numSignerAccounts - header.numReadonlySignerAccounts;
  const numWritableNonSignerAccounts = message.staticAccounts.length - header.numSignerAccounts - header.numReadonlyNonSignerAccounts;
  const accountMetas = [];
  let accountIndex = 0;
  for (let i = 0; i < numWritableSignerAccounts; i++) {
    accountMetas.push({
      address: message.staticAccounts[accountIndex],
      role: AccountRole.WRITABLE_SIGNER
    });
    accountIndex++;
  }
  for (let i = 0; i < header.numReadonlySignerAccounts; i++) {
    accountMetas.push({
      address: message.staticAccounts[accountIndex],
      role: AccountRole.READONLY_SIGNER
    });
    accountIndex++;
  }
  for (let i = 0; i < numWritableNonSignerAccounts; i++) {
    accountMetas.push({
      address: message.staticAccounts[accountIndex],
      role: AccountRole.WRITABLE
    });
    accountIndex++;
  }
  for (let i = 0; i < header.numReadonlyNonSignerAccounts; i++) {
    accountMetas.push({
      address: message.staticAccounts[accountIndex],
      role: AccountRole.READONLY
    });
    accountIndex++;
  }
  return accountMetas;
}
function convertInstruction(instruction, accountMetas) {
  const programAddress = accountMetas[instruction.programAddressIndex]?.address;
  if (!programAddress) {
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__FAILED_TO_DECOMPILE_INSTRUCTION_PROGRAM_ADDRESS_NOT_FOUND, {
      index: instruction.programAddressIndex
    });
  }
  const accounts = instruction.accountIndices?.map((accountIndex) => accountMetas[accountIndex]);
  const { data } = instruction;
  return Object.freeze({
    programAddress,
    ...accounts && accounts.length ? { accounts: Object.freeze(accounts) } : {},
    ...data && data.length ? { data } : {}
  });
}
function convertInstructions(instructions, accountMetas) {
  return instructions.map((instruction) => convertInstruction(instruction, accountMetas));
}
function getFeePayer(staticAccounts) {
  const feePayer = staticAccounts[0];
  if (!feePayer) {
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__FAILED_TO_DECOMPILE_FEE_PAYER_MISSING);
  }
  return feePayer;
}
var RECENT_BLOCKHASHES_SYSVAR_ADDRESS = "SysvarRecentB1ockHashes11111111111111111111";
var SYSTEM_PROGRAM_ADDRESS = "11111111111111111111111111111111";
function createAdvanceNonceAccountInstruction(nonceAccountAddress, nonceAuthorityAddress) {
  return {
    accounts: [
      { address: nonceAccountAddress, role: AccountRole.WRITABLE },
      {
        address: RECENT_BLOCKHASHES_SYSVAR_ADDRESS,
        role: AccountRole.READONLY
      },
      { address: nonceAuthorityAddress, role: AccountRole.READONLY_SIGNER }
    ],
    data: new Uint8Array([4, 0, 0, 0]),
    programAddress: SYSTEM_PROGRAM_ADDRESS
  };
}
function isAdvanceNonceAccountInstruction(instruction) {
  return instruction.programAddress === SYSTEM_PROGRAM_ADDRESS && // Test for `AdvanceNonceAccount` instruction data
  instruction.data != null && isAdvanceNonceAccountInstructionData(instruction.data) && // Test for exactly 3 accounts
  instruction.accounts?.length === 3 && // First account is nonce account address
  instruction.accounts[0].address != null && instruction.accounts[0].role === AccountRole.WRITABLE && // Second account is recent blockhashes sysvar
  instruction.accounts[1].address === RECENT_BLOCKHASHES_SYSVAR_ADDRESS && instruction.accounts[1].role === AccountRole.READONLY && // Third account is nonce authority account
  instruction.accounts[2].address != null && isSignerRole(instruction.accounts[2].role);
}
function isAdvanceNonceAccountInstructionData(data) {
  return data.byteLength === 4 && data[0] === 4 && data[1] === 0 && data[2] === 0 && data[3] === 0;
}

// src/decompile/legacy/lifetime-constraint.ts
function getLifetimeConstraint(messageLifetimeToken, instructions, lastValidBlockHeight) {
  const firstInstruction = instructions[0];
  if (!firstInstruction || !isAdvanceNonceAccountInstruction(firstInstruction)) {
    return {
      blockhash: messageLifetimeToken,
      lastValidBlockHeight: lastValidBlockHeight ?? 2n ** 64n - 1n
      // U64 MAX
    };
  } else {
    const nonceAccountAddress = firstInstruction.accounts[0].address;
    assertIsAddress(nonceAccountAddress);
    const nonceAuthorityAddress = firstInstruction.accounts[2].address;
    assertIsAddress(nonceAuthorityAddress);
    return {
      nonce: messageLifetimeToken,
      nonceAccountAddress,
      nonceAuthorityAddress
    };
  }
}

// src/decompile/legacy/message.ts
function decompileTransactionMessage(compiledTransactionMessage, config) {
  const feePayer = getFeePayer(compiledTransactionMessage.staticAccounts);
  const accountMetas = getAccountMetas(compiledTransactionMessage);
  const instructions = convertInstructions(compiledTransactionMessage.instructions, accountMetas);
  const lifetimeConstraint = getLifetimeConstraint(
    compiledTransactionMessage.lifetimeToken,
    instructions,
    config?.lastValidBlockHeight
  );
  return pipe(
    createTransactionMessage({ version: "legacy" }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
    (m) => "blockhash" in lifetimeConstraint ? setTransactionMessageLifetimeUsingBlockhash(lifetimeConstraint, m) : setTransactionMessageLifetimeUsingDurableNonce(lifetimeConstraint, m)
  );
}
function isTransactionMessageWithDurableNonceLifetime(transactionMessage) {
  return "lifetimeConstraint" in transactionMessage && typeof transactionMessage.lifetimeConstraint.nonce === "string" && transactionMessage.instructions[0] != null && isAdvanceNonceAccountInstruction(transactionMessage.instructions[0]);
}
function assertIsTransactionMessageWithDurableNonceLifetime(transactionMessage) {
  if (!isTransactionMessageWithDurableNonceLifetime(transactionMessage)) {
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__EXPECTED_NONCE_LIFETIME);
  }
}
function isAdvanceNonceAccountInstructionForNonce(instruction, nonceAccountAddress, nonceAuthorityAddress) {
  return instruction.accounts[0].address === nonceAccountAddress && instruction.accounts[2].address === nonceAuthorityAddress;
}
function setTransactionMessageLifetimeUsingDurableNonce({
  nonce,
  nonceAccountAddress,
  nonceAuthorityAddress
}, transactionMessage) {
  let newInstructions;
  const firstInstruction = transactionMessage.instructions[0];
  if (firstInstruction && isAdvanceNonceAccountInstruction(firstInstruction)) {
    if (isAdvanceNonceAccountInstructionForNonce(firstInstruction, nonceAccountAddress, nonceAuthorityAddress)) {
      if (isTransactionMessageWithDurableNonceLifetime(transactionMessage) && transactionMessage.lifetimeConstraint.nonce === nonce) {
        return transactionMessage;
      } else {
        newInstructions = [firstInstruction, ...transactionMessage.instructions.slice(1)];
      }
    } else {
      newInstructions = [
        Object.freeze(createAdvanceNonceAccountInstruction(nonceAccountAddress, nonceAuthorityAddress)),
        ...transactionMessage.instructions.slice(1)
      ];
    }
  } else {
    newInstructions = [
      Object.freeze(createAdvanceNonceAccountInstruction(nonceAccountAddress, nonceAuthorityAddress)),
      ...transactionMessage.instructions
    ];
  }
  return Object.freeze({
    ...transactionMessage,
    instructions: Object.freeze(newInstructions),
    lifetimeConstraint: Object.freeze({ nonce })
  });
}
function getAddressLookupMetas(compiledAddressTableLookups, addressesByLookupTableAddress) {
  const compiledAddressTableLookupAddresses = compiledAddressTableLookups.map((l) => l.lookupTableAddress);
  const missing = compiledAddressTableLookupAddresses.filter((a) => addressesByLookupTableAddress[a] === void 0);
  if (missing.length > 0) {
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__FAILED_TO_DECOMPILE_ADDRESS_LOOKUP_TABLE_CONTENTS_MISSING, {
      lookupTableAddresses: missing
    });
  }
  const readOnlyMetas = [];
  const writableMetas = [];
  for (const lookup of compiledAddressTableLookups) {
    const addresses = addressesByLookupTableAddress[lookup.lookupTableAddress];
    const readonlyIndexes = lookup.readonlyIndexes;
    const writableIndexes = lookup.writableIndexes;
    const highestIndex = Math.max(...readonlyIndexes, ...writableIndexes);
    if (highestIndex >= addresses.length) {
      throw new SolanaError(
        SOLANA_ERROR__TRANSACTION__FAILED_TO_DECOMPILE_ADDRESS_LOOKUP_TABLE_INDEX_OUT_OF_RANGE,
        {
          highestKnownIndex: addresses.length - 1,
          highestRequestedIndex: highestIndex,
          lookupTableAddress: lookup.lookupTableAddress
        }
      );
    }
    const readOnlyForLookup = readonlyIndexes.map((r) => ({
      address: addresses[r],
      addressIndex: r,
      lookupTableAddress: lookup.lookupTableAddress,
      role: AccountRole.READONLY
    }));
    readOnlyMetas.push(...readOnlyForLookup);
    const writableForLookup = writableIndexes.map((w) => ({
      address: addresses[w],
      addressIndex: w,
      lookupTableAddress: lookup.lookupTableAddress,
      role: AccountRole.WRITABLE
    }));
    writableMetas.push(...writableForLookup);
  }
  return [...writableMetas, ...readOnlyMetas];
}

// src/decompile/v0/message.ts
function decompileTransactionMessage2(compiledTransactionMessage, config) {
  const feePayer = getFeePayer(compiledTransactionMessage.staticAccounts);
  const accountMetas = getAccountMetas(compiledTransactionMessage);
  const accountLookupMetas = "addressTableLookups" in compiledTransactionMessage && compiledTransactionMessage.addressTableLookups !== void 0 && compiledTransactionMessage.addressTableLookups.length > 0 ? getAddressLookupMetas(
    compiledTransactionMessage.addressTableLookups,
    config?.addressesByLookupTableAddress ?? {}
  ) : [];
  const transactionMetas = [...accountMetas, ...accountLookupMetas];
  const instructions = convertInstructions(compiledTransactionMessage.instructions, transactionMetas);
  const lifetimeConstraint = getLifetimeConstraint(
    compiledTransactionMessage.lifetimeToken,
    instructions,
    config?.lastValidBlockHeight
  );
  return pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
    (m) => "blockhash" in lifetimeConstraint ? setTransactionMessageLifetimeUsingBlockhash(lifetimeConstraint, m) : setTransactionMessageLifetimeUsingDurableNonce(lifetimeConstraint, m)
  );
}
function decompileTransactionConfig(configMask, configValues) {
  const supportedConfigs = [
    ["priorityFeeLamports", "u64", transactionConfigMaskHasPriorityFee],
    ["computeUnitLimit", "u32", transactionConfigMaskHasComputeUnitLimit],
    ["loadedAccountsDataSizeLimit", "u32", transactionConfigMaskHasLoadedAccountsDataSizeLimit],
    ["heapSize", "u32", transactionConfigMaskHasHeapSize]
  ];
  const [config] = supportedConfigs.reduce(
    ([acc, index], [name, kind, predicate]) => {
      if (!predicate(configMask)) return [acc, index];
      const configValue = configValues[index];
      if (configValue.kind !== kind) {
        throw new SolanaError(SOLANA_ERROR__TRANSACTION__INVALID_CONFIG_VALUE_KIND, {
          actualKind: configValue.kind,
          configName: name,
          expectedKind: kind
        });
      }
      return [{ ...acc, [name]: configValue.value }, index + 1];
    },
    [{}, 0]
  );
  return config;
}
function decompileInstruction(instructionHeader, instructionPayload, accountMetas) {
  const programAddress = accountMetas[instructionHeader.programAccountIndex]?.address;
  if (!programAddress) {
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__FAILED_TO_DECOMPILE_INSTRUCTION_PROGRAM_ADDRESS_NOT_FOUND, {
      index: instructionHeader.programAccountIndex
    });
  }
  const accounts = instructionPayload.instructionAccountIndices.map((accountIndex) => accountMetas[accountIndex]);
  const data = instructionPayload.instructionData;
  return Object.freeze({
    programAddress,
    ...accounts && accounts.length ? { accounts: Object.freeze(accounts) } : {},
    ...data && data.length ? { data } : {}
  });
}
function decompileInstructions(instructionHeaders, instructionPayloads, accountMetas) {
  if (instructionHeaders.length !== instructionPayloads.length) {
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__INSTRUCTION_HEADERS_PAYLOADS_MISMATCH, {
      numInstructionHeaders: instructionHeaders.length,
      numInstructionPayloads: instructionPayloads.length
    });
  }
  return instructionHeaders.map(
    (instructionHeader, index) => decompileInstruction(instructionHeader, instructionPayloads[index], accountMetas)
  );
}

// src/decompile/v1/message.ts
function decompileTransactionMessage3(compiledTransactionMessage, config) {
  const feePayer = getFeePayer(compiledTransactionMessage.staticAccounts);
  const accountMetas = getAccountMetas(compiledTransactionMessage);
  const transactionConfig = decompileTransactionConfig(
    compiledTransactionMessage.configMask,
    compiledTransactionMessage.configValues
  );
  const instructions = decompileInstructions(
    compiledTransactionMessage.instructionHeaders,
    compiledTransactionMessage.instructionPayloads,
    accountMetas
  );
  const lifetimeConstraint = getLifetimeConstraint(
    compiledTransactionMessage.lifetimeToken,
    instructions,
    config?.lastValidBlockHeight
  );
  return pipe(
    // @ts-expect-error We don't expose v1 on `createTransactionMessage` yet
    createTransactionMessage({ version: 1 }),
    // Won't need this cast after we support v1 on `createTransactionMessage`
    (m) => setTransactionMessageConfig(transactionConfig, m),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
    (m) => "blockhash" in lifetimeConstraint ? setTransactionMessageLifetimeUsingBlockhash(lifetimeConstraint, m) : setTransactionMessageLifetimeUsingDurableNonce(lifetimeConstraint, m)
  );
}

// src/decompile/message.ts
function decompileTransactionMessage4(compiledTransactionMessage, config) {
  const version = compiledTransactionMessage.version;
  if (version === "legacy") {
    return decompileTransactionMessage(compiledTransactionMessage, config);
  } else if (version === 0) {
    return decompileTransactionMessage2(compiledTransactionMessage, config);
  } else if (version === 1) {
    return decompileTransactionMessage3(compiledTransactionMessage, config);
  } else {
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__VERSION_NUMBER_NOT_SUPPORTED, {
      version
    });
  }
}

// src/heap-size.ts
function getTransactionMessageHeapSize(transactionMessage) {
  switch (transactionMessage.version) {
    case 1:
      return transactionMessage.config?.heapSize;
    default:
      return getTransactionMessageHeapSizeUsingInstruction(transactionMessage);
  }
}
function getTransactionMessageHeapSizeUsingInstruction(transactionMessage) {
  const instructions = transactionMessage.instructions;
  const existingInstruction = instructions.find(isRequestHeapFrameInstruction);
  return existingInstruction ? getHeapSizeFromInstructionData(existingInstruction.data) : void 0;
}
function setTransactionMessageHeapSize(heapSize, transactionMessage) {
  switch (transactionMessage.version) {
    case 1:
      return setTransactionMessageHeapSizeUsingConfig(heapSize, transactionMessage);
    default:
      return setTransactionMessageHeapSizeUsingInstruction(heapSize, transactionMessage);
  }
}
function setTransactionMessageHeapSizeUsingConfig(heapSize, transactionMessage) {
  const mergedConfig = { ...transactionMessage.config ?? {}, heapSize };
  const nextConfig = isV1ConfigEmpty(mergedConfig) ? void 0 : Object.freeze(mergedConfig);
  if (nextConfig === void 0) {
    const { config, ...rest } = transactionMessage;
    return Object.freeze(rest);
  }
  if (transactionMessage.config && areV1ConfigsEqual(transactionMessage.config, nextConfig)) {
    return transactionMessage;
  }
  return Object.freeze({ ...transactionMessage, config: nextConfig });
}
function setTransactionMessageHeapSizeUsingInstruction(heapSize, transactionMessage) {
  const existingIndex = transactionMessage.instructions.findIndex(isRequestHeapFrameInstruction);
  if (heapSize === void 0) {
    return existingIndex === -1 ? transactionMessage : removeTransactionMessageInstruction(existingIndex, transactionMessage);
  }
  if (getTransactionMessageHeapSize(transactionMessage) === heapSize) {
    return transactionMessage;
  }
  const newInstruction = getRequestHeapFrameInstruction(heapSize);
  return existingIndex === -1 ? appendTransactionMessageInstruction(newInstruction, transactionMessage) : replaceTransactionMessageInstruction(existingIndex, newInstruction, transactionMessage);
}

// src/loaded-accounts-data-size-limit.ts
function getTransactionMessageLoadedAccountsDataSizeLimit(transactionMessage) {
  switch (transactionMessage.version) {
    case 1:
      return transactionMessage.config?.loadedAccountsDataSizeLimit;
    default:
      return getTransactionMessageLoadedAccountsDataSizeLimitUsingInstruction(transactionMessage);
  }
}
function getTransactionMessageLoadedAccountsDataSizeLimitUsingInstruction(transactionMessage) {
  const instructions = transactionMessage.instructions;
  const existingInstruction = instructions.find(isSetLoadedAccountsDataSizeLimitInstruction);
  return existingInstruction ? getLoadedAccountsDataSizeLimitFromInstructionData(existingInstruction.data) : void 0;
}
function setTransactionMessageLoadedAccountsDataSizeLimit(loadedAccountsDataSizeLimit, transactionMessage) {
  switch (transactionMessage.version) {
    case 1:
      return setTransactionMessageLoadedAccountsDataSizeLimitUsingConfig(
        loadedAccountsDataSizeLimit,
        transactionMessage
      );
    default:
      return setTransactionMessageLoadedAccountsDataSizeLimitUsingInstruction(
        loadedAccountsDataSizeLimit,
        transactionMessage
      );
  }
}
function setTransactionMessageLoadedAccountsDataSizeLimitUsingConfig(loadedAccountsDataSizeLimit, transactionMessage) {
  const mergedConfig = { ...transactionMessage.config ?? {}, loadedAccountsDataSizeLimit };
  const nextConfig = isV1ConfigEmpty(mergedConfig) ? void 0 : Object.freeze(mergedConfig);
  if (nextConfig === void 0) {
    const { config, ...rest } = transactionMessage;
    return Object.freeze(rest);
  }
  if (transactionMessage.config && areV1ConfigsEqual(transactionMessage.config, nextConfig)) {
    return transactionMessage;
  }
  return Object.freeze({ ...transactionMessage, config: nextConfig });
}
function setTransactionMessageLoadedAccountsDataSizeLimitUsingInstruction(loadedAccountsDataSizeLimit, transactionMessage) {
  const existingIndex = transactionMessage.instructions.findIndex(isSetLoadedAccountsDataSizeLimitInstruction);
  if (loadedAccountsDataSizeLimit === void 0) {
    return existingIndex === -1 ? transactionMessage : removeTransactionMessageInstruction(existingIndex, transactionMessage);
  }
  if (getTransactionMessageLoadedAccountsDataSizeLimit(transactionMessage) === loadedAccountsDataSizeLimit) {
    return transactionMessage;
  }
  const newInstruction = getSetLoadedAccountsDataSizeLimitInstruction(loadedAccountsDataSizeLimit);
  return existingIndex === -1 ? appendTransactionMessageInstruction(newInstruction, transactionMessage) : replaceTransactionMessageInstruction(existingIndex, newInstruction, transactionMessage);
}

// src/priority-fee-lamports.ts
function getTransactionMessagePriorityFeeLamports(transactionMessage) {
  return transactionMessage.config?.priorityFeeLamports;
}
function setTransactionMessagePriorityFeeLamports(priorityFeeLamports, transactionMessage) {
  const mergedConfig = { ...transactionMessage.config ?? {}, priorityFeeLamports };
  const nextConfig = isV1ConfigEmpty(mergedConfig) ? void 0 : Object.freeze(mergedConfig);
  if (nextConfig === void 0) {
    const { config, ...rest } = transactionMessage;
    return Object.freeze(rest);
  }
  if (transactionMessage.config && areV1ConfigsEqual(transactionMessage.config, nextConfig)) {
    return transactionMessage;
  }
  return Object.freeze({ ...transactionMessage, config: nextConfig });
}

export { MAX_SUPPORTED_TRANSACTION_VERSION, appendTransactionMessageInstruction, appendTransactionMessageInstructions, assertIsTransactionMessageWithBlockhashLifetime, assertIsTransactionMessageWithDurableNonceLifetime, compileTransactionMessage4 as compileTransactionMessage, compressTransactionMessageUsingAddressLookupTables, createTransactionMessage, decompileTransactionMessage4 as decompileTransactionMessage, getCompiledTransactionMessageCodec, getCompiledTransactionMessageDecoder, getCompiledTransactionMessageEncoder, getTransactionMessageComputeUnitLimit, getTransactionMessageComputeUnitPrice, getTransactionMessageHeapSize, getTransactionMessageLoadedAccountsDataSizeLimit, getTransactionMessagePriorityFeeLamports, getTransactionVersionCodec, getTransactionVersionDecoder, getTransactionVersionEncoder, isAdvanceNonceAccountInstruction, isTransactionMessageWithBlockhashLifetime, isTransactionMessageWithDurableNonceLifetime, prependTransactionMessageInstruction, prependTransactionMessageInstructions, setTransactionMessageComputeUnitLimit, setTransactionMessageComputeUnitPrice, setTransactionMessageFeePayer, setTransactionMessageHeapSize, setTransactionMessageLifetimeUsingBlockhash, setTransactionMessageLifetimeUsingDurableNonce, setTransactionMessageLoadedAccountsDataSizeLimit, setTransactionMessagePriorityFeeLamports };
//# sourceMappingURL=index.native.mjs.map
//# sourceMappingURL=index.native.mjs.map