// src/services/shareCollector.ts
import { PublicKey } from '@solana/web3.js';
import { decryptShareFromMember } from './shareCrypto';

export interface ShareRequest {
    proposalNumber: bigint;
    multisigAddress: string; // base58
    memberPubkey: string;    // base58
}

export interface ShareResponse {
    success: boolean;
    encryptedShare?: string; // base64-encoded Uint8Array
    error?: string;
}

/**
 * Request an encrypted share from a member's HTTPS endpoint
 */
export async function requestShareFromMember(
    memberEndpoint: string,  // e.g., "https://member1.example.com/api/share"
    request: ShareRequest,
    timeoutMs = 30_000
): Promise<ShareResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(memberEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                proposalNumber: request.proposalNumber.toString(),
                multisigAddress: request.multisigAddress,
                memberPubkey: request.memberPubkey,
                timestamp: Date.now(),
            }),
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        return await response.json() as ShareResponse;
    } catch (error: any) {
        clearTimeout(timeout);
        if (error.name === 'AbortError') {
            throw new Error(`Timeout fetching share from ${memberEndpoint}`);
        }
        throw error;
    }
}

/**
 * Collect and decrypt shares from multiple members
 */
export async function collectAndDecryptShares(
    memberEndpoints: Map<string, string>,  // memberPubkey(base58) → HTTPS endpoint
    request: ShareRequest,
    localMemberSecretKey: Uint8Array,       // Your Ed25519 secret key
    threshold: number
): Promise<Uint8Array[]> {
    const decryptedShares: Uint8Array[] = [];
    const errors: string[] = [];

    // Request shares from all members in parallel
    const promises = Array.from(memberEndpoints.entries()).map(
        async ([memberPubkey, endpoint]) => {
            try {
                const response = await requestShareFromMember(endpoint, {
                    ...request,
                    memberPubkey,
                });

                if (!response.success || !response.encryptedShare) {
                    errors.push(`${memberPubkey}: ${response.error || 'No share returned'}`);
                    return;
                }

                // Decrypt the share using your local secret key
                const encryptedBytes = Uint8Array.from(atob(response.encryptedShare), c => c.charCodeAt(0));
                const decryptedShare = decryptShareFromMember(encryptedBytes, localMemberSecretKey);

                decryptedShares.push(decryptedShare);
                console.log(`✅ Decrypted share from ${memberPubkey.slice(0, 8)}...`);
            } catch (error: any) {
                errors.push(`${memberPubkey}: ${error.message}`);
            }
        }
    );

    await Promise.all(promises);

    if (decryptedShares.length < threshold) {
        throw new Error(
            `Insufficient shares: got ${decryptedShares.length}, need ${threshold}\n` +
            `Errors: ${errors.join('; ')}`
        );
    }

    console.log(`✅ Collected ${decryptedShares.length} valid shares (threshold: ${threshold})`);
    return decryptedShares;
}