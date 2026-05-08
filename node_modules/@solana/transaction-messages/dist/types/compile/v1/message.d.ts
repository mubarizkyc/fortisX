import { Address } from '@solana/addresses';
import { TransactionMessageWithFeePayer } from '../../fee-payer';
import { TransactionMessage } from '../../transaction-message';
import { getCompiledMessageHeader } from '../legacy/header';
import { ForwardTransactionMessageLifetime } from '../message-types';
import { getTransactionConfigValues } from './config';
import { getInstructionHeader, getInstructionPayload } from './instructions';
export type V1CompiledTransactionMessage = Readonly<{
    /** A mask indicating which transaction config values are present */
    configMask: number;
    /** The configuration values for the transaction */
    configValues: ReturnType<typeof getTransactionConfigValues>;
    /** Information about the role of the accounts loaded. */
    header: ReturnType<typeof getCompiledMessageHeader>;
    /** The headers for each instruction in the transaction */
    instructionHeaders: ReturnType<typeof getInstructionHeader>[];
    /** The payload for each instruction in the transaction */
    instructionPayloads: ReturnType<typeof getInstructionPayload>[];
    /** The number of instructions in the transaction */
    numInstructions: number;
    /** The number of static accounts in the transaction */
    numStaticAccounts: number;
    /** A list of addresses indicating which accounts to load */
    staticAccounts: Address[];
    version: 1;
}>;
export declare function compileTransactionMessage<TTransactionMessage extends TransactionMessage & TransactionMessageWithFeePayer & {
    version: 1;
}>(transactionMessage: TTransactionMessage): ForwardTransactionMessageLifetime<V1CompiledTransactionMessage, TTransactionMessage>;
//# sourceMappingURL=message.d.ts.map