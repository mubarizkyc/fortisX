// test-shamir-roundtrip.ts — FIXED VERSION
import { split, combine } from 'shamir-secret-sharing';
//import { bigIntToLittleEndianBytes } from './utils';
import { bytes32ToBigint } from './commands/createMultisig';
import { PublicKey, Connection } from '@solana/web3.js';
async function testRoundTripWithEndianness() {
    const multisigAddress = new PublicKey('BLUHe8sSDcPBQ5TH6BPJPNZVStqprZpZgg3wK8i4LRho'); // replace with actual multisig address
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    const multisigAccount = await connection.getAccountInfo(multisigAddress)
    if (!multisigAccount) throw new Error('Multisig account not found')

    // Multisig header layout:
    // [0..32)   create_key
    // [32..64)  rent_collector  
    // [64..96)  treasury_utxo_pubkey  ← here
    const treasuryPublicKey = bytes32ToBigint(
        new Uint8Array(multisigAccount.data.slice(64, 96))
    )
    console.log('Treasury pubkey (BigInt):', treasuryPublicKey);
}

testRoundTripWithEndianness().catch(console.error);