#![allow(unexpected_cfgs)]
use crate::instruction::{self};
use pinocchio::{
    ProgramResult, account_info::AccountInfo, program_entrypoint, program_error::ProgramError,
    pubkey::Pubkey,
};

use solana_msg::sol_log;

// This is the entrypoint for the program.
program_entrypoint!(process_instruction);
pinocchio::default_allocator!();

#[inline(always)]
fn process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let (ix_disc, instruction_data) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;
    match ix_disc {
        0 => {
            sol_log("multisigCreate");
            instruction::process_create_multisig(accounts, instruction_data)
        }

        1 => {
            sol_log("proposalCreate");
            instruction::process_create_proposal(accounts, instruction_data)
        }
        /*
        2 => {
            sol_log("proposalApprove");
            instruction::process_approve_proposal(accounts, instruction_data)
        }
        3 => {
            sol_log("proposalExecute");
            instruction::process_execute_proposal(accounts, instruction_data)?;
            Ok(())
        }
        4 => {
            sol_log("proposalAccountsClose");
            instruction::process_account_close(accounts, instruction_data)?;
            Ok(())
        }
        */
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
