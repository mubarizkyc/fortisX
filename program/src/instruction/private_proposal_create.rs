use crate::instruction::PROPOSAL_HEADER_SIZE;
use crate::state::{
    MULTISIG_HEADER_SIZE, Multisig, ProposalHeader, SEED_TRANSACTION,
    seeds::{SEED_EPHEMERAL_SIGNER, SEED_MULTISIG, SEED_PREFIX, SEED_PROPOSAL, SEED_VAULT},
};
use arrayvec::ArrayVec;
use core::ptr;
use pinocchio::sysvars::Sysvar;
use pinocchio::sysvars::clock::Clock;
use pinocchio::{
    ProgramResult,
    account_info::AccountInfo,
    instruction::{Seed, Signer},
    program_error::ProgramError,
    pubkey,
};
use pinocchio_system::create_account_with_minimum_balance_signed;
use solana_msg::{msg, sol_log};

// Constants
pub const VAULT_TRANSACTION_HEADER_SIZE: usize = 73; // 32+32+8+1

// Proposal types
pub const PROPOSAL_TYPE_PRIVATE_TRANSFER: u8 = 0;
pub const PROPOSAL_TYPE_PRIVATE_SWAP: u8 = 1;

// Private proposal metadata layout (for PRIVATE_TRANSFER)
// [0..32)  utxo_commitment
// [32..40) amount (u64 LE)
// [40..72) recipient_public_key (32 bytes, bigint as LE bytes)
pub const PRIVATE_TRANSFER_META_SIZE: usize = 32 + 8 + 32; // 72 bytes

