// src/utils/decryptShare.ts
import nacl from 'tweetnacl';
import { convertPublicKey, convertSecretKey } from 'ed2curve'; // ✅ Use ed2curve
import { PublicKey, Keypair, Connection } from '@solana/web3.js';
import { ENCRYPTED_SHARE_SIZE, SHARE_CIPHERTEXT_SIZE, SHARE_RAW_SIZE } from './commands/createMultisig';
// ─── decrypt ─────────────────────────────────────────────
// ─── decrypt (fix the key conversion) ────────────────────
export function decryptShareFromMember(
    encryptedShare: Uint8Array,
    memberSecretKey: Uint8Array,  // 64-byte ed25519 OR 32-byte seed
): Uint8Array {
    if (encryptedShare.length !== 105) {
        throw new Error(`Expected 105 bytes, got ${encryptedShare.length}`)
    }

    const ephemeralPubkey = encryptedShare.slice(0, 32)
    const nonce = encryptedShare.slice(32, 56)
    const box = encryptedShare.slice(56)

    // ✅ ed2curve.convertSecretKey wants exactly 32 bytes (the seed)
    // Solana Keypair.secretKey is 64 bytes: [32 seed][32 pubkey]
    // take first 32 bytes regardless of input length
    const seed = memberSecretKey.length === 64
        ? memberSecretKey.slice(0, 32)
        : memberSecretKey

    const memberX25519 = convertSecretKey(seed)
    if (!memberX25519) throw new Error('Failed to convert secret key to x25519')

    const plaintext = nacl.box.open(box, nonce, ephemeralPubkey, memberX25519)
    if (!plaintext) {
        // extra debug
        console.error('Decrypt failed debug:')
        console.error('  ephemeralPubkey:', Buffer.from(ephemeralPubkey).toString('hex').slice(0, 16))
        console.error('  nonce:', Buffer.from(nonce).toString('hex').slice(0, 16))
        console.error('  seed used:', Buffer.from(seed).toString('hex').slice(0, 16))
        throw new Error('Decryption failed — wrong key or corrupted share')
    }

    return plaintext
}

// Offsets - MUST match Rust Multisig struct
const MULTISIG_HEADER_SIZE = 139;
const MEMBERS_LEN_OFFSET = MULTISIG_HEADER_SIZE; // 140
const MEMBER_PUBKEY_SIZE = 32;

export async function fetchAndDecryptShare(
    multisigAddress: PublicKey,
    memberKeypair: Keypair,
    connection: Connection
): Promise<Uint8Array> {

    const account = await connection.getAccountInfo(multisigAddress);
    if (!account) throw new Error('Multisig account not found');

    // Parse members_len
    const members_len = account.data.readUInt32LE(MEMBERS_LEN_OFFSET);
    console.log(multisigAddress)
    console.log(`Members count: ${members_len}`);
    // Calculate offsets
    const members_array_offset = MEMBERS_LEN_OFFSET + 4;
    const shares_count_offset = members_array_offset + (members_len * MEMBER_PUBKEY_SIZE);
    const shares_data_offset = shares_count_offset + 4;

    // Parse shares count
    const shares_count = account.data.readUInt32LE(shares_count_offset);

    // Bounds check
    const expected_end = shares_data_offset + (shares_count * ENCRYPTED_SHARE_SIZE);
    if (expected_end > account.data.length) {
        throw new Error(`Account data too short: expected ${expected_end}, got ${account.data.length}`);
    }

    // Search for member's encrypted share
    for (let i = 0; i < shares_count; i++) {
        const share_start = shares_data_offset + (i * ENCRYPTED_SHARE_SIZE);
        const shareBytes = account.data.slice(share_start, share_start + ENCRYPTED_SHARE_SIZE);

        const storedMemberPubkey = new PublicKey(shareBytes.slice(0, 32));

        if (storedMemberPubkey.equals(memberKeypair.publicKey)) {
            const encryptedShare = shareBytes.slice(32); // 105bytes
            return decryptShareFromMember(encryptedShare, memberKeypair.secretKey);
        }
    }

    throw new Error(`No encrypted share found for member ${memberKeypair.publicKey.toBase58()}`);
}