import { CompiledTransactionMessage, CompiledTransactionMessageWithLifetime } from '../../compile';
import { TransactionMessageWithFeePayer } from '../../fee-payer';
import { TransactionMessageWithLifetime } from '../../lifetime';
import { TransactionMessage } from '../../transaction-message';
export declare function decompileTransactionMessage(compiledTransactionMessage: CompiledTransactionMessage & CompiledTransactionMessageWithLifetime & {
    version: 1;
}, config?: {
    lastValidBlockHeight?: bigint;
}): TransactionMessage & TransactionMessageWithFeePayer & TransactionMessageWithLifetime & {
    version: 1;
};
//# sourceMappingURL=message.d.ts.map