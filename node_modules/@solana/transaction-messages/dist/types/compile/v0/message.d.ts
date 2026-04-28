import { Address } from '@solana/addresses';
import { TransactionMessageWithFeePayer } from '../../fee-payer';
import { TransactionMessage } from '../../transaction-message';
import { getCompiledMessageHeader } from '../legacy/header';
import { ForwardTransactionMessageLifetime } from '../message-types';
import { getCompiledAddressTableLookups } from './address-table-lookups';
import { getCompiledInstructions } from './instructions';
export type V0CompiledTransactionMessage = Readonly<{
    /** A list of address tables and the accounts that this transaction loads from them */
    addressTableLookups?: ReturnType<typeof getCompiledAddressTableLookups>;
    /** Information about the role of the accounts loaded. */
    header: ReturnType<typeof getCompiledMessageHeader>;
    /** A list of instructions that this transaction will execute */
    instructions: ReturnType<typeof getCompiledInstructions>;
    /** A list of addresses indicating which accounts to load */
    staticAccounts: Address[];
    version: 0;
}>;
export declare function compileTransactionMessage<TTransactionMessage extends TransactionMessage & TransactionMessageWithFeePayer>(transactionMessage: TTransactionMessage): ForwardTransactionMessageLifetime<V0CompiledTransactionMessage, TTransactionMessage>;
//# sourceMappingURL=message.d.ts.map