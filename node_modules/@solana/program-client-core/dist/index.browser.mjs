import { isProgramDerivedAddress } from '@solana/addresses';
import { SolanaError, SOLANA_ERROR__PROGRAM_CLIENTS__RESOLVED_INSTRUCTION_INPUT_MUST_BE_NON_NULL, SOLANA_ERROR__PROGRAM_CLIENTS__UNEXPECTED_RESOLVED_INSTRUCTION_INPUT_TYPE } from '@solana/errors';
import { AccountRole, upgradeRoleToSigner } from '@solana/instructions';
import { isTransactionSigner } from '@solana/signers';
import { fetchEncodedAccount, decodeAccount, fetchEncodedAccounts, assertAccountExists, assertAccountsExist } from '@solana/accounts';

// src/instruction-input-resolution.ts
function getNonNullResolvedInstructionInput(inputName, value) {
  if (value === null || value === void 0) {
    throw new SolanaError(SOLANA_ERROR__PROGRAM_CLIENTS__RESOLVED_INSTRUCTION_INPUT_MUST_BE_NON_NULL, {
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
  if (!isProgramDerivedAddress(value)) {
    throw new SolanaError(SOLANA_ERROR__PROGRAM_CLIENTS__UNEXPECTED_RESOLVED_INSTRUCTION_INPUT_TYPE, {
      expectedType: "ProgramDerivedAddress",
      inputName
    });
  }
  return value;
}
function getResolvedInstructionAccountAsTransactionSigner(inputName, value) {
  if (!isResolvedInstructionAccountSigner(value)) {
    throw new SolanaError(SOLANA_ERROR__PROGRAM_CLIENTS__UNEXPECTED_RESOLVED_INSTRUCTION_INPUT_TYPE, {
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
      return Object.freeze({ address: programAddress, role: AccountRole.READONLY });
    }
    const writableRole = account.isWritable ? AccountRole.WRITABLE : AccountRole.READONLY;
    const isSigner = isResolvedInstructionAccountSigner(account.value);
    return Object.freeze({
      address: getAddressFromResolvedInstructionAccount(inputName, account.value),
      role: isSigner ? upgradeRoleToSigner(writableRole) : writableRole,
      ...isSigner ? { signer: account.value } : {}
    });
  };
}
function isResolvedInstructionAccountSigner(value) {
  return !!value && typeof value === "object" && "address" in value && typeof value.address === "string" && isTransactionSigner(value);
}
function addSelfFetchFunctions(client, codec) {
  const fetchMaybe = async (address, config) => {
    const maybeAccount = await fetchEncodedAccount(client.rpc, address, config);
    return decodeAccount(maybeAccount, codec);
  };
  const fetchAllMaybe = async (addresses, config) => {
    const maybeAccounts = await fetchEncodedAccounts(client.rpc, addresses, config);
    return maybeAccounts.map((maybeAccount) => decodeAccount(maybeAccount, codec));
  };
  const fetch = async (address, config) => {
    const maybeAccount = await fetchMaybe(address, config);
    assertAccountExists(maybeAccount);
    return maybeAccount;
  };
  const fetchAll = async (addresses, config) => {
    const maybeAccounts = await fetchAllMaybe(addresses, config);
    assertAccountsExist(maybeAccounts);
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

export { addSelfFetchFunctions, addSelfPlanAndSendFunctions, getAccountMetaFactory, getAddressFromResolvedInstructionAccount, getNonNullResolvedInstructionInput, getResolvedInstructionAccountAsProgramDerivedAddress, getResolvedInstructionAccountAsTransactionSigner };
//# sourceMappingURL=index.browser.mjs.map
//# sourceMappingURL=index.browser.mjs.map