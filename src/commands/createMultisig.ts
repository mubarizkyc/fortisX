import {
    generateUtxoKeypair
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
import { decryptShareFromMember } from '../shareCrypto';
// ─── verify round-trip before sending to chain ───────────
export async function verifyShareRoundTrip(
    treasuryKp: { privateKey: bigint; publicKey: bigint },
    shares: Uint8Array[],
    members: PublicKey[],
    memberSecretKey: Uint8Array,  // one keypair for testing
) {
    console.log('--- Round-trip debug ---')
    console.log('Secret key length:', memberSecretKey.length)

    // encrypt share 0
    const enc = encryptShareForMember(shares[0], members[0])
    console.log('Encrypted length:', enc.length)

    // try decrypt with full 64 bytes
    try {
        const x25519Full = convertSecretKey(memberSecretKey)
        console.log('x25519 from full 64 bytes:', Buffer.from(x25519Full).toString('hex').slice(0, 16))
    } catch (e) { console.log('full 64 failed:', e) }

    // try decrypt with first 32 bytes (seed only)
    try {
        const x25519Seed = convertSecretKey(memberSecretKey.slice(0, 32))
        console.log('x25519 from seed 32 bytes:', Buffer.from(x25519Seed).toString('hex').slice(0, 16))
    } catch (e) { console.log('seed 32 failed:', e) }

    // check encrypt used same conversion
    const encPubkey = encryptShareForMember(shares[0], members[0])
    const memberX25519Pub = convertPublicKey(members[0].toBytes())
    console.log('x25519 pubkey from ed25519:', Buffer.from(memberX25519Pub!).toString('hex').slice(0, 16))
}
export class CreateMultisigIxData {
    discriminator: number;        // 1 byte (u8)
    threshold: number;            // 2 bytes (u16 LE)
    rentCollector: PublicKey;     // 32 bytes
    members: PublicKey[];         // 4 bytes (u32 len) + N*32 bytes
    encryptedShares: {
        member: PublicKey;
        ciphertext: Uint8Array;   // Fixed 105 bytes (no length prefix)
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

        // 2. Threshold (2 bytes, u16 LE)
        const thresholdBuf = Buffer.alloc(2);
        thresholdBuf.writeUInt16LE(this.threshold);

        // 3. Rent collector (32 bytes)
        const rentCollectorBuf = this.rentCollector.toBytes();

        // 4. Members array: [u32 len][pubkey1][pubkey2]...
        const membersLenBuf = Buffer.alloc(4);
        membersLenBuf.writeUInt32LE(this.members.length);
        const membersBytes = Buffer.concat(this.members.map(m => m.toBytes()));

        // 5. Encrypted shares array: [u32 len][share1][share2]...
        // Each share: [32 member pubkey][105 encrypted share] = 137 bytes
        const sharesLenBuf = Buffer.alloc(4);
        sharesLenBuf.writeUInt32LE(this.encryptedShares.length);

        // In CreateMultisigIxData.serialize():
        const sharesBytes = Buffer.concat(
            this.encryptedShares.map(({ member, ciphertext }) => {
                // ✅ Validate ciphertext is exactly 105 bytes (NaCl box output)
                if (ciphertext.length !== 105) {
                    throw new Error(
                        `Invalid ciphertext length: expected 105, got ${ciphertext.length}. ` +
                        `Ensure encryptShareForMember returns standard NaCl box output.`
                    );
                }
                // ✅ Format: [32 member pubkey][105 ciphertext] - NO length prefix
                return Buffer.concat([
                    member.toBytes(),           // 32 bytes
                    Buffer.from(ciphertext),    // 105 bytes (fixed)
                ]);
            })
        );

        // 6. Treasury UTXO public key (32 bytes)
        const treasuryPubkeyBuf = Buffer.from(this.treasuryUtxoPubkey);

        // Concatenate all parts
        return Buffer.concat([
            discriminatorBuf,      // 1
            thresholdBuf,          // 2
            rentCollectorBuf,      // 32
            membersLenBuf,         // 4
            membersBytes,          // N*32
            sharesLenBuf,          // 4
            sharesBytes,           // M*136
            treasuryPubkeyBuf,     // 32
        ]);
    }
}

// ─── encrypt ─────────────────────────────────────────────
function encryptShareForMember(
    share: Uint8Array,       // 33 bytes from shamir split
    memberPubkey: PublicKey,
): Uint8Array {
    // ✅ NO truncation — pass full share bytes including x-coordinate
    if (share.length !== SHARE_RAW_SIZE) {
        throw new Error(`Share must be ${SHARE_RAW_SIZE} bytes, got ${share.length}`)
    }

    const memberX25519 = convertPublicKey(memberPubkey.toBytes())
    if (!memberX25519) throw new Error(`Cannot convert pubkey ${memberPubkey.toBase58()}`)

    const ephemeral = nacl.box.keyPair()
    const nonce = nacl.randomBytes(nacl.box.nonceLength)  // 24 bytes
    const ciphertext = nacl.box(share, nonce, memberX25519, ephemeral.secretKey)
    // ciphertext = 33 + 16 = 49 bytes

    // [32 ephemeral][24 nonce][49 ciphertext] = 105 bytes
    const result = new Uint8Array(32 + 24 + ciphertext.length)
    result.set(ephemeral.publicKey, 0)
    result.set(nonce, 32)
    result.set(ciphertext, 56)

    return result
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
) {
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");

    if (members.length === 0) throw new Error('At least one member required');
    if (threshold <= 0 || threshold > members.length) {
        throw new Error(`Invalid threshold ${threshold} for ${members.length} members`);
    }

    // 1. Generate treasury UTXO keypair
    const treasuryKp = await generateUtxoKeypair();
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
    // quick sanity check — add to createMultisig before encrypting
    const testSeed = creatorKey.secretKey.slice(0, 32)
    const x25519FromSecret = convertSecretKey(testSeed)
    const x25519PubFromSecret = nacl.box.keyPair.fromSecretKey(x25519FromSecret).publicKey
    const x25519PubFromPubkey = convertPublicKey(creatorKey.publicKey.toBytes())

    console.log('x25519 pub from secret:', Buffer.from(x25519PubFromSecret).toString('hex').slice(0, 16))
    console.log('x25519 pub from pubkey:', Buffer.from(x25519PubFromPubkey!).toString('hex').slice(0, 16))
    console.log('Match:', Buffer.from(x25519PubFromSecret).toString('hex') === Buffer.from(x25519PubFromPubkey!).toString('hex'))
    const encryptedShares = members.map((member, i) => {
        const encrypted = encryptShareForMember(shares[i], member);
        console.log(`Encrypted share ${i}: ${encrypted.length} bytes`);
        return { member, ciphertext: encrypted };
    });

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
    await verifyShareRoundTrip(treasuryKp, shares, members, members.map(m => creatorKey.secretKey))
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