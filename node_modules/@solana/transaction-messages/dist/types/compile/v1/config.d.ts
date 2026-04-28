import { V1TransactionConfig } from '../../v1-transaction-config';
export declare function getTransactionConfigMask(config: V1TransactionConfig): number;
export type CompiledTransactionConfigValue = {
    kind: 'u32';
    value: number;
} | {
    kind: 'u64';
    value: bigint;
};
export declare function getTransactionConfigValues(config: V1TransactionConfig): CompiledTransactionConfigValue[];
//# sourceMappingURL=config.d.ts.map