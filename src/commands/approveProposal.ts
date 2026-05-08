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
import {
    SEED_MULTISIG,
    SEED_PREFIX,
    SEED_TRANSACTION,
    SEED_PROPOSAL,
    PROGRAM_ID,
    DISCRIMINATOR_APPROVE_PROPOSAL,
    bigIntToLittleEndianBytes,
} from '../utils';

// Proposal status constants (must match Rust)
const PROPOSAL_STATUS_ACTIVE = 0;
const PROPOSAL_STATUS_APPROVED = 1;
const PROPOSAL_STATUS_EXECUTED = 2;

export async function approveProposal(
    memberKeypair: Keypair,
    multisigAddress: PublicKey,
    proposalNumber: bigint,
    connection: Connection
) {
    console.log(chalk.yellow('⏳ Processing approval...'));

    // 1. Derive Proposal PDA
    const [proposalPda] = PublicKey.findProgramAddressSync(
        [
            SEED_PREFIX,
            multisigAddress.toBytes(),
            SEED_TRANSACTION,
            bigIntToLittleEndianBytes(proposalNumber, 8),
            SEED_PROPOSAL,
        ],
        PROGRAM_ID
    );

    // 2. Fetch accounts
    const [multisigInfo, proposalInfo] = await Promise.all([
        connection.getAccountInfo(multisigAddress),
        connection.getAccountInfo(proposalPda),
    ]);

    if (!multisigInfo) throw new Error(`Multisig account not found: ${multisigAddress.toBase58()}`);
    if (!proposalInfo) throw new Error(`Proposal account not found: ${proposalPda.toBase58()}`);

    // 3. Parse multisig state
    const multisigData = multisigInfo.data;
    const thresholdOffset = 136; // Adjust to match your Rust struct
    const threshold = multisigData.readUInt16LE(thresholdOffset);

    // 4. Parse proposal state
    const proposalData = proposalInfo.data;

    // ProposalHeader layout (adjust offsets to match your Rust struct):
    // [0..32) multisig
    // [32..64) transaction_index (u64)
    // [64..72) status (u8) at offset 56 relative to header start? Adjust as needed.
    // [72..80) timestamp (i64)
    // [80..88) deadline (i64)
    // [88] bump (u8)
    // [89] proposal_type (u8)

    // Example offsets (verify against your Rust ProposalHeader):
    const STATUS_OFFSET = 56;   // u8 status
    const DEADLINE_OFFSET = 48; // i64 deadline
    const APPROVERS_COUNT_OFFSET = 59; // u32 after header
    const APPROVERS_ARRAY_OFFSET = APPROVERS_COUNT_OFFSET + 4;

    const currentStatus = proposalData[STATUS_OFFSET];
    const deadline = proposalData.readBigInt64LE(DEADLINE_OFFSET);
    const approversCount = proposalData.readUInt32LE(APPROVERS_COUNT_OFFSET);

    console.log(chalk.blue('Proposal #'), proposalNumber.toString());
    console.log(chalk.blue('Threshold:'), threshold);
    console.log(chalk.blue('Current approvers:'), approversCount);
    console.log(chalk.blue('Status:'), formatStatus(currentStatus));
    console.log(chalk.blue('Deadline:'), new Date(Number(deadline) * 1000).toISOString());

    // ────────────────────────────────────────────────────────
    // Pre-flight checks: Inform user if no action needed
    // ────────────────────────────────────────────────────────

    // Check if already executed
    if (currentStatus === PROPOSAL_STATUS_EXECUTED) {
        console.log(chalk.green('✅ Proposal already executed — no approval needed'));
        return { alreadyExecuted: true, status: 'executed' };
    }

    // Check if already approved (threshold met)
    if (currentStatus === PROPOSAL_STATUS_APPROVED) {
        console.log(chalk.yellow('⚠️  Proposal already approved (threshold met)'));
        console.log(chalk.dim('   You can still submit an approval, but it won\'t change the status'));
        // Optionally: return early or ask user if they want to proceed
    }

    // Check if deadline passed
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (now > deadline && currentStatus !== PROPOSAL_STATUS_EXECUTED) {
        throw new Error(`Proposal deadline has passed. Current: ${now}, Deadline: ${deadline}`);
    }

    // Check if member already approved
    const memberPubkeyBytes = memberKeypair.publicKey.toBytes();
    let alreadyApproved = false;
    for (let i = 0; i < approversCount; i++) {
        const approverOffset = APPROVERS_ARRAY_OFFSET + (i * 32);
        const approverBytes = proposalData.slice(approverOffset, approverOffset + 32);
        if (Buffer.from(approverBytes).equals(Buffer.from(memberPubkeyBytes))) {
            alreadyApproved = true;
            break;
        }
    }

    if (alreadyApproved) {
        console.log(chalk.yellow('⚠️  You have already approved this proposal'));
        if (currentStatus === PROPOSAL_STATUS_APPROVED) {
            console.log(chalk.green('✅ Threshold already met — proposal is ready for execution'));
            return { alreadyApproved: true, status: 'approved' };
        }
        console.log(chalk.dim('   Waiting for other members to reach threshold...'));
        // Optionally: return early or ask if user wants to re-submit
    }

    // ────────────────────────────────────────────────────────
    // Build and send approval transaction
    // ────────────────────────────────────────────────────────

    const dataBuffer = Buffer.alloc(1);
    dataBuffer.writeUInt8(DISCRIMINATOR_APPROVE_PROPOSAL, 0);

    const ix = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: multisigAddress, isSigner: false, isWritable: false },
            { pubkey: proposalPda, isSigner: false, isWritable: true },
            { pubkey: memberKeypair.publicKey, isSigner: true, isWritable: false },
        ],
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
        console.log(chalk.yellow('📤 Sending approval transaction...'));
        const signature = await connection.sendTransaction(tx, { skipPreflight: false });
        console.log(chalk.blue('Signature:'), signature);

        const confirmation = await connection.confirmTransaction(signature, 'confirmed');
        if (confirmation.value.err) {
            throw new Error(`Transaction failed: ${confirmation.value.err}`);
        }

        console.log(chalk.green('✅ Approval transaction confirmed!'));

        // ────────────────────────────────────────────────────────
        // Re-fetch and report final state
        // ────────────────────────────────────────────────────────
        const updatedProposal = await connection.getAccountInfo(proposalPda);
        if (updatedProposal) {
            const updatedData = updatedProposal.data;
            const updatedStatus = updatedData[STATUS_OFFSET];
            const updatedApprovers = updatedData.readUInt32LE(APPROVERS_COUNT_OFFSET);

            console.log(chalk.blue('\n📊 Final Proposal State:'));
            console.log(`   Status: ${formatStatus(updatedStatus)}`);
            console.log(`   Approvers: ${updatedApprovers}/${threshold}`);

            if (updatedStatus === PROPOSAL_STATUS_APPROVED) {
                console.log(chalk.green('🎉 Threshold reached! Proposal is now executable.'));
                console.log(chalk.dim('   Run: execute_private_proposal --proposal-number <N>'));
            } else if (updatedStatus === PROPOSAL_STATUS_EXECUTED) {
                console.log(chalk.green('✅ Proposal already executed!'));
            } else {
                const remaining = threshold - updatedApprovers;
                console.log(chalk.blue(`   Waiting for ${remaining} more approval(s)...`));
            }
        }

        return { signature, status: currentStatus, newStatus: updatedProposal?.data[STATUS_OFFSET] };

    } catch (error: any) {
        console.error(chalk.red('❌ Approval failed:'), error.message);
        if (error.logs) {
            console.error('📜 Program logs:');
            error.logs.forEach((log: string) => console.error('  ', log));
        }
        throw error;
    }
}

// Helper: Format status code for display
function formatStatus(code: number): string {
    switch (code) {
        case PROPOSAL_STATUS_ACTIVE: return '🟡 Active';
        case PROPOSAL_STATUS_APPROVED: return '🟢 Approved';
        case PROPOSAL_STATUS_EXECUTED: return '✅ Executed';
        default: return `Unknown (${code})`;
    }
}