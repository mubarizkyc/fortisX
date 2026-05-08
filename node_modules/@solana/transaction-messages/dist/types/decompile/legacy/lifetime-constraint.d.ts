import { Instruction } from '@solana/instructions';
import { BlockhashLifetimeConstraint } from '../../blockhash';
import { setTransactionMessageLifetimeUsingDurableNonce } from '../../durable-nonce';
type LifetimeConstraint = BlockhashLifetimeConstraint | Parameters<typeof setTransactionMessageLifetimeUsingDurableNonce>[0];
export declare function getLifetimeConstraint(messageLifetimeToken: string, instructions: Instruction[], lastValidBlockHeight?: bigint): LifetimeConstraint;
export {};
//# sourceMappingURL=lifetime-constraint.d.ts.map