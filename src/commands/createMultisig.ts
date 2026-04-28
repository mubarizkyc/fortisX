import {
    generateUtxoKeypair,
} from '@cloak.dev/sdk-devnet'
import { split } from 'shamir-secret-sharing'
import path from 'path';
import nacl from 'tweetnacl'
import { readFile } from 'fs/promises';
import { convertPublicKey } from 'ed2curve' // converts ed25519 → x25519
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
import {
    appendTransactionMessageInstruction,
    createTransactionMessage,
    generateKeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    setTransactionMessageLifetimeUsingBlockhash,
    signTransactionMessageWithSigners,
    createKeyPairSignerFromBytes
} from "@solana/kit";

import { fromLegacyPublicKey, fromLegacyTransactionInstruction, fromVersionedTransaction } from "@solana/compat";
import { LiteSVM, FailedTransactionMetadata } from "litesvm";
import chalk from 'chalk';
import { sign } from 'crypto';
const PROGRAM_ID = new PublicKey('CD6Pnc1gpUQ1XT1bzXEPs2QnqFMcQUHsiRKAV9iYXh36')
const TREASURY = new PublicKey('5wBH8hqU4PxVCFXmu3JR6Kegdy2Vq8K7fZnRgN5ZJEr2')
const SEED_PREFIX = Buffer.from('multisig')
const SEED_MULTISIG = Buffer.from('multisig')
const SHARE_SIZE = 32 + 4 + 60 // member pubkey + len prefix + ciphertext

export class CreateMultisigIxData {
    discriminator: number        // 1 byte
    threshold: number            // 2 bytes
    rentCollector: PublicKey    // 32 bytes ( 32)
    members: PublicKey[]         // 4 + N*32
    encryptedShares: {
        member: PublicKey
        ciphertext: Uint8Array     // 60 bytes
    }[]
    treasuryUtxoPubkey: Uint8Array // 32 bytes

    constructor(data: {
        threshold: number
        rentCollector: PublicKey
        members: PublicKey[]
        encryptedShares: { member: PublicKey; ciphertext: Uint8Array }[]
        treasuryUtxoPubkey: Uint8Array
    }) {
        this.discriminator = 0
        this.threshold = data.threshold
        this.rentCollector = data.rentCollector,
            this.members = data.members
        this.encryptedShares = data.encryptedShares
        this.treasuryUtxoPubkey = data.treasuryUtxoPubkey
    }

    serialize(): Buffer {
        const thresholdBuf = Buffer.alloc(2)
        thresholdBuf.writeUInt16LE(this.threshold)

        const membersLenBuf = Buffer.alloc(4)
        membersLenBuf.writeUInt32LE(this.members.length)
        const membersBytes = Buffer.concat(this.members.map(m => m.toBytes()))
        const rentCollector = Buffer.concat([this.rentCollector.toBytes()]);
        const sharesLenBuf = Buffer.alloc(4)
        sharesLenBuf.writeUInt32LE(this.encryptedShares.length)
        const sharesBytes = Buffer.concat(
            this.encryptedShares.map(({ member, ciphertext }) => {
                const lenBuf = Buffer.alloc(4)
                lenBuf.writeUInt32LE(ciphertext.length)
                return Buffer.concat([member.toBytes(), lenBuf, ciphertext])
            })
        )

        return Buffer.concat([
            Buffer.from([this.discriminator]),  // 1
            thresholdBuf,                       // 2
            rentCollector,                 // 33
            membersLenBuf,                      // 4
            membersBytes,                       // N*32
            sharesLenBuf,                       // 4
            sharesBytes,                        // N*(32+4+60)
            this.treasuryUtxoPubkey,            // 32
        ])
    }

}

// mirrors SDK's bigintToBytes
function bigintToBytes32(value: bigint): Uint8Array {
    const result = new Uint8Array(32)
    let remaining = value
    for (let i = 0; i < 32; i++) {
        result[i] = Number(remaining & 255n)
        remaining >>= 8n
    }
    return result
}