/// Instruction data layout for process_create_private_proposal:
/// [0..8)   voting_deadline (i64 LE)
/// [8]      proposal_type (u8) - public/private
/// [9]      private_proposal_subtype (u8) - TRANSFER/SWAP (if private)
/// [10..]   private_proposal_metadata (variable)
pub fn process_create_private_proposal(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    // ────────────────────────────────────────────────────────────
    // 1. Account Validation
    // ────────────────────────────────────────────────────────────
    let [
        multisig,
        vault_transaction,
        creator,
        proposal,
        system_program,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // ────────────────────────────────────────────────────────────
    // 2. Parse Instruction Data
    // ────────────────────────────────────────────────────────────
    if data.len() < 10 {
        sol_log("Instruction data too short");
        return Err(ProgramError::InvalidInstructionData);
    }

    let voting_deadline = unsafe { *(data[0..8].as_ptr() as *const i64) };
    let private_proposal_subtype = data[8];
    let private_meta = &data[9..];

    // Validate deadline
    let current_time = Clock::get()?.unix_timestamp;
    if voting_deadline <= current_time {
        sol_log("Voting deadline must be in the future");
        return Err(ProgramError::InvalidInstructionData);
    }
    // ────────────────────────────────────────────────────────────
    // 3. Load & Verify Multisig State
    // ────────────────────────────────────────────────────────────
    let multisig_data = unsafe {
        multisig
            .borrow_mut_data_unchecked()
            .split_at_mut(MULTISIG_HEADER_SIZE)
    };
    let multisig_state = unsafe { &mut *(multisig_data.0.as_mut_ptr() as *mut Multisig) };
    let members_len: u32 = unsafe { *(multisig_data.1[0..4].as_ptr() as *const u32) };

    // Verify multisig PDA
    let (ms_pda, ms_bump) = pubkey::find_program_address(
        &[
            SEED_PREFIX,
            SEED_MULTISIG,
            multisig_state.create_key.as_ref(),
        ],
        &crate::ID,
    );
    if ms_pda.ne(multisig.key()) || ms_bump != multisig_state.bump {
        sol_log("Invalid multisig PDA");
        return Err(ProgramError::InvalidAccountOwner);
    }

    // Verify creator is a member
    if !multisig_state.is_member(members_len as u16, *creator.key(), &multisig_data.1[4..]) {
        sol_log("Member not authorized");
        return Err(ProgramError::IncorrectAuthority);
    }

    // ────────────────────────────────────────────────────────────
    // 4. Increment Transaction Index (with overflow check)
    // ────────────────────────────────────────────────────────────
    multisig_state.transaction_index = multisig_state.transaction_index.checked_add(1).unwrap();

    let (transaction_pda, transaction_bump) = pubkey::find_program_address(
        &[
            SEED_PREFIX,
            multisig.key().as_ref(),
            SEED_TRANSACTION,
            &multisig_state.transaction_index.to_le_bytes(),
        ],
        &crate::ID,
    );
    if transaction_pda.ne(vault_transaction.key()) {
        sol_log("Invalid vault_transaction PDA");
        return Err(ProgramError::InvalidAccountOwner);
    }

    // Calculate vault_transaction account size
    let vault_tx_size = VAULT_TRANSACTION_HEADER_SIZE + 72;

    // Create vault_transaction account
    let bump_binding = [transaction_bump];

    create_account_with_minimum_balance_signed(
        vault_transaction,
        vault_tx_size,
        &crate::ID,
        creator,
        None,
        &[Signer::from(&[
            Seed::from(SEED_PREFIX),
            Seed::from(multisig.key().as_ref()),
            Seed::from(SEED_TRANSACTION),
            Seed::from(&multisig_state.transaction_index.to_le_bytes()),
            Seed::from(&bump_binding),
        ])],
    )?;
    // ────────────────────────────────────────────────────────────
    // 6. Derive & Create proposal PDA
    // ────────────────────────────────────────────────────────────
    let (proposal_pda, proposal_bump) = pubkey::find_program_address(
        &[
            SEED_PREFIX,
            multisig.key().as_ref(),
            SEED_TRANSACTION,
            &multisig_state.transaction_index.to_le_bytes(),
            SEED_PROPOSAL,
        ],
        &crate::ID,
    );
    if proposal_pda.ne(proposal.key()) {
        sol_log("Invalid proposal PDA");
        return Err(ProgramError::InvalidAccountOwner);
    }

    // Calculate proposal account size: header + approvers array
    let proposal_size = PROPOSAL_HEADER_SIZE + 4 + (32 * members_len as usize);

    let bump_binding = [proposal_bump];
    create_account_with_minimum_balance_signed(
        proposal,
        proposal_size,
        &crate::ID,
        creator,
        None,
        &[Signer::from(&[
            Seed::from(SEED_PREFIX),
            Seed::from(multisig.key().as_ref()),
            Seed::from(SEED_TRANSACTION),
            Seed::from(&multisig_state.transaction_index.to_le_bytes()),
            Seed::from(SEED_PROPOSAL),
            Seed::from(&bump_binding),
        ])],
    )?;

    // ────────────────────────────────────────────────────────────
    // 7. Initialize Proposal State
    // ────────────────────────────────────────────────────────────
    let proposal_data = unsafe { proposal.borrow_mut_data_unchecked() };
    let proposal_state = unsafe {
        &mut *(proposal_data[..PROPOSAL_HEADER_SIZE].as_mut_ptr() as *mut ProposalHeader)
    };

    proposal_state.multisig = *multisig.key();
    proposal_state.transaction_index = multisig_state.transaction_index;
    proposal_state.status = 0; // Active
    proposal_state.timestamp = current_time;
    proposal_state.deadline = voting_deadline;
    proposal_state.bump = proposal_bump;
    proposal_state.proposal_type = 1;

    // Initialize approvers count to 0
    proposal_data[PROPOSAL_HEADER_SIZE..PROPOSAL_HEADER_SIZE + 4]
        .copy_from_slice(&(0u32).to_le_bytes());
    // Zero the approvers array
    proposal_data[PROPOSAL_HEADER_SIZE + 4..].fill(0);

    // ────────────────────────────────────────────────────────────
    // 8. Write vault_transaction Account Data
    // ────────────────────────────────────────────────────────────
    unsafe {
        let data_ptr = vault_transaction.borrow_mut_data_unchecked().as_mut_ptr();

        // Fixed header fields
        ptr::copy_nonoverlapping(multisig.key().as_ref().as_ptr(), data_ptr, 32); // [0..32) multisig
        ptr::copy_nonoverlapping(creator.key().as_ref().as_ptr(), data_ptr.add(32), 32); // [32..64) creator
        // [64..72)  transaction index (u64)
        ptr::copy_nonoverlapping(
            multisig_state.transaction_index.to_le_bytes().as_ptr(),
            data_ptr.add(64),
            8,
        );
        ptr::write(data_ptr.add(72), transaction_bump); // [72] bump

        // Write private proposal metadata if applicable

        if private_proposal_subtype == PROPOSAL_TYPE_PRIVATE_TRANSFER {
            // Validate metadata length
            if private_meta.len() < PRIVATE_TRANSFER_META_SIZE {
                sol_log("Private transfer metadata too short");
                return Err(ProgramError::InvalidInstructionData);
            }

            // Copy metadata: commitment (32) + amount (8) + recipient (32)
            ptr::copy_nonoverlapping(
                private_meta.as_ptr(),
                data_ptr.add(VAULT_TRANSACTION_HEADER_SIZE),
                PRIVATE_TRANSFER_META_SIZE,
            );
        }
        // Add else-if branches for other private proposal types here
    }

    msg!(
        "Proposal created. Transaction index: {}",
        multisig_state.transaction_index
    );
    Ok(())
}
