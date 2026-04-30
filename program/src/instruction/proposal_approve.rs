use crate::{
    instruction::PROPOSAL_HEADER_SIZE,
    state::{
        ProposalHeader, SEED_TRANSACTION,
        multisig::{MULTISIG_HEADER_SIZE, Multisig},
        seeds::{SEED_MULTISIG, SEED_PREFIX, SEED_PROPOSAL},
    },
};
use pinocchio::sysvars::Sysvar;
use pinocchio::sysvars::clock::Clock;
use pinocchio::{
    ProgramResult,
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::{self},
};
use solana_msg::sol_log;
pub fn process_approve_proposal(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    //return Ok(());
    //creator will be rent payer as well
    let [multisig, proposal, member] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    // multisig & proposal pda verification

    let proposal_data = unsafe {
        proposal
            .borrow_mut_data_unchecked()
            .split_at_mut(PROPOSAL_HEADER_SIZE)
    };

    let proposal_state = unsafe { &mut *(proposal_data.0.as_mut_ptr() as *mut ProposalHeader) };
    let multisig_data = unsafe { multisig.borrow_data_unchecked() };
    let multisig_state =
        unsafe { &*(multisig_data[..MULTISIG_HEADER_SIZE].as_ptr() as *const Multisig) };
    let members_len: u32 = unsafe {
        *(multisig_data[MULTISIG_HEADER_SIZE..MULTISIG_HEADER_SIZE + 4].as_ptr() as *const u32)
    };

    let (ms_pda, ms_bump) = pubkey::find_program_address(
        &[
            SEED_PREFIX,
            SEED_MULTISIG,
            multisig_state.create_key.as_ref(),
        ],
        &crate::ID,
    );
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

    if ms_pda.ne(multisig.key())
        || ms_bump != multisig_state.bump
        || proposal_pda.ne(proposal.key())
        || proposal_bump != proposal_state.bump
    {
        return Err(ProgramError::InvalidAccountOwner);
    }
    //verify member
    if !multisig_state.is_member(
        members_len as u16,
        *member.key(),
        &multisig_data[MULTISIG_HEADER_SIZE + 4..],
    ) {
        sol_log("member not authorized");
        return Err(ProgramError::IncorrectAuthority);
    }
    //check proposal status
    if proposal_state.status != 0 {
        //to vote ,proosal should be active
        sol_log("proposal is not active ");
        return Err(ProgramError::InvalidInstructionData);
    }
    let approvers_len: &mut u32 = unsafe { &mut *(proposal_data.1[0..4].as_mut_ptr() as *mut u32) };
    let approvers: &mut [[u8; 32]] = bytemuck::cast_slice_mut(&mut proposal_data.1[4..]);
    //check timelimit
    let timestamp = Clock::get()?.unix_timestamp;
    if timestamp > proposal_state.deadline {
        sol_log("deadline passed ,vote cannot be casted now");
        return Err(ProgramError::InvalidInstructionData);
    }

    for approver in approvers.iter_mut() {
        if *approver == *member.key().as_ref() {
            sol_log("member already approved");
            return Err(ProgramError::InvalidAccountData);
        }
        if *approver == [0u8; 32] {
            //there will be alwys space in approvers array ,if not ,the proposal status will be approved ,and hence this point is unreachable
            *approver = *member.key();
            *approvers_len += 1;
            break;
        }
    }
    //
    // ────────────────────────────────────────────────────────────
    //  6. CHECK THRESHOLD → MARK PROPOSAL "APPROVED"
    // ────────────────────────────────────────────────────────────
    //

    if (*approvers_len as u16) >= multisig_state.threshold {
        proposal_state.status = 1; // approved
        proposal_state.timestamp = timestamp;
    }

    return Ok(());
}
