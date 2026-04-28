use crate::{
    instruction::PROPOSAL_HEADER_SIZE,
    state::{
        ProposalHeader, SEED_TRANSACTION,
        multisig::{MULTISIG_HEADER_SIZE, MultisigHeader},
        seeds::{SEED_MULTISIG, SEED_PREFIX, SEED_PROPOSAL},
    },
};
use pinocchio::sysvars::clock::Clock;
use pinocchio::{
    ProgramResult,
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::{self},
};
use pinocchio::{pubkey::pubkey_eq, sysvars::Sysvar};
pub fn process_account_close(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let [multisig, proposal, transaction, rent_collector, _] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // multisig & proposal pda verification
    let multisig_data = unsafe { multisig.borrow_data_unchecked() };
    let transaction_data = unsafe { transaction.borrow_data_unchecked() };
    //check if tx belongs to this multisig
    if transaction_data[0..32] != *multisig.key().as_ref() {
        //  solana_msg::sol_log("tx does not belongs to this multisig");
        return Err(ProgramError::InvalidAccountData);
    }
    let transaction_index: u64 = unsafe { *(transaction_data[64..72].as_ptr() as *const u64) };
    let multisig_state =
        unsafe { &*(multisig_data[..MULTISIG_HEADER_SIZE].as_ptr() as *const MultisigHeader) };
    let (ms_pda, ms_bump) = pubkey::find_program_address(
        &[
            SEED_PREFIX,
            SEED_MULTISIG,
            multisig_state.create_key.as_ref(),
        ],
        &crate::ID,
    );

    if ms_pda != *multisig.key() || ms_bump != multisig_state.bump {
        return Err(ProgramError::InvalidAccountOwner);
    }
    let (proposal_pda, _) = pubkey::find_program_address(
        &[
            SEED_PREFIX,
            multisig.key().as_ref(),
            SEED_TRANSACTION,
            &transaction_index.to_le_bytes(),
            SEED_PROPOSAL,
        ],
        &crate::ID,
    );

    if proposal_pda != *proposal.key() {
        return Err(ProgramError::InvalidAccountOwner);
    }

    if !pubkey_eq(rent_collector.key(), &multisig_state.rent_collector) {
        return Err(ProgramError::IncorrectAuthority);
    }

    let proposal_state = unsafe {
        &*(proposal.borrow_data_unchecked()[..PROPOSAL_HEADER_SIZE].as_ptr() as *mut ProposalHeader)
    };

    // a proposal can only be clossed
    //if it is executed
    //or deadlline has passed & its already active means (it could not qualify in dealine)
    if proposal_state.status == 2
        || (proposal_state.status == 0 && Clock::get()?.unix_timestamp > proposal_state.deadline)
    {
        //close tx account
        close(transaction, rent_collector)?;
        close(proposal, rent_collector)?;
        return Ok(());
    }
    solana_msg::sol_log("invalid proposal status");
    return Err(ProgramError::InvalidInstructionData);
}
fn close(account: &AccountInfo, destination: &AccountInfo) -> ProgramResult {
    {
        let mut data = account.try_borrow_mut_data()?;
        data[0] = 0xff;
    }
    *destination.try_borrow_mut_lamports()? += *account.try_borrow_lamports()?;
    unsafe {
        account.assign(&pinocchio_system::ID);
    }
    account.resize(1)?;
    account.close()
}
