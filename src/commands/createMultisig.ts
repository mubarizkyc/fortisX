import {
    generateUtxoKeypair, getNkFromUtxoPrivateKey
} from '@cloak.dev/sdk-devnet'
import { split } from 'shamir-secret-sharing'
import path from 'path';
import nacl from 'tweetnacl'
import { readFile } from 'fs/promises';
import { convertPublicKey, convertSecretKey } from 'ed2curve';
import {
    PublicKey,
    TransactionInstruction,
    SystemProgram,
    Transaction,
    Connection,
    Keypair,
    TransactionMessage,
    VersionedTransaction
} from '@solana/web3.js'
import { encryptShare } from '../test_shamir';
import bs58 from "bs58";
import chalk from 'chalk';
import { sign } from 'crypto';


import { SEED_MULTISIG, SEED_PREFIX, TREASURY, SEED_TRANSACTION, SEED_PROPOSAL, PROGRAM_ID, DISCRIMINATOR_APPROVE_PROPOSAL, PROPOSAL_HEADER_SIZE, bigIntToLittleEndianBytes } from '../utils';
// ─── constants ───────────────────────────────────────────
// shares are secretLen+1 bytes (33 for 32-byte secret)
export const SHARE_RAW_SIZE = 33
// nacl.box output: 32 (ephemeral) + 24 (nonce) + (33 + 16) (box) = 105
export const SHARE_CIPHERTEXT_SIZE = 32 + 24 + SHARE_RAW_SIZE + 16  // 105
export const ENCRYPTED_SHARE_SIZE = 32 + SHARE_CIPHERTEXT_SIZE  // member pubkey + ciphertext
import { combine } from 'shamir-secret-sharing';
//import { decryptShareFromMember } from '../shareCrypto';

export class CreateMultisigIxData {
    discriminator: number;        // 1 byte (u8)
    threshold: number;            // 2 bytes (u16 LE)
    rentCollector: PublicKey;     // 32 bytes
    members: PublicKey[];         // 4 bytes (u32 len) + N*32 bytes
    encryptedShares: {
        member: PublicKey;
        ciphertext: Uint8Array;   // Fixed 105 bytes
    }[];
    treasuryUtxoPubkey: Uint8Array; // 32 bytes

    constructor(data: {
        threshold: number;
        rentCollector: PublicKey;
        members: PublicKey[];
        encryptedShares: { member: PublicKey; ciphertext: Uint8Array }[];
        treasuryUtxoPubkey: Uint8Array;
    }) {
        this.discriminator = 0;
        this.threshold = data.threshold;
        this.rentCollector = data.rentCollector;
        this.members = data.members;
        this.encryptedShares = data.encryptedShares;
        this.treasuryUtxoPubkey = data.treasuryUtxoPubkey;
    }

    serialize(): Buffer {
        // 1. Discriminator (1 byte)
        const discriminatorBuf = Buffer.from([this.discriminator]);

        // 2. Threshold (2 bytes)
        const thresholdBuf = Buffer.alloc(2);
        thresholdBuf.writeUInt16LE(this.threshold);

        // 3. Rent Collector (32 bytes)
        const rentCollectorBuf = Buffer.from(this.rentCollector.toBytes());

        // 4. Members
        const membersLenBuf = Buffer.alloc(4);
        membersLenBuf.writeUInt32LE(this.members.length);
        const membersBytes = Buffer.concat(this.members.map(m => Buffer.from(m.toBytes())));

        // 5. Shares
        const sharesLenBuf = Buffer.alloc(4);
        sharesLenBuf.writeUInt32LE(this.encryptedShares.length);

        const sharesBytes = Buffer.concat(
            this.encryptedShares.map(({ member, ciphertext }) => {
                if (ciphertext.length !== 105) {
                    throw new Error(`Ciphertext length mismatch: ${ciphertext.length}`);
                }
                // [32 Pubkey][105 Ciphertext] = 137 bytes
                return Buffer.concat([
                    Buffer.from(member.toBytes()),
                    Buffer.from(ciphertext)
                ]);
            })
        );

        // 6. Treasury Pubkey
        const treasuryPubkeyBuf = Buffer.from(this.treasuryUtxoPubkey);

        return Buffer.concat([
            discriminatorBuf,
            thresholdBuf,
            rentCollectorBuf,
            membersLenBuf,
            membersBytes,
            sharesLenBuf,
            sharesBytes,
            treasuryPubkeyBuf,
        ]);
    }
}

export function bytes32ToBigint(bytes: Uint8Array): bigint {
    if (bytes.length !== 32) throw new Error(`Expected 32 bytes, got ${bytes.length}`)
    let result = 0n
    for (let i = 31; i >= 0; i--) {
        result = (result << 8n) | BigInt(bytes[i])
    }
    return result
}