// encrypt a share with a member's ed25519 pubkey
// uses nacl box: x25519 key exchange + xsalsa20-poly1305
function encryptShareForMember(
    share: Uint8Array,        // 32 bytes
    memberPubkey: PublicKey,  // ed25519
): Uint8Array {
    // convert ed25519 pubkey → x25519
    const memberX25519 = convertPublicKey(memberPubkey.toBytes())
    if (!memberX25519) throw new Error(`Cannot convert pubkey for ${memberPubkey.toBase58()}`)

    // ephemeral keypair for this encryption
    const ephemeral = nacl.box.keyPair()

    // encrypt: nacl.box = x25519 ECDH + xsalsa20-poly1305
    const nonce = nacl.randomBytes(nacl.box.nonceLength) // 24 bytes
    const ciphertext = nacl.box(share, nonce, memberX25519, ephemeral.secretKey)

    // output: 32 (ephemeral pubkey) + 24 (nonce) + ciphertext
    // = 32 + 24 + (32 + 16) = 104 bytes
    const result = new Uint8Array(32 + 24 + ciphertext.length)
    result.set(ephemeral.publicKey, 0)
    result.set(nonce, 32)
    result.set(ciphertext, 56)
    return result
}
export async function createMultisigInstruction(
    members: PublicKey[],
    threshold: number,
    rentCollector: PublicKey,
    creatorKey: Keypair,
) {
    if (members.length === 0) throw new Error('At least one member required')
    if (threshold <= 0 || threshold > members.length) {
        throw new Error(`Invalid threshold ${threshold} for ${members.length} members`)
    }

    const treasuryKp = await generateUtxoKeypair()
    const treasuryPkBytes = bigintToBytes32(treasuryKp.privateKey)
    const shares = await split(treasuryPkBytes, members.length, threshold)
    console.log("treasury address", treasuryKp.publicKey);
    const encryptedShares = members.map((member, i) => ({
        member,
        ciphertext: encryptShareForMember(shares[i], member)
    }))

    const [multisigPda] = PublicKey.findProgramAddressSync(
        [SEED_PREFIX, SEED_MULTISIG, creatorKey.publicKey.toBytes()],
        PROGRAM_ID
    )
    console.log("multisig address: ", multisigPda)
    // ✅ use the struct
    const ixData = new CreateMultisigIxData({
        threshold,
        rentCollector,
        members,
        encryptedShares,
        treasuryUtxoPubkey: bigintToBytes32(treasuryKp.publicKey),
    })
    console.log("ix data len", ixData.serialize().byteLength);
    const ix = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: TREASURY, isSigner: false, isWritable: true },
            { pubkey: multisigPda, isSigner: false, isWritable: true },
            { pubkey: creatorKey.publicKey, isSigner: true, isWritable: false },
            { pubkey: creatorKey.publicKey, isSigner: true, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: ixData.serialize(),  // ✅ clean
    })

    treasuryPkBytes.fill(0)
    treasuryKp.privateKey = 0n

    // LiteSVM test
    const svm = new LiteSVM()
    svm.addProgramFromFile(
        fromLegacyPublicKey(PROGRAM_ID),
        "/home/mubariz/Documents/SolDev/FortisX/program/target/deploy/program.so"
    )

    const keypairBytes = new Uint8Array(JSON.parse(
        await readFile("/home/mubariz/.config/solana/id.json", 'utf-8')
    ))
    const signer = await createKeyPairSignerFromBytes(keypairBytes)

    // ✅ airdrop BEFORE building transaction
    svm.airdrop(signer.address, lamports(10_000_000_000n))

    const transaction = await pipe(
        createTransactionMessage({ version: 0 }),
        (tx) => setTransactionMessageFeePayerSigner(signer, tx),
        (tx) => svm.setTransactionMessageLifetimeUsingLatestBlockhash(tx),
        (tx) => appendTransactionMessageInstruction(fromLegacyTransactionInstruction(ix), tx),
        (tx) => signTransactionMessageWithSigners(tx),
    )

    const result = svm.sendTransaction(transaction)

    if (result instanceof FailedTransactionMetadata) {
        console.error(chalk.red('❌ Transaction Failed!'))
        console.error('Error:', result.err())
        try {
            const meta = result.meta()
            console.error('Logs:', meta?.logMessages)
        } catch (e) {
            console.error('No execution metadata available.')
        }
    } else {
        console.log(chalk.green('✅ Success!'))
        console.log('Logs:', result.logs())
    }
}