
import {
    PublicKey,
    SystemProgram,
    TransactionInstruction,
    Keypair,
    Connection,
    TransactionMessage,
    VersionedTransaction,
    AccountMeta,
} from '@solana/web3.js';
import { Buffer } from 'buffer';
import chalk from 'chalk';
import { accountsForTransactionExecute } from '../utils';
// ⚠️ REPLACE WITH YOUR ACTUAL PROGRAM ID
export const PROGRAM_ID = new PublicKey('CD6Pnc1gpUQ1XT1bzXEPs2QnqFMcQUHsiRKAV9iYXh36');

// Seeds must match your Rust code exactly
export const SEED_PREFIX = Buffer.from('multisig');
export const SEED_TRANSACTION = Buffer.from('transaction');
export const SEED_PROPOSAL = Buffer.from('proposal');
export const SEED_MULTISIG = Buffer.from('multisig');
export const DISCRIMINATOR_EXECUTE_PROPOSAL = 3; // Adjust to match your Rust enum

export async function executeProposal(
    memberKeypair: Keypair,
    multisigAddress: PublicKey,
    proposalNumber: bigint,
) {

    const [vaultPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('multisig'),
            multisigAddress.toBytes(),
            Buffer.from('vault')
        ],
        PROGRAM_ID
    );
    const [ProposalPda] = PublicKey.findProgramAddressSync(
        [
            SEED_PREFIX,
            multisigAddress.toBytes(),
            SEED_TRANSACTION,
            bigIntToLittleEndianBytes(proposalNumber, 8),
            SEED_PROPOSAL,
        ],
        PROGRAM_ID
    );
    const [txPda] = PublicKey.findProgramAddressSync(
        [
            SEED_PREFIX,
            multisigAddress.toBytes(),
            SEED_TRANSACTION,
            bigIntToLittleEndianBytes(proposalNumber, 8),
        ],
        PROGRAM_ID
    );
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    const txAccount = await connection.getAccountInfo(txPda);
    if (!txAccount) {
        throw new Error('Transaction account not found');
    }

    // ✅ Add bounds checks
    const MIN_TX_ACCOUNT_SIZE = 78 + 16;
    if (txAccount.data.length < MIN_TX_ACCOUNT_SIZE) {
        throw new Error(`Transaction account data too small: ${txAccount.data.length} bytes`);
    }

    let ephemeralSignersCount = txAccount.data.readUInt32LE(74);
    if (78 + ephemeralSignersCount > txAccount.data.length) {
        throw new Error(`Ephemeral signer count (${ephemeralSignersCount}) exceeds buffer`);
    }
    console.log("ephemeralSignersCount", ephemeralSignersCount);
    let ephemeralSignerBumps: number[] = [];
    for (let i = 0; i < ephemeralSignersCount; i++) {
        ephemeralSignerBumps.push(txAccount.data[78 + i]);
    }

    const messageBytesStart = 78 + ephemeralSignersCount;
    const messageBytes = txAccount.data.slice(messageBytesStart);
    console.log("hi");
    const { accountMetas, lookupTableAccounts } = await accountsForTransactionExecute({
        connection,
        messageBytes,
        ephemeralSignerBumps: [...ephemeralSignerBumps],
        vaultPda,
        transactionPda: txPda
    });

    // ✅ Pre-flight proposal check
    const proposalAccount = await connection.getAccountInfo(ProposalPda);
    if (!proposalAccount) {
        throw new Error(`Proposal account not found: ${ProposalPda.toBase58()}`);
    }
    const proposalStatus = proposalAccount.data[56]; // Adjust offset if needed
    if (proposalStatus !== 1) {
        throw new Error(`Proposal not approved. Status: ${proposalStatus} (expected 1)`);
    }

    let keys: AccountMeta[] = [
        { pubkey: multisigAddress, isSigner: false, isWritable: false },
        { pubkey: ProposalPda, isSigner: false, isWritable: true },
        { pubkey: txPda, isSigner: false, isWritable: true },
        { pubkey: memberKeypair.publicKey, isSigner: true, isWritable: false },
    ];
    keys.push(...accountMetas);

    const dataBuffer = Buffer.alloc(1);
    dataBuffer.writeUInt8(DISCRIMINATOR_EXECUTE_PROPOSAL, 0);

    const ix = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys,
        data: dataBuffer,
    });

    const { blockhash } = await connection.getLatestBlockhash();
    const msg = new TransactionMessage({
        payerKey: memberKeypair.publicKey,
        recentBlockhash: blockhash,
        instructions: [ix],
    }).compileToV0Message();

    const tx = new VersionedTransaction(msg);
    tx.sign([memberKeypair]);

    try {
        console.log(chalk.yellow('Sending execution transaction...'));
        const signature = await connection.sendTransaction(tx, {
            skipPreflight: false,
            maxRetries: 3,
            preflightCommitment: 'confirmed',
        });

        console.log(chalk.blue('Signature:'), signature);
        const confirmation = await connection.confirmTransaction(signature, 'confirmed');
        if (confirmation.value.err) {
            throw new Error(`Transaction failed: ${confirmation.value.err}`);
        }

        console.log(chalk.green('✅ Proposal Executed & Confirmed!'));

        // ✅ Log updated proposal state
        const updatedProposal = await connection.getAccountInfo(ProposalPda);
        if (updatedProposal) {
            const status = updatedProposal.data[56];
            console.log(chalk.blue('Final Status:'), status === 2 ? '✅ EXECUTED' : `Status ${status}`);
        }

        return { signature, proposalNumber, status: 'executed' };

    } catch (error: any) {
        console.error(chalk.red('❌ Execution Failed:'), error.message);
        if (error.logs) {
            console.error('📜 Program Logs:');
            error.logs.forEach((log: string) => console.error('  ', log));
        }
        throw error;
    }
}
// Helper: Convert bigint to little-endian byte array
function bigIntToLittleEndianBytes(value: bigint, byteLength: number): Uint8Array {
    const bytes = new Uint8Array(byteLength);
    let remaining = value;
    for (let i = 0; i < byteLength; i++) {
        bytes[i] = Number(remaining & 0xFFn);
        remaining >>= 8n;
    }
    return bytes;
}