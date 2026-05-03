
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
import { accountsForTransactionExecute, SEED_VAULT } from '../utils';
import { SEED_MULTISIG, SEED_PREFIX, SEED_TRANSACTION, SEED_PROPOSAL, PROGRAM_ID, DISCRIMINATOR_APPROVE_PROPOSAL, PROPOSAL_HEADER_SIZE, bigIntToLittleEndianBytes } from '../utils';
export async function executeProposal(
    memberKeypair: Keypair,
    multisigAddress: PublicKey,
    proposalNumber: bigint,
) {

    const [vaultPda] = PublicKey.findProgramAddressSync(
        [
            SEED_PREFIX,
            multisigAddress.toBytes(),
            SEED_VAULT
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
    console.log("vault pda", vaultPda.toBase58());
    console.log("proposal pda", ProposalPda.toBase58());
    console.log("transaction pda", txPda.toBase58());
    const { accountMetas } = await accountsForTransactionExecute({
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
    console.log(accountMetas);

    const dataBuffer = Buffer.alloc(1);
    dataBuffer.writeUInt8(3, 0);

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
    console.log("Executing proposal with the following details:");
    try {
        console.log(chalk.yellow('Sending execution transaction...'));
        const signature = await connection.sendTransaction(tx, {
            skipPreflight: false,
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