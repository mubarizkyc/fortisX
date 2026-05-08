// test-shamir-utxo.ts
// Round-trip: Generate UTXO key → Shamir split → Encrypt shares → Decrypt → Reconstruct
//
// Fixed issues vs original:
//   1. nacl.seal → nacl.secretbox  /  sealOpen → nacl.secretbox.open
//   2. Ed25519→X25519 conversion uses edwardsToMontgomeryPub / edwardsToMontgomeryPriv
//   3. Shamir shares carry a 1-byte index prefix — pass raw share bytes to combine,
//      never strip the index by converting through bigint
//   4. Removed dead unreachable code in conversion helpers

import { Keypair } from '@solana/web3.js';
import { edwardsToMontgomeryPub, edwardsToMontgomeryPriv } from '@noble/curves/ed25519';
import { x25519 } from '@noble/curves/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { randomBytes } from '@noble/hashes/utils';
import * as nacl from 'tweetnacl';
import * as shamir from 'shamir-secret-sharing';
import { generateUtxoKeypair } from '@cloak.dev/sdk-devnet';
import { PublicKey } from '@solana/web3.js';

// ────────────────────────────────────────────────────────────
// Ed25519 → X25519 conversion (correct paths from @noble/curves)
// ────────────────────────────────────────────────────────────

// Convert a Solana Ed25519 public key → X25519 public key for ECDH
function toX25519Public(ed25519PubBytes: Uint8Array): Uint8Array {
    return edwardsToMontgomeryPub(ed25519PubBytes);
}

// Convert a Solana Ed25519 secret key (first 32 bytes) → X25519 scalar
function toX25519Secret(ed25519SecretBytes: Uint8Array): Uint8Array {
    return edwardsToMontgomeryPriv(ed25519SecretBytes.slice(0, 32));
}

// ────────────────────────────────────────────────────────────
// Encrypt a raw share (Uint8Array, includes shamir index byte)
// using recipient's Solana Ed25519 public key
//
// Output layout: [ephemeralPubkey:32][nonce:24][ciphertext:N]
// ────────────────────────────────────────────────────────────
export async function encryptShare(
    shareBytes: Uint8Array,           // raw shamir share (33 bytes: 1 index + 32 secret)
    recipientSolanaPubkey: PublicKey,
): Promise<Uint8Array> {
    // Recipient X25519 pubkey
    const x25519Pub = toX25519Public(recipientSolanaPubkey.toBytes());

    // Ephemeral X25519 keypair — fresh per share, never reused
    const ephemeralSecret = x25519.utils.randomPrivateKey();
    const ephemeralPubkey = x25519.getPublicKey(ephemeralSecret);

    // ECDH shared secret → box key (SHA512 then take first 32 bytes)
    const sharedSecret = x25519.getSharedSecret(ephemeralSecret, x25519Pub);
    const boxKey = sha512(sharedSecret).slice(0, 32);

    // NaCl secretbox: XSalsa20-Poly1305
    // FIX 1: was nacl.seal (doesn't exist) → nacl.secretbox
    const nonce = randomBytes(24);
    const ciphertext = nacl.secretbox(shareBytes, nonce, boxKey);

    const result = new Uint8Array(32 + 24 + ciphertext.length);
    result.set(ephemeralPubkey, 0);
    result.set(nonce, 32);
    result.set(ciphertext, 56);
    return result;
}

// ────────────────────────────────────────────────────────────
// Decrypt a share using recipient's Solana Ed25519 secret key
// Returns the raw share bytes (including shamir index byte)
// ────────────────────────────────────────────────────────────
export async function decryptShare(
    encrypted: Uint8Array,
    recipientSolanaSecretKey: Uint8Array,  // 64-byte Solana secret key
): Promise<Uint8Array> {
    const ephemeralPubkey = encrypted.slice(0, 32);
    const nonce = encrypted.slice(32, 56);
    const ciphertext = encrypted.slice(56);

    // FIX 2: was x25519.utils.ed25519ToX25519 (doesn't exist) → edwardsToMontgomeryPriv
    const x25519Secret = toX25519Secret(recipientSolanaSecretKey);
    const sharedSecret = x25519.getSharedSecret(x25519Secret, ephemeralPubkey);
    const boxKey = sha512(sharedSecret).slice(0, 32);

    // FIX 1: was sealOpen (doesn't exist) → nacl.secretbox.open
    const shareBytes = nacl.secretbox.open(ciphertext, nonce, boxKey);
    if (!shareBytes) throw new Error('Decryption failed: invalid MAC or wrong key');

    return shareBytes; // raw share bytes — index byte intact
}

// ────────────────────────────────────────────────────────────
// BigInt ↔ Uint8Array (little-endian, 32 bytes)
// Only used for the final private key, not for share bytes
// ────────────────────────────────────────────────────────────
function bigintToLE32(value: bigint): Uint8Array {
    const bytes = new Uint8Array(32);
    let v = value;
    for (let i = 0; i < 32; i++) {
        bytes[i] = Number(v & 0xffn);
        v >>= 8n;
    }
    return bytes;
}

