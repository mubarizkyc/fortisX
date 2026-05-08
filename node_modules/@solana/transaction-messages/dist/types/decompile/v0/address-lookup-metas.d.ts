import { AccountLookupMeta } from '@solana/instructions';
import { AddressesByLookupTableAddress } from '../../addresses-by-lookup-table-address';
import { getCompiledAddressTableLookups } from '../../compile/v0/address-table-lookups';
export declare function getAddressLookupMetas(compiledAddressTableLookups: ReturnType<typeof getCompiledAddressTableLookups>, addressesByLookupTableAddress: AddressesByLookupTableAddress): AccountLookupMeta[];
//# sourceMappingURL=address-lookup-metas.d.ts.map