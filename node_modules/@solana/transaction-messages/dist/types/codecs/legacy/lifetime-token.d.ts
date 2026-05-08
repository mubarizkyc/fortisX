import { FixedSizeDecoder, FixedSizeEncoder } from '@solana/codecs-core';
import { getCompiledLifetimeToken } from '../../compile/legacy/lifetime-token';
type LifetimeToken = ReturnType<typeof getCompiledLifetimeToken>;
export declare function getLifetimeTokenEncoder(): FixedSizeEncoder<LifetimeToken | undefined>;
export declare function getLifetimeTokenDecoder(): FixedSizeDecoder<LifetimeToken>;
export {};
//# sourceMappingURL=lifetime-token.d.ts.map