export async function createMultisig(
    members: PublicKey[],
    threshold: number,
    rentCollector: PublicKey,
    creatorKey: Keypair,
    connection: Connection,
) {

    if (members.length === 0) throw new Error('At least one member required');
    if (threshold <= 0 || threshold > members.length) {
        throw new Error(`Invalid threshold ${threshold} for ${members.length} members`);
    }

    // 1. Generate treasury UTXO keypair
    const treasuryKp = await generateUtxoKeypair();
    const viewingKeyNk = getNkFromUtxoPrivateKey(treasuryKp.privateKey);
    console.log("view key raw: ", viewingKeyNk);
    //print viewing key
    console.log("viewing key: ", bs58.encode(viewingKeyNk))
    console.log(chalk.blue('Generated treasury UTXO keypair with public key:'), treasuryKp.publicKey);
    //display private key 
    console.log('Treasury Private Key (bigint):', treasuryKp.privateKey);
    const treasuryPkBytes = bigIntToLittleEndianBytes(treasuryKp.privateKey, 32);
    console.log("Treasury Private Key", treasuryKp.privateKey);

    const treasuryPkBytesBE = new Uint8Array(treasuryPkBytes).reverse();

    // Split with big-endian bytes
    const shares = await split(treasuryPkBytesBE, members.length, threshold);

    // Debug logs
    shares.forEach((share, i) => {
        console.log(`Share ${i}: ${share.length} bytes, first 8 (BE): ${Buffer.from(share.slice(0, 8)).toString('hex')}`);
    });

    // Debug: log share sizes
    shares.forEach((share, i) => {
        console.log(`Share ${i}: length = ${share.length} bytes`);
        console.log(`  First 8 bytes (hex): ${share.slice(0, 8).toString()}`);
    });


    const encryptedSharesPromises = members.map(async (member, i) => {
        // 2. Await the async encryption function
        const encrypted = await encryptShare(shares[i], member);

        // 3. Now 'encrypted' is Uint8Array, so .length works
        console.log(`Encrypted share ${i}: ${encrypted.length} bytes`);

        return { member, ciphertext: encrypted };
    });
    // 4. Wait for ALL promises to resolve
    const encryptedShares = await Promise.all(encryptedSharesPromises);

    // 4. Derive multisig PDA

    const [multisigPda] = PublicKey.findProgramAddressSync(
        [SEED_PREFIX, SEED_MULTISIG, creatorKey.publicKey.toBytes()],
        PROGRAM_ID
    );
    console.log(chalk.blue('Multisig PDA:'), multisigPda.toBase58());

    // 5. Build instruction data
    const ixData = new CreateMultisigIxData({
        threshold,
        rentCollector,
        members,
        encryptedShares,
        treasuryUtxoPubkey: bigIntToLittleEndianBytes(treasuryKp.publicKey, 32),
    });

    console.log(chalk.blue('Instruction data size:'), ixData.serialize().byteLength, 'bytes');

    // 6. Build instruction
    const ix = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: TREASURY, isSigner: false, isWritable: true },
            { pubkey: multisigPda, isSigner: false, isWritable: true },
            { pubkey: creatorKey.publicKey, isSigner: true, isWritable: false },
            { pubkey: creatorKey.publicKey, isSigner: true, isWritable: true }, // rent payer
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: ixData.serialize(),
    });

    // 7. Zero sensitive data
    treasuryPkBytes.fill(0);
    shares.forEach(s => s.fill(0));
    treasuryKp.privateKey = 0n;

    // 8. Build & sign transaction
    const { blockhash } = await connection.getLatestBlockhash();
    const msg = new TransactionMessage({
        payerKey: creatorKey.publicKey,
        recentBlockhash: blockhash,
        instructions: [ix],
    }).compileToV0Message();

    const tx = new VersionedTransaction(msg);
    tx.sign([creatorKey]);

    // 9. Send transaction
    console.log(chalk.yellow('Sending multisig creation transaction...'));

    // only wipe after verification passes
    treasuryPkBytes.fill(0)
    shares.forEach(s => s.fill(0))
    treasuryKp.privateKey = 0n
    const signature = await connection.sendTransaction(tx, {
        skipPreflight: false,
        maxRetries: 3,
        preflightCommitment: 'confirmed',
    });

    console.log(chalk.green('✅ Multisig created!'));
    console.log('Signature:', signature);
    console.log('Multisig PDA:', multisigPda.toBase58());

    return { signature, multisigPda, treasuryPublicKey: treasuryKp.publicKey };
}