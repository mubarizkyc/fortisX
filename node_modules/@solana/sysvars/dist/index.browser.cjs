'use strict';

var accounts = require('@solana/accounts');
var codecsCore = require('@solana/codecs-core');
var codecsDataStructures = require('@solana/codecs-data-structures');
var codecsNumbers = require('@solana/codecs-numbers');
var rpcTypes = require('@solana/rpc-types');
var errors = require('@solana/errors');

// src/clock.ts
var SYSVAR_CLOCK_ADDRESS = "SysvarC1ock11111111111111111111111111111111";
var SYSVAR_EPOCH_REWARDS_ADDRESS = "SysvarEpochRewards1111111111111111111111111";
var SYSVAR_EPOCH_SCHEDULE_ADDRESS = "SysvarEpochSchedu1e111111111111111111111111";
var SYSVAR_INSTRUCTIONS_ADDRESS = "Sysvar1nstructions1111111111111111111111111";
var SYSVAR_LAST_RESTART_SLOT_ADDRESS = "SysvarLastRestartS1ot1111111111111111111111";
var SYSVAR_RECENT_BLOCKHASHES_ADDRESS = "SysvarRecentB1ockHashes11111111111111111111";
var SYSVAR_RENT_ADDRESS = "SysvarRent111111111111111111111111111111111";
var SYSVAR_SLOT_HASHES_ADDRESS = "SysvarS1otHashes111111111111111111111111111";
var SYSVAR_SLOT_HISTORY_ADDRESS = "SysvarS1otHistory11111111111111111111111111";
var SYSVAR_STAKE_HISTORY_ADDRESS = "SysvarStakeHistory1111111111111111111111111";
async function fetchEncodedSysvarAccount(rpc, address, config) {
  return await accounts.fetchEncodedAccount(rpc, address, config);
}
async function fetchJsonParsedSysvarAccount(rpc, address, config) {
  return await accounts.fetchJsonParsedAccount(rpc, address, config);
}

