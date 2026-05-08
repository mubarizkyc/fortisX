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
// ────────────────────────────────────────────────────────────
// New layout constants
// ────────────────────────────────────────────────────────────

/// vault_transaction account: fixed 105 bytes
/// [0..32)   multisig pubkey
/// [32..64)  creator pubkey
/// [64..72)  transaction_index (u64 LE)
/// [72]      bump
/// [73..105) payload_hash (32 bytes, Blake3)
pub const VAULT_TRANSACTION_SIZE: usize = 32 + 32 + 8 + 1 + 32; // 105 bytes, fixed forever

/// Instruction data layout (after discriminator stripped by router):
/// [0..8)  voting_deadline (i64 LE)
/// [8]     proposal_type (u8)
/// [9..41) payload_hash (32 bytes) — Blake3(payload_bytes || salt), computed client-side
pub const IX_MIN_LEN: usize = 8 + 1 + 32; // 41 bytes

pub fn process_create_private_proposal(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    // ────────────────────────────────────────────────────────
    // 1. Accounts
    // ────────────────────────────────────────────────────────
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

    // ────────────────────────────────────────────────────────
    // 2. Parse — fixed layout, no loops, no variable length
    // ────────────────────────────────────────────────────────
    if data.len() < IX_MIN_LEN {
        sol_log("Instruction data too short");
        return Err(ProgramError::InvalidInstructionData);
    }

    let voting_deadline = i64::from_le_bytes(
        data[0..8]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    /*
    0 -> public proposal
    1 -> private transfer proposal
    2 -> private swap proposal
     */
    let proposal_type = data[8];
    let payload_hash = &data[9..41]; // 32 bytes, client computed Blake3

    // Reject zero hash — client must always provide a real hash
    if payload_hash.iter().all(|&b| b == 0) {
        sol_log("Payload hash must not be zero");
        return Err(ProgramError::InvalidInstructionData);
    }

    let current_time = Clock::get()?.unix_timestamp;
    if voting_deadline <= current_time {
        sol_log("Voting deadline must be in the future");
        return Err(ProgramError::InvalidInstructionData);
    }

    // ────────────────────────────────────────────────────────
    // 3. Multisig state & member check  (unchanged)
    // ────────────────────────────────────────────────────────
    let multisig_data = unsafe {
        multisig
            .borrow_mut_data_unchecked()
            .split_at_mut(MULTISIG_HEADER_SIZE)
    };
    let multisig_state = unsafe { &mut *(multisig_data.0.as_mut_ptr() as *mut Multisig) };
    let members_len = u32::from_le_bytes(
        multisig_data.1[0..4]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );

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
    if !multisig_state.is_member(members_len as u16, *creator.key(), &multisig_data.1[4..]) {
        sol_log("Member not authorized");
        return Err(ProgramError::IncorrectAuthority);
    }

    // ────────────────────────────────────────────────────────
    // 4. Transaction index
    // ────────────────────────────────────────────────────────
    multisig_state.transaction_index = multisig_state
        .transaction_index
        .checked_add(1)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    let tx_index_bytes = multisig_state.transaction_index.to_le_bytes();

    let (transaction_pda, transaction_bump) = pubkey::find_program_address(
        &[
            SEED_PREFIX,
            multisig.key().as_ref(),
            SEED_TRANSACTION,
            &tx_index_bytes,
        ],
        &crate::ID,
    );
    if transaction_pda.ne(vault_transaction.key()) {
        sol_log("Invalid vault_transaction PDA");
        return Err(ProgramError::InvalidAccountOwner);
    }

    // ────────────────────────────────────────────────────────
    // 5. Create vault_transaction — fixed size, always 105 bytes
    // ────────────────────────────────────────────────────────
    let bump_binding = [transaction_bump];
    create_account_with_minimum_balance_signed(
        vault_transaction,
        VAULT_TRANSACTION_SIZE,
        &crate::ID,
        creator,
        None,
        &[Signer::from(&[
            Seed::from(SEED_PREFIX),
            Seed::from(multisig.key().as_ref()),
            Seed::from(SEED_TRANSACTION),
            Seed::from(&tx_index_bytes),
            Seed::from(&bump_binding),
        ])],
    )?;

    // ────────────────────────────────────────────────────────
    // 6. Create proposal PDA  (unchanged)
    // ────────────────────────────────────────────────────────
    let (proposal_pda, proposal_bump) = pubkey::find_program_address(
        &[
            SEED_PREFIX,
            multisig.key().as_ref(),
            SEED_TRANSACTION,
            &tx_index_bytes,
            SEED_PROPOSAL,
        ],
        &crate::ID,
    );
    if proposal_pda.ne(proposal.key()) {
        sol_log("Invalid proposal PDA");
        return Err(ProgramError::InvalidAccountOwner);
    }

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
            Seed::from(&tx_index_bytes),
            Seed::from(SEED_PROPOSAL),
            Seed::from(&bump_binding),
        ])],
    )?;

    // ────────────────────────────────────────────────────────
    // 7. Write proposal state  (unchanged except proposal_type)
    // ────────────────────────────────────────────────────────
    let proposal_data = unsafe { proposal.borrow_mut_data_unchecked() };
    let proposal_state = unsafe {
        &mut *(proposal_data[..PROPOSAL_HEADER_SIZE].as_mut_ptr() as *mut ProposalHeader)
    };
    proposal_state.multisig = *multisig.key();
    proposal_state.transaction_index = multisig_state.transaction_index;
    proposal_state.status = 0;
    proposal_state.timestamp = current_time;
    proposal_state.deadline = voting_deadline;
    proposal_state.bump = proposal_bump;
    proposal_state.proposal_type = proposal_type;

    proposal_data[PROPOSAL_HEADER_SIZE..PROPOSAL_HEADER_SIZE + 4]
        .copy_from_slice(&0u32.to_le_bytes());
    proposal_data[PROPOSAL_HEADER_SIZE + 4..].fill(0);

    // ────────────────────────────────────────────────────────
    // 8. Write vault_transaction — just header + hash, no loops
    // ────────────────────────────────────────────────────────
    unsafe {
        let p = vault_transaction.borrow_mut_data_unchecked().as_mut_ptr();

        ptr::copy_nonoverlapping(multisig.key().as_ref().as_ptr(), p, 32);
        ptr::copy_nonoverlapping(creator.key().as_ref().as_ptr(), p.add(32), 32);
        ptr::copy_nonoverlapping(tx_index_bytes.as_ptr(), p.add(64), 8);
        ptr::write(p.add(72), transaction_bump);

        // payload_hash at [73..105) — client computed, we just store it
        ptr::copy_nonoverlapping(payload_hash.as_ptr(), p.add(73), 32);
    }

    msg!(
        "Private proposal created. index={} type={}",
        multisig_state.transaction_index,
        proposal_type,
    );
    Ok(())
}
