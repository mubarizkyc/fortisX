import { Address } from '@solana/addresses';
import { AccountMeta, Instruction, ReadonlyAccount, ReadonlySignerAccount, WritableAccount, WritableSignerAccount } from '@solana/instructions';
import { Brand } from '@solana/nominal-types';
export declare const enum AddressMapEntryType {
    FEE_PAYER = 0,
    STATIC = 1
}
type AddressMap = {
    [address: string]: FeePayerAccountEntry | StaticAccountEntry;
};
type FeePayerAccountEntry = Omit<WritableSignerAccount, 'address'> & {
    [TYPE]: AddressMapEntryType.FEE_PAYER;
};
export type OrderedAccounts = Brand<AccountMeta[], 'OrderedAccounts'>;
type StaticAccountEntry = Omit<ReadonlyAccount | ReadonlySignerAccount | WritableAccount | WritableSignerAccount, 'address'> & {
    [TYPE]: AddressMapEntryType.STATIC;
};
declare const TYPE: unique symbol;
export declare const ADDRESS_MAP_TYPE_PROPERTY: typeof TYPE;
export declare function getAddressMapFromInstructions(feePayer: Address, instructions: readonly Instruction[]): AddressMap;
export declare function getOrderedAccountsFromAddressMap(addressMap: AddressMap): OrderedAccounts;
export {};
//# sourceMappingURL=accounts.d.ts.map