// src/clock.ts
function getSysvarClockEncoder() {
  return codecsDataStructures.getStructEncoder([
    ["slot", codecsNumbers.getU64Encoder()],
    ["epochStartTimestamp", codecsNumbers.getI64Encoder()],
    ["epoch", codecsNumbers.getU64Encoder()],
    ["leaderScheduleEpoch", codecsNumbers.getU64Encoder()],
    ["unixTimestamp", codecsNumbers.getI64Encoder()]
  ]);
}
function getSysvarClockDecoder() {
  return codecsDataStructures.getStructDecoder([
    ["slot", codecsNumbers.getU64Decoder()],
    ["epochStartTimestamp", codecsNumbers.getI64Decoder()],
    ["epoch", codecsNumbers.getU64Decoder()],
    ["leaderScheduleEpoch", codecsNumbers.getU64Decoder()],
    ["unixTimestamp", codecsNumbers.getI64Decoder()]
  ]);
}
function getSysvarClockCodec() {
  return codecsCore.combineCodec(getSysvarClockEncoder(), getSysvarClockDecoder());
}
async function fetchSysvarClock(rpc, config) {
  const account = await fetchEncodedSysvarAccount(rpc, SYSVAR_CLOCK_ADDRESS, config);
  accounts.assertAccountExists(account);
  const decoded = accounts.decodeAccount(account, getSysvarClockDecoder());
  return decoded.data;
}
function getSysvarEpochRewardsEncoder() {
  return codecsDataStructures.getStructEncoder([
    ["distributionStartingBlockHeight", codecsNumbers.getU64Encoder()],
    ["numPartitions", codecsNumbers.getU64Encoder()],
    ["parentBlockhash", rpcTypes.getBlockhashEncoder()],
    ["totalPoints", codecsNumbers.getU128Encoder()],
    ["totalRewards", rpcTypes.getDefaultLamportsEncoder()],
    ["distributedRewards", rpcTypes.getDefaultLamportsEncoder()],
    ["active", codecsDataStructures.getBooleanEncoder()]
  ]);
}
function getSysvarEpochRewardsDecoder() {
  return codecsDataStructures.getStructDecoder([
    ["distributionStartingBlockHeight", codecsNumbers.getU64Decoder()],
    ["numPartitions", codecsNumbers.getU64Decoder()],
    ["parentBlockhash", rpcTypes.getBlockhashDecoder()],
    ["totalPoints", codecsNumbers.getU128Decoder()],
    ["totalRewards", rpcTypes.getDefaultLamportsDecoder()],
    ["distributedRewards", rpcTypes.getDefaultLamportsDecoder()],
    ["active", codecsDataStructures.getBooleanDecoder()]
  ]);
}
function getSysvarEpochRewardsCodec() {
  return codecsCore.combineCodec(getSysvarEpochRewardsEncoder(), getSysvarEpochRewardsDecoder());
}
async function fetchSysvarEpochRewards(rpc, config) {
  const account = await fetchEncodedSysvarAccount(rpc, SYSVAR_EPOCH_REWARDS_ADDRESS, config);
  accounts.assertAccountExists(account);
  const decoded = accounts.decodeAccount(account, getSysvarEpochRewardsDecoder());
  return decoded.data;
}
function getSysvarEpochScheduleEncoder() {
  return codecsDataStructures.getStructEncoder([
    ["slotsPerEpoch", codecsNumbers.getU64Encoder()],
    ["leaderScheduleSlotOffset", codecsNumbers.getU64Encoder()],
    ["warmup", codecsDataStructures.getBooleanEncoder()],
    ["firstNormalEpoch", codecsNumbers.getU64Encoder()],
    ["firstNormalSlot", codecsNumbers.getU64Encoder()]
  ]);
}
function getSysvarEpochScheduleDecoder() {
  return codecsDataStructures.getStructDecoder([
    ["slotsPerEpoch", codecsNumbers.getU64Decoder()],
    ["leaderScheduleSlotOffset", codecsNumbers.getU64Decoder()],
    ["warmup", codecsDataStructures.getBooleanDecoder()],
    ["firstNormalEpoch", codecsNumbers.getU64Decoder()],
    ["firstNormalSlot", codecsNumbers.getU64Decoder()]
  ]);
}
function getSysvarEpochScheduleCodec() {
  return codecsCore.combineCodec(getSysvarEpochScheduleEncoder(), getSysvarEpochScheduleDecoder());
}
async function fetchSysvarEpochSchedule(rpc, config) {
  const account = await fetchEncodedSysvarAccount(rpc, SYSVAR_EPOCH_SCHEDULE_ADDRESS, config);
  accounts.assertAccountExists(account);
  const decoded = accounts.decodeAccount(account, getSysvarEpochScheduleDecoder());
  return decoded.data;
}
function getSysvarLastRestartSlotEncoder() {
  return codecsDataStructures.getStructEncoder([["lastRestartSlot", codecsNumbers.getU64Encoder()]]);
}
function getSysvarLastRestartSlotDecoder() {
  return codecsDataStructures.getStructDecoder([["lastRestartSlot", codecsNumbers.getU64Decoder()]]);
}
function getSysvarLastRestartSlotCodec() {
  return codecsCore.combineCodec(getSysvarLastRestartSlotEncoder(), getSysvarLastRestartSlotDecoder());
}
async function fetchSysvarLastRestartSlot(rpc, config) {
  const account = await fetchEncodedSysvarAccount(rpc, SYSVAR_LAST_RESTART_SLOT_ADDRESS, config);
  accounts.assertAccountExists(account);
  const decoded = accounts.decodeAccount(account, getSysvarLastRestartSlotDecoder());
  return decoded.data;
}
function getSysvarRecentBlockhashesEncoder() {
  return codecsDataStructures.getArrayEncoder(
    codecsDataStructures.getStructEncoder([
      ["blockhash", rpcTypes.getBlockhashEncoder()],
      ["feeCalculator", codecsDataStructures.getStructEncoder([["lamportsPerSignature", rpcTypes.getDefaultLamportsEncoder()]])]
    ])
  );
}
function getSysvarRecentBlockhashesDecoder() {
  return codecsDataStructures.getArrayDecoder(
    codecsDataStructures.getStructDecoder([
      ["blockhash", rpcTypes.getBlockhashDecoder()],
      ["feeCalculator", codecsDataStructures.getStructDecoder([["lamportsPerSignature", rpcTypes.getDefaultLamportsDecoder()]])]
    ])
  );
}
function getSysvarRecentBlockhashesCodec() {
  return codecsCore.combineCodec(getSysvarRecentBlockhashesEncoder(), getSysvarRecentBlockhashesDecoder());
}
async function fetchSysvarRecentBlockhashes(rpc, config) {
  const account = await fetchEncodedSysvarAccount(rpc, SYSVAR_RECENT_BLOCKHASHES_ADDRESS, config);
  accounts.assertAccountExists(account);
  const decoded = accounts.decodeAccount(account, getSysvarRecentBlockhashesDecoder());
  return decoded.data;
}
function getSysvarRentEncoder() {
  return codecsDataStructures.getStructEncoder([
    ["lamportsPerByteYear", rpcTypes.getDefaultLamportsEncoder()],
    ["exemptionThreshold", codecsNumbers.getF64Encoder()],
    ["burnPercent", codecsNumbers.getU8Encoder()]
  ]);
}
function getSysvarRentDecoder() {
  return codecsDataStructures.getStructDecoder([
    ["lamportsPerByteYear", rpcTypes.getDefaultLamportsDecoder()],
    ["exemptionThreshold", codecsNumbers.getF64Decoder()],
    ["burnPercent", codecsNumbers.getU8Decoder()]
  ]);
}
function getSysvarRentCodec() {
  return codecsCore.combineCodec(getSysvarRentEncoder(), getSysvarRentDecoder());
}
async function fetchSysvarRent(rpc, config) {
  const account = await fetchEncodedSysvarAccount(rpc, SYSVAR_RENT_ADDRESS, config);
  accounts.assertAccountExists(account);
  const decoded = accounts.decodeAccount(account, getSysvarRentDecoder());
  return decoded.data;
}
function getSysvarSlotHashesEncoder() {
  return codecsDataStructures.getArrayEncoder(
    codecsDataStructures.getStructEncoder([
      ["slot", codecsNumbers.getU64Encoder()],
      ["hash", rpcTypes.getBlockhashEncoder()]
    ])
  );
}
function getSysvarSlotHashesDecoder() {
  return codecsDataStructures.getArrayDecoder(
    codecsDataStructures.getStructDecoder([
      ["slot", codecsNumbers.getU64Decoder()],
      ["hash", rpcTypes.getBlockhashDecoder()]
    ])
  );
}
function getSysvarSlotHashesCodec() {
  return codecsCore.combineCodec(getSysvarSlotHashesEncoder(), getSysvarSlotHashesDecoder());
}
async function fetchSysvarSlotHashes(rpc, config) {
  const account = await fetchEncodedSysvarAccount(rpc, SYSVAR_SLOT_HASHES_ADDRESS, config);
  accounts.assertAccountExists(account);
  const decoded = accounts.decodeAccount(account, getSysvarSlotHashesDecoder());
  return decoded.data;
}
var BITVEC_DISCRIMINATOR = 1;
var BITVEC_NUM_BITS = 1024 * 1024;
var BITVEC_LENGTH = BITVEC_NUM_BITS / 64;
var SLOT_HISTORY_ACCOUNT_DATA_STATIC_SIZE = 1 + // Discriminator
8 + // bitvector length (u64)
BITVEC_LENGTH * 8 + 8 + // Number of bits (u64)
8;
var memoizedU64Encoder;
var memoizedU64Decoder;
var memoizedU64ArrayEncoder;
var memoizedU64ArrayDecoder;
function getMemoizedU64Encoder() {
  if (!memoizedU64Encoder) memoizedU64Encoder = codecsNumbers.getU64Encoder();
  return memoizedU64Encoder;
}
function getMemoizedU64Decoder() {
  if (!memoizedU64Decoder) memoizedU64Decoder = codecsNumbers.getU64Decoder();
  return memoizedU64Decoder;
}
function getMemoizedU64ArrayEncoder() {
  if (!memoizedU64ArrayEncoder) memoizedU64ArrayEncoder = codecsDataStructures.getArrayCodec(codecsNumbers.getU64Codec(), { size: BITVEC_LENGTH });
  return memoizedU64ArrayEncoder;
}
function getMemoizedU64ArrayDecoder() {
  if (!memoizedU64ArrayDecoder) memoizedU64ArrayDecoder = codecsDataStructures.getArrayCodec(codecsNumbers.getU64Codec(), { size: BITVEC_LENGTH });
  return memoizedU64ArrayDecoder;
}
function getSysvarSlotHistoryEncoder() {
  return codecsCore.createEncoder({
    fixedSize: SLOT_HISTORY_ACCOUNT_DATA_STATIC_SIZE,
    write: (value, bytes, offset) => {
      bytes.set([BITVEC_DISCRIMINATOR], offset);
      offset += 1;
      getMemoizedU64Encoder().write(BigInt(BITVEC_LENGTH), bytes, offset);
      offset += 8;
      getMemoizedU64ArrayEncoder().write(value.bits, bytes, offset);
      offset += BITVEC_LENGTH * 8;
      getMemoizedU64Encoder().write(BigInt(BITVEC_NUM_BITS), bytes, offset);
      offset += 8;
      getMemoizedU64Encoder().write(value.nextSlot, bytes, offset);
      offset += 8;
      return offset;
    }
  });
}
function getSysvarSlotHistoryDecoder() {
  return codecsCore.createDecoder({
    fixedSize: SLOT_HISTORY_ACCOUNT_DATA_STATIC_SIZE,
    read: (bytes, offset) => {
      if (bytes.length != SLOT_HISTORY_ACCOUNT_DATA_STATIC_SIZE) {
        throw new errors.SolanaError(errors.SOLANA_ERROR__CODECS__INVALID_BYTE_LENGTH, {
          actual: bytes.length,
          expected: SLOT_HISTORY_ACCOUNT_DATA_STATIC_SIZE
        });
      }
      const discriminator = bytes[offset];
      offset += 1;
      if (discriminator !== BITVEC_DISCRIMINATOR) {
        throw new errors.SolanaError(errors.SOLANA_ERROR__CODECS__ENUM_DISCRIMINATOR_OUT_OF_RANGE, {
          actual: discriminator,
          expected: BITVEC_DISCRIMINATOR
        });
      }
      const bitVecLength = getMemoizedU64Decoder().read(bytes, offset)[0];
      offset += 8;
      if (bitVecLength !== BigInt(BITVEC_LENGTH)) {
        throw new errors.SolanaError(errors.SOLANA_ERROR__CODECS__INVALID_NUMBER_OF_ITEMS, {
          actual: bitVecLength,
          codecDescription: "SysvarSlotHistoryCodec",
          expected: BITVEC_LENGTH
        });
      }
      const bits = getMemoizedU64ArrayDecoder().read(bytes, offset)[0];
      offset += BITVEC_LENGTH * 8;
      const numBits = getMemoizedU64Decoder().read(bytes, offset)[0];
      offset += 8;
      if (numBits !== BigInt(BITVEC_NUM_BITS)) {
        throw new errors.SolanaError(errors.SOLANA_ERROR__CODECS__INVALID_NUMBER_OF_ITEMS, {
          actual: numBits,
          codecDescription: "SysvarSlotHistoryCodec",
          expected: BITVEC_NUM_BITS
        });
      }
      const nextSlot = getMemoizedU64Decoder().read(bytes, offset)[0];
      offset += 8;
      return [
        {
          bits,
          nextSlot
        },
        offset
      ];
    }
  });
}
function getSysvarSlotHistoryCodec() {
  return codecsCore.combineCodec(getSysvarSlotHistoryEncoder(), getSysvarSlotHistoryDecoder());
}
async function fetchSysvarSlotHistory(rpc, config) {
  const account = await fetchEncodedSysvarAccount(rpc, SYSVAR_SLOT_HISTORY_ADDRESS, config);
  accounts.assertAccountExists(account);
  const decoded = accounts.decodeAccount(account, getSysvarSlotHistoryDecoder());
  return decoded.data;
}
function getSysvarStakeHistoryEncoder() {
  return codecsDataStructures.getArrayEncoder(
    codecsDataStructures.getStructEncoder([
      ["epoch", codecsNumbers.getU64Encoder()],
      [
        "stakeHistory",
        codecsDataStructures.getStructEncoder([
          ["effective", rpcTypes.getDefaultLamportsEncoder()],
          ["activating", rpcTypes.getDefaultLamportsEncoder()],
          ["deactivating", rpcTypes.getDefaultLamportsEncoder()]
        ])
      ]
    ]),
    { size: codecsNumbers.getU64Encoder() }
  );
}
function getSysvarStakeHistoryDecoder() {
  return codecsDataStructures.getArrayDecoder(
    codecsDataStructures.getStructDecoder([
      ["epoch", codecsNumbers.getU64Decoder()],
      [
        "stakeHistory",
        codecsDataStructures.getStructDecoder([
          ["effective", rpcTypes.getDefaultLamportsDecoder()],
          ["activating", rpcTypes.getDefaultLamportsDecoder()],
          ["deactivating", rpcTypes.getDefaultLamportsDecoder()]
        ])
      ]
    ]),
    { size: codecsNumbers.getU64Decoder() }
  );
}
function getSysvarStakeHistoryCodec() {
  return codecsCore.combineCodec(getSysvarStakeHistoryEncoder(), getSysvarStakeHistoryDecoder());
}
async function fetchSysvarStakeHistory(rpc, config) {
  const account = await fetchEncodedSysvarAccount(rpc, SYSVAR_STAKE_HISTORY_ADDRESS, config);
  accounts.assertAccountExists(account);
  const decoded = accounts.decodeAccount(account, getSysvarStakeHistoryDecoder());
  return decoded.data;
}

exports.SYSVAR_CLOCK_ADDRESS = SYSVAR_CLOCK_ADDRESS;
exports.SYSVAR_EPOCH_REWARDS_ADDRESS = SYSVAR_EPOCH_REWARDS_ADDRESS;
exports.SYSVAR_EPOCH_SCHEDULE_ADDRESS = SYSVAR_EPOCH_SCHEDULE_ADDRESS;
exports.SYSVAR_INSTRUCTIONS_ADDRESS = SYSVAR_INSTRUCTIONS_ADDRESS;
exports.SYSVAR_LAST_RESTART_SLOT_ADDRESS = SYSVAR_LAST_RESTART_SLOT_ADDRESS;
exports.SYSVAR_RECENT_BLOCKHASHES_ADDRESS = SYSVAR_RECENT_BLOCKHASHES_ADDRESS;
exports.SYSVAR_RENT_ADDRESS = SYSVAR_RENT_ADDRESS;
exports.SYSVAR_SLOT_HASHES_ADDRESS = SYSVAR_SLOT_HASHES_ADDRESS;
exports.SYSVAR_SLOT_HISTORY_ADDRESS = SYSVAR_SLOT_HISTORY_ADDRESS;
exports.SYSVAR_STAKE_HISTORY_ADDRESS = SYSVAR_STAKE_HISTORY_ADDRESS;
exports.fetchEncodedSysvarAccount = fetchEncodedSysvarAccount;
exports.fetchJsonParsedSysvarAccount = fetchJsonParsedSysvarAccount;
exports.fetchSysvarClock = fetchSysvarClock;
exports.fetchSysvarEpochRewards = fetchSysvarEpochRewards;
exports.fetchSysvarEpochSchedule = fetchSysvarEpochSchedule;
exports.fetchSysvarLastRestartSlot = fetchSysvarLastRestartSlot;
exports.fetchSysvarRecentBlockhashes = fetchSysvarRecentBlockhashes;
exports.fetchSysvarRent = fetchSysvarRent;
exports.fetchSysvarSlotHashes = fetchSysvarSlotHashes;
exports.fetchSysvarSlotHistory = fetchSysvarSlotHistory;
exports.fetchSysvarStakeHistory = fetchSysvarStakeHistory;
exports.getSysvarClockCodec = getSysvarClockCodec;
exports.getSysvarClockDecoder = getSysvarClockDecoder;
exports.getSysvarClockEncoder = getSysvarClockEncoder;
exports.getSysvarEpochRewardsCodec = getSysvarEpochRewardsCodec;
exports.getSysvarEpochRewardsDecoder = getSysvarEpochRewardsDecoder;
exports.getSysvarEpochRewardsEncoder = getSysvarEpochRewardsEncoder;
exports.getSysvarEpochScheduleCodec = getSysvarEpochScheduleCodec;
exports.getSysvarEpochScheduleDecoder = getSysvarEpochScheduleDecoder;
exports.getSysvarEpochScheduleEncoder = getSysvarEpochScheduleEncoder;
exports.getSysvarLastRestartSlotCodec = getSysvarLastRestartSlotCodec;
exports.getSysvarLastRestartSlotDecoder = getSysvarLastRestartSlotDecoder;
exports.getSysvarLastRestartSlotEncoder = getSysvarLastRestartSlotEncoder;
exports.getSysvarRecentBlockhashesCodec = getSysvarRecentBlockhashesCodec;
exports.getSysvarRecentBlockhashesDecoder = getSysvarRecentBlockhashesDecoder;
exports.getSysvarRecentBlockhashesEncoder = getSysvarRecentBlockhashesEncoder;
exports.getSysvarRentCodec = getSysvarRentCodec;
exports.getSysvarRentDecoder = getSysvarRentDecoder;
exports.getSysvarRentEncoder = getSysvarRentEncoder;
exports.getSysvarSlotHashesCodec = getSysvarSlotHashesCodec;
exports.getSysvarSlotHashesDecoder = getSysvarSlotHashesDecoder;
exports.getSysvarSlotHashesEncoder = getSysvarSlotHashesEncoder;
exports.getSysvarSlotHistoryCodec = getSysvarSlotHistoryCodec;
exports.getSysvarSlotHistoryDecoder = getSysvarSlotHistoryDecoder;
exports.getSysvarSlotHistoryEncoder = getSysvarSlotHistoryEncoder;
exports.getSysvarStakeHistoryCodec = getSysvarStakeHistoryCodec;
exports.getSysvarStakeHistoryDecoder = getSysvarStakeHistoryDecoder;
exports.getSysvarStakeHistoryEncoder = getSysvarStakeHistoryEncoder;
//# sourceMappingURL=index.browser.cjs.map
//# sourceMappingURL=index.browser.cjs.map