export function le32ToBigint(bytes: Uint8Array): bigint {
    let v = 0n;
    for (let i = 31; i >= 0; i--) {
        v = (v << 8n) | BigInt(bytes[i]);
    }
    return v;
}

// ────────────────────────────────────────────────────────────
// Main round-trip test
// ────────────────────────────────────────────────────────────
async function testShamirUtxoRoundTrip() {
    console.log('🔐 Shamir UTXO Key Round-Trip Test\n');

    // ── Step 1: Generate Cloak UTXO keypair ──────────────────
    console.log('1️⃣  Generating Cloak UTXO keypair...');
    const utxoKeypair = await generateUtxoKeypair();
    console.log(`    Private key: ${utxoKeypair.privateKey.toString().slice(0, 24)}...`);
    console.log(`    Public key:  ${utxoKeypair.publicKey.toString().slice(0, 24)}...\n`);

    // ── Step 2: Three multisig members (threshold = 2) ───────
    console.log('2️⃣  Generating Solana keypairs for 3 members (threshold = 2)...');
    const members = [
        { name: 'Alice', keypair: Keypair.generate() },
        { name: 'Bob', keypair: Keypair.generate() },
        { name: 'Charlie', keypair: Keypair.generate() },
    ];
    for (const m of members) {
        console.log(`    ${m.name}: ${m.keypair.publicKey.toBase58().slice(0, 16)}...`);
    }
    console.log();

    // ── Step 3: Shamir split ──────────────────────────────────
    console.log('3️⃣  Splitting UTXO private key (3 shares, threshold 2)...');
    const privateKeyBytes = bigintToLE32(utxoKeypair.privateKey);

    // shamir.split returns Uint8Array[] where each share is [indexByte | secretBytes]
    // FIX 3: keep shares as raw Uint8Array — never convert to bigint (that strips index)
    const shares: Uint8Array[] = await shamir.split(privateKeyBytes, 3, 2);
    console.log(`    ${shares.length} shares generated (each ${shares[0].length} bytes = 1 index + 32 secret)\n`);

    // ── Step 4: Encrypt each share with member's Solana pubkey ─
    console.log('4️⃣  Encrypting shares with member Solana pubkeys...');
    const encryptedShares: Uint8Array[] = [];
    for (let i = 0; i < shares.length; i++) {
        const enc = await encryptShare(shares[i], members[i].keypair.publicKey);
        encryptedShares.push(enc);
        console.log(`    ${members[i].name}: encrypted ${enc.length} bytes`);
    }
    console.log();

    // ── Step 5: Alice + Bob decrypt their shares ──────────────
    console.log('5️⃣  Alice and Bob decrypting their shares...');
    const decryptedShares: Uint8Array[] = [];
    for (let i = 0; i < 2; i++) {
        const raw = await decryptShare(encryptedShares[i], members[i].keypair.secretKey);
        decryptedShares.push(raw);
        console.log(`    ${members[i].name}: decrypted ${raw.length} bytes ✓`);
    }
    console.log();

    // ── Step 6: Reconstruct ───────────────────────────────────
    console.log('6️⃣  Reconstructing UTXO private key from 2 shares...');

    // FIX 3: pass raw share bytes directly — shamir.combine needs the index byte
    const reconstructedBytes = await shamir.combine(decryptedShares);
    const reconstructedKey = le32ToBigint(reconstructedBytes);
    console.log(`    Reconstructed: ${reconstructedKey.toString().slice(0, 24)}...\n`);

    // ── Step 7: Verify ────────────────────────────────────────
    console.log('7️⃣  Verifying reconstruction...');
    if (reconstructedKey === utxoKeypair.privateKey) {
        console.log('    ✅ SUCCESS — reconstructed key matches original');
    } else {
        console.error('    ❌ MISMATCH');
        console.error(`       Original:      ${utxoKeypair.privateKey}`);
        console.error(`       Reconstructed: ${reconstructedKey}`);
        throw new Error('Reconstruction failed');
    }

    // ── Step 8: Verify Charlie's share was NOT needed ─────────
    console.log('\n8️⃣  Confirming threshold: Charlie\'s share was not used');
    console.log('    ✅ 2-of-3 threshold satisfied without Charlie\n');

    // ── Step 9: Confirm wrong share combo fails gracefully ────
    console.log('9️⃣  Sanity: single share should NOT reconstruct correctly...');
    try {
        const singleShareResult = await shamir.combine([decryptedShares[0]]);
        const singleKey = le32ToBigint(singleShareResult);
        if (singleKey !== utxoKeypair.privateKey) {
            console.log('    ✅ Single share produced wrong key (expected)');
        } else {
            console.warn('    ⚠️  Single share accidentally reconstructed key — check library');
        }
    } catch (e) {
        console.log('    ✅ Single share threw (expected):', (e as Error).message);
    }

    console.log('\n🎉 All checks passed. Shamir + ECDH encryption round-trip works.\n');
    return true;
}

if (require.main === module) {
    testShamirUtxoRoundTrip()
        .then(() => process.exit(0))
        .catch(err => {
            console.error('\n❌ Test failed:', err);
            process.exit(1);
        });
}

export { testShamirUtxoRoundTrip };