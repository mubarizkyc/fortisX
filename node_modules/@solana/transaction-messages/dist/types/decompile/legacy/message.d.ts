import { CompiledTransactionMessage, CompiledTransactionMessageWithLifetime } from '../..';
import { TransactionMessageWithFeePayer } from '../../fee-payer';
import { TransactionMessageWithLifetime } from '../../lifetime';
import { TransactionMessage } from '../../transaction-message';
export declare function decompileTransactionMessage(compiledTransactionMessage: CompiledTransactionMessage & CompiledTransactionMessageWithLifetime & {
    version: 'legacy';
}, config?: {
    lastValidBlockHeight?: bigint;
}): TransactionMessage & TransactionMessageWithFeePayer & TransactionMessageWithLifetime & {
    version: 'legacy';
};
//# sourceMappingURL=message.d.ts.map