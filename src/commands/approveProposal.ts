// src/commands/approveProposal.ts
import {
    PublicKey,
    TransactionInstruction,
    Keypair,
    Connection,
    TransactionMessage,
    VersionedTransaction,
} from '@solana/web3.js';
import { Buffer } from 'buffer';
import chalk from 'chalk';
import { SEED_MULTISIG, SEED_PREFIX, SEED_TRANSACTION, SEED_PROPOSAL, PROGRAM_ID, DISCRIMINATOR_APPROVE_PROPOSAL, PROPOSAL_HEADER_SIZE, bigIntToLittleEndianBytes } from '../utils';
export async function approveProposal(
    memberKeypair: Keypair,
    multisigAddress: PublicKey,
    proposalNumber: bigint,
    connection: Connection
) {
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
    // 1. Fetch accounts to verify state and derive PDAs
    const [multisigInfo, proposalInfo] = await Promise.all([
        connection.getAccountInfo(multisigAddress),
        connection.getAccountInfo(ProposalPda),
    ]);

    if (!multisigInfo) throw new Error(`Multisig account not found: ${multisigAddress.toBase58()}`);
    if (!proposalInfo) throw new Error(`Proposal account not found: ${ProposalPda.toBase58()}`);

    // 2. Read multisig state to get transaction_index for PDA verification
    const multisigData = multisigInfo.data;

    // Read transaction_index (u64 LE) - adjust offset based on your Multisig struct
    const txIndexOffset = 128;
    const transactionIndex = multisigData.readBigUInt64LE(txIndexOffset);

    // Read threshold (u16 LE) - adjust offset based on your struct
    const thresholdOffset = 136; // Example: after transaction_index
    const threshold = multisigData.readUInt16LE(thresholdOffset);

    console.log(chalk.blue('Transaction Index:'), transactionIndex.toString());
    console.log(chalk.blue('Threshold:'), threshold.toString());



    // 4. Read proposal state to check status and deadline (optional pre-flight check)
    const proposalData = proposalInfo.data;
    const proposalStatus = proposalData[56]; // status is at offset 56 in ProposalHeader (0=Active, 1=Approved)
    const proposalDeadline = proposalData.readBigInt64LE(48); // deadline is i64 LE at offset 48

    if (proposalStatus !== 0) {
        throw new Error(`Proposal is not active (status=${proposalStatus}). Cannot approve.`);
    }

    const now = BigInt(Math.floor(Date.now() / 1000));
    if (now > proposalDeadline) {
        throw new Error(`Proposal deadline (${proposalDeadline}) has passed. Current time: ${now}`);
    }

    console.log(chalk.blue('Proposal Status:'), proposalStatus === 0 ? 'Active' : 'Other');
    console.log(chalk.blue('Proposal Deadline:'), new Date(Number(proposalDeadline) * 1000).toISOString());

    // 5. Build Instruction Data
    // Rust doesn't read from `data` in process_approve_proposal, but we send discriminator for routing
    const dataBuffer = Buffer.alloc(1);
    dataBuffer.writeUInt8(DISCRIMINATOR_APPROVE_PROPOSAL, 0);

    // 6. Build the Instruction
    const ix = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: multisigAddress, isSigner: false, isWritable: false }, // multisig (read-only)
            { pubkey: ProposalPda, isSigner: false, isWritable: true },  // proposal (write: add approver)
            { pubkey: memberKeypair.publicKey, isSigner: true, isWritable: false }, // member (signer)
        ],
        data: dataBuffer,
    });

    // 7. Build & Sign Transaction
    const { blockhash } = await connection.getLatestBlockhash();

    const msg = new TransactionMessage({
        payerKey: memberKeypair.publicKey,
        recentBlockhash: blockhash,
        instructions: [ix],
    }).compileToV0Message();

    const tx = new VersionedTransaction(msg);
    tx.sign([memberKeypair]);

    // 8. Send with error handling & confirmation
    try {
        console.log(chalk.yellow('Sending approval transaction...'));
        const signature = await connection.sendTransaction(tx, {
            skipPreflight: false,
        });

        console.log(chalk.blue('Signature:'), signature);

        // Wait for confirmation
        const confirmation = await connection.confirmTransaction(signature, 'confirmed');
        if (confirmation.value.err) {
            throw new Error(`Transaction failed: ${confirmation.value.err}`);
        }

        console.log(chalk.green('✅ Proposal Approved & Confirmed!'));

        // Re-fetch proposal to show updated state
        const updatedProposal = await connection.getAccountInfo(ProposalPda);
        if (updatedProposal) {
            const updatedData = updatedProposal.data;
            const approversLen = updatedData.readUInt32LE(PROPOSAL_HEADER_SIZE);
            const updatedStatus = updatedData[56];

            console.log(chalk.blue('Approvers Count:'), approversLen);
            console.log(chalk.blue('New Status:'), updatedStatus === 1 ? '✅ APPROVED' : 'Active');

            if (updatedStatus === 1) {
                console.log(chalk.green('🎉 Threshold reached! Proposal is now executable.'));
            }
        }

    } catch (error: any) {
        console.error(chalk.red('❌ Approval Failed:'), error.message);

        // Try to get logs if available
        if (error.logs) {
            console.error('📜 Program Logs:');
            error.logs.forEach((log: string) => console.error('  ', log));
        }

        throw error;
    }
}