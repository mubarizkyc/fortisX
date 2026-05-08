// src/utils/shamirCrypto.ts
import { PublicKey, Keypair, Connection } from '@solana/web3.js';
import { edwardsToMontgomeryPub, edwardsToMontgomeryPriv, x25519 } from '@noble/curves/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { randomBytes } from '@noble/hashes/utils';
import * as nacl from 'tweetnacl';
import { decryptShare } from './test_shamir';
const MULTISIG_HEADER_SIZE = 139;
const MEMBER_PUBKEY_SIZE = 32;
const ENCRYPTED_SHARE_CIPHERTEXT_SIZE = 105;  // 32 ephemeral + 24 nonce + 33 plaintext + 16 mac
const ONCHAIN_ENTRY_SIZE = MEMBER_PUBKEY_SIZE + ENCRYPTED_SHARE_CIPHERTEXT_SIZE; // 137

export async function fetchAndDecryptShare(
    multisigAddress: PublicKey,
    memberKeypair: Keypair,
    connection: Connection,
): Promise<Uint8Array> {
    const account = await connection.getAccountInfo(multisigAddress);
    if (!account) throw new Error('Multisig account not found');

    // Parse members_len at MULTISIG_HEADER_SIZE
    const members_len = account.data.readUInt32LE(MULTISIG_HEADER_SIZE);
    const members_end = MULTISIG_HEADER_SIZE + 4 + (members_len * MEMBER_PUBKEY_SIZE);

    // shares_count immediately after members array
    const shares_count = account.data.readUInt32LE(members_end);
    const shares_data_offset = members_end + 4;

    const expected = shares_data_offset + shares_count * ONCHAIN_ENTRY_SIZE;
    if (account.data.length < expected) {
        throw new Error(`Account too short: ${account.data.length} < ${expected}`);
    }

    for (let i = 0; i < shares_count; i++) {
        const entryStart = shares_data_offset + i * ONCHAIN_ENTRY_SIZE;  // Bug 1 fixed
        const storedPubkey = new PublicKey(
            account.data.slice(entryStart, entryStart + MEMBER_PUBKEY_SIZE)
        );

        if (storedPubkey.equals(memberKeypair.publicKey)) {
            // Read exactly ENCRYPTED_SHARE_CIPHERTEXT_SIZE bytes (105)
            const encryptedPayload = new Uint8Array(
                account.data.slice(
                    entryStart + MEMBER_PUBKEY_SIZE,
                    entryStart + ONCHAIN_ENTRY_SIZE,   // Bug 2 fixed: use ONCHAIN_ENTRY_SIZE not +105
                )
            );
            console.log(`✅ Found share for ${memberKeypair.publicKey.toBase58().slice(0, 16)}… (${encryptedPayload.length} bytes)`);
            return decryptShare(encryptedPayload, memberKeypair.secretKey);
        }
    }

    throw new Error(
        `Share not found for ${memberKeypair.publicKey.toBase58()} in multisig ${multisigAddress.toBase58()}`
    );
}