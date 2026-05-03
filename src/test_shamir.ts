// test-shamir-roundtrip.ts — FIXED VERSION
import { split, combine } from 'shamir-secret-sharing';
import { bigintToLittleEndianBytes, bytes32ToBigint } from './src/utils';

async function testRoundTripWithEndianness() {
    const original = 8166303775583916744822715250152593622861098876485478942921597845219477349668n;

    // 1. Convert to little-endian (Solana format)
    const originalLE = bigintToLittleEndianBytes(original, 32);

    // 2. Convert to big-endian for Shamir
    const originalBE = new Uint8Array(originalLE).reverse();

    // 3. Split with big-endian
    const shares = await split(originalBE, 3, 2);

    // 4. Reconstruct (returns big-endian)
    const reconstructedBE = await combine([shares[0], shares[1]]);

    // 5. Convert back to little-endian
    let reconstructedLE: Uint8Array;
    if (reconstructedBE.length === 33) {
        reconstructedLE = new Uint8Array(reconstructedBE.slice(1, 33)).reverse();
    } else {
        reconstructedLE = new Uint8Array(reconstructedBE).reverse();
    }

    // 6. Convert to bigint
    const reconstructed = bytes32ToBigint(reconstructedLE);

    // 7. Verify
    console.log('Original:     ', original.toString(16).padStart(64, '0'));
    console.log('Reconstructed:', reconstructed.toString(16).padStart(64, '0'));
    console.log('Match:', original === reconstructed ? '✅ YES' : '❌ NO');
}

testRoundTripWithEndianness().catch(console.error);