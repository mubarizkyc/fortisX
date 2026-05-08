'use strict';

var addresses = require('@solana/addresses');
var errors = require('@solana/errors');
var instructions = require('@solana/instructions');
var signers = require('@solana/signers');
var accounts = require('@solana/accounts');

// src/instruction-input-resolution.ts
function getNonNullResolvedInstructionInput(inputName, value) {
  if (value === null || value === void 0) {
    throw new errors.SolanaError(errors.SOLANA_ERROR__PROGRAM_CLIENTS__RESOLVED_INSTRUCTION_INPUT_MUST_BE_NON_NULL, {
      inputName
    });
  }
  return value;
}
function getAddressFromResolvedInstructionAccount(inputName, value) {
  const nonNullValue = getNonNullResolvedInstructionInput(inputName, value);
  if (typeof value === "object" && "address" in nonNullValue) {
    return nonNullValue.address;
  }
  if (Array.isArray(nonNullValue)) {
    return nonNullValue[0];
  }
  return nonNullValue;
}
function getResolvedInstructionAccountAsProgramDerivedAddress(inputName, value) {
  if (!addresses.isProgramDerivedAddress(value)) {
    throw new errors.SolanaError(errors.SOLANA_ERROR__PROGRAM_CLIENTS__UNEXPECTED_RESOLVED_INSTRUCTION_INPUT_TYPE, {
      expectedType: "ProgramDerivedAddress",
      inputName
    });
  }
  return value;
}
function getResolvedInstructionAccountAsTransactionSigner(inputName, value) {
  if (!isResolvedInstructionAccountSigner(value)) {
    throw new errors.SolanaError(errors.SOLANA_ERROR__PROGRAM_CLIENTS__UNEXPECTED_RESOLVED_INSTRUCTION_INPUT_TYPE, {
      expectedType: "TransactionSigner",
      inputName
    });
  }
  return value;
}
function getAccountMetaFactory(programAddress, optionalAccountStrategy) {
  return (inputName, account) => {
    if (!account.value) {
      if (optionalAccountStrategy === "omitted") return;
      return Object.freeze({ address: programAddress, role: instructions.AccountRole.READONLY });
    }
    const writableRole = account.isWritable ? instructions.AccountRole.WRITABLE : instructions.AccountRole.READONLY;
    const isSigner = isResolvedInstructionAccountSigner(account.value);
    return Object.freeze({
      address: getAddressFromResolvedInstructionAccount(inputName, account.value),
      role: isSigner ? instructions.upgradeRoleToSigner(writableRole) : writableRole,
      ...isSigner ? { signer: account.value } : {}
    });
  };
}
function isResolvedInstructionAccountSigner(value) {
  return !!value && typeof value === "object" && "address" in value && typeof value.address === "string" && signers.isTransactionSigner(value);
}
function addSelfFetchFunctions(client, codec) {
  const fetchMaybe = async (address, config) => {
    const maybeAccount = await accounts.fetchEncodedAccount(client.rpc, address, config);
    return accounts.decodeAccount(maybeAccount, codec);
  };
  const fetchAllMaybe = async (addresses, config) => {
    const maybeAccounts = await accounts.fetchEncodedAccounts(client.rpc, addresses, config);
    return maybeAccounts.map((maybeAccount) => accounts.decodeAccount(maybeAccount, codec));
  };
  const fetch = async (address, config) => {
    const maybeAccount = await fetchMaybe(address, config);
    accounts.assertAccountExists(maybeAccount);
    return maybeAccount;
  };
  const fetchAll = async (addresses, config) => {
    const maybeAccounts = await fetchAllMaybe(addresses, config);
    accounts.assertAccountsExist(maybeAccounts);
    return maybeAccounts;
  };
  const out = { ...codec, fetch, fetchAll, fetchAllMaybe, fetchMaybe };
  return Object.freeze(out);
}

// src/self-plan-and-send-functions.ts
function addSelfPlanAndSendFunctions(client, input) {
  if (isPromiseLike(input)) {
    const newInput = input;
    newInput.planTransaction = async (config) => await client.planTransaction(await input, config);
    newInput.planTransactions = async (config) => await client.planTransactions(await input, config);
    newInput.sendTransaction = async (config) => await client.sendTransaction(await input, config);
    newInput.sendTransactions = async (config) => await client.sendTransactions(await input, config);
    return newInput;
  }
  return Object.freeze({
    ...input,
    planTransaction: (config) => client.planTransaction(input, config),
    planTransactions: (config) => client.planTransactions(input, config),
    sendTransaction: (config) => client.sendTransaction(input, config),
    sendTransactions: (config) => client.sendTransactions(input, config)
  });
}
function isPromiseLike(item) {
  return !!item && (typeof item === "object" || typeof item === "function") && typeof item.then === "function";
}

exports.addSelfFetchFunctions = addSelfFetchFunctions;
exports.addSelfPlanAndSendFunctions = addSelfPlanAndSendFunctions;
exports.getAccountMetaFactory = getAccountMetaFactory;
exports.getAddressFromResolvedInstructionAccount = getAddressFromResolvedInstructionAccount;
exports.getNonNullResolvedInstructionInput = getNonNullResolvedInstructionInput;
exports.getResolvedInstructionAccountAsProgramDerivedAddress = getResolvedInstructionAccountAsProgramDerivedAddress;
exports.getResolvedInstructionAccountAsTransactionSigner = getResolvedInstructionAccountAsTransactionSigner;
//# sourceMappingURL=index.node.cjs.map
//# sourceMappingURL=index.node.cjs.map