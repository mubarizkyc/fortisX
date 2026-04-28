import { CompiledTransactionMessage, CompiledTransactionMessageWithLifetime } from '../..';
import { AddressesByLookupTableAddress } from '../../addresses-by-lookup-table-address';
import { TransactionMessageWithFeePayer } from '../../fee-payer';
import { TransactionMessageWithLifetime } from '../../lifetime';
import { TransactionMessage } from '../../transaction-message';
export type DecompileTransactionMessageConfig = {
    addressesByLookupTableAddress?: AddressesByLookupTableAddress;
    lastValidBlockHeight?: bigint;
};
export declare function decompileTransactionMessage(compiledTransactionMessage: CompiledTransactionMessage & CompiledTransactionMessageWithLifetime & {
    version: 0;
}, config?: DecompileTransactionMessageConfig): TransactionMessage & TransactionMessageWithFeePayer & TransactionMessageWithLifetime;
//# sourceMappingURL=message.d.ts.map