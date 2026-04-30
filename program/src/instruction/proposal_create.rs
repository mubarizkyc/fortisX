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
    pubkey::{self},
};
use pinocchio_system::create_account_with_minimum_balance_signed;
pub const MAX_EPHEMERAL_SIGNERS: usize = 16;
pub const PROPOSAL_HEADER_SIZE: usize = 59;
//ARGS:ProposalCreate + TransactionMessage(raw [u8])
pub fn process_create_proposal(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    //creator will be rent payer as well
    let [multisig, vault_transaction, creator, proposal, _] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    let multisig_data = unsafe {
        multisig
            .borrow_mut_data_unchecked()
            .split_at_mut(MULTISIG_HEADER_SIZE)
    };

    let multisig_state = unsafe { &mut *(multisig_data.0.as_mut_ptr() as *mut Multisig) };
    let members_len: u32 = unsafe { *(multisig_data.1[0..4].as_ptr() as *const u32) };
    //multisig_pda_verification
    let (ms_pda, ms_bump) = pubkey::find_program_address(
        &[
            SEED_PREFIX,
            SEED_MULTISIG,
            multisig_state.create_key.as_ref(),
        ],
        &crate::ID,
    );
    if ms_pda.ne(multisig.key()) || ms_bump != multisig_state.bump {
        return Err(ProgramError::InvalidAccountOwner);
    }
    //verify member
    if !multisig_state.is_member(members_len as u16, *creator.key(), &multisig_data.1[4..]) {
        solana_msg::sol_log("member not authorized");
        return Err(ProgramError::IncorrectAuthority);
    }
    //create an account for proposal
    let ephemeral_signers = data[0];
    let proposal_type = data[1];
    let voting_deadline = unsafe { *(data[2..10].as_ptr() as *const i64) };
    let tx_message_len = unsafe { *(data[10..14].as_ptr() as *const u32) as usize };
    let tx_message = &data[14..14 + tx_message_len];
    //update multisig transaction index;

    //updating wallet to current transaction index
    multisig_state.transaction_index = multisig_state.transaction_index.checked_add(1).unwrap();

    //initalize account for transaction
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
        return Err(ProgramError::InvalidAccountOwner);
    }
    let bump_binding = [transaction_bump];
    create_account_with_minimum_balance_signed(
        vault_transaction,
        32 + 32 + 8 + 1 + 1 + 4 + (ephemeral_signers as usize) + tx_message_len,
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
        return Err(ProgramError::InvalidAccountOwner);
    }
    let bump_binding = [proposal_bump];
    // proposal size: 32 + 8  +1 +1 + 8 + 8 + 1 + 4 + (32 * members_len)
    // ensure multisig_state.members_len exists and cast safely
    create_account_with_minimum_balance_signed(
        proposal,
        32 + 8 + 1 + 1 + 8 + 8 + 1 + 4 + (32 * members_len) as usize,
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
    let (_, vault_bump) = pubkey::find_program_address(
        &[SEED_PREFIX, multisig.key().as_ref(), SEED_VAULT],
        &crate::ID,
    );
    let mut ephermel_signer_bumps: ArrayVec<u8, MAX_EPHEMERAL_SIGNERS> = ArrayVec::new();
    for ephemeral_signer_index in 0..ephemeral_signers {
        ephermel_signer_bumps.push(
            pubkey::find_program_address(
                &[
                    SEED_PREFIX,
                    vault_transaction.key().as_ref(),
                    SEED_EPHEMERAL_SIGNER,
                    &ephemeral_signer_index.to_le_bytes(),
                ],
                &crate::ID,
            )
            .1,
        )
    }
    //update proposal
    let proposal_data = unsafe { proposal.borrow_mut_data_unchecked() };
    let proposal_state = unsafe {
        &mut *(proposal_data[..PROPOSAL_HEADER_SIZE].as_mut_ptr() as *mut ProposalHeader)
    };
    proposal_state.multisig = *multisig.key();
    proposal_state.transaction_index = multisig_state.transaction_index;
    proposal_state.status = 0; //Active
    proposal_state.timestamp = Clock::get()?.unix_timestamp;
    proposal_state.deadline = voting_deadline;
    proposal_state.bump = proposal_bump;
    proposal_state.proposal_type = proposal_type;
    //current approved count=0;
    proposal_data[PROPOSAL_HEADER_SIZE..PROPOSAL_HEADER_SIZE + 4]
        .copy_from_slice(&(0u32).to_le_bytes());
    // zero the approvers / members area
    proposal_data[PROPOSAL_HEADER_SIZE + 4..].fill(0);
    // Write vault_transaction buffer safely and bounded
    unsafe {
        let data_ptr = vault_transaction.borrow_mut_data_unchecked().as_mut_ptr();
        //
        // ────────────────────────────────────────────────────────────
        //  1. FIXED-SIZE HEADER FIELDS (total offset so far: 74 bytes)
        // ────────────────────────────────────────────────────────────
        //
        // [0..32)   multisig pubkey
        ptr::copy_nonoverlapping(multisig.key().as_ref().as_ptr(), data_ptr, 32);
        // [32..64)  creator pubkey
        ptr::copy_nonoverlapping(creator.key().as_ref().as_ptr(), data_ptr.add(32), 32);
        // [64..72)  transaction index (u64)
        ptr::copy_nonoverlapping(
            multisig_state.transaction_index.to_le_bytes().as_ptr(),
            data_ptr.add(64),
            8,
        );
        // [72]      transaction bump (u8)
        ptr::write(data_ptr.add(72), transaction_bump);

        // [73]      vault bump (u8)
        ptr::write(data_ptr.add(73), vault_bump);
        //
        // ────────────────────────────────────────────────────────────
        //  2. VARIABLE-FIELD SIZES METADATA
        // ────────────────────────────────────────────────────────────
        //
        // [74..78)  ephemeral signer count as u32
        // (stored as u32 to help client-side deserialization)
        ptr::copy_nonoverlapping(
            (ephemeral_signers as u32).to_le_bytes().as_ptr(),
            data_ptr.add(74),
            4,
        );
        //
        // ────────────────────────────────────────────────────────────
        //  3. VARIABLE-LENGTH FIELDS
        // ────────────────────────────────────────────────────────────
        //
        // [78..78+N)  ephemeral signer bumps
        ptr::copy_nonoverlapping(
            ephermel_signer_bumps.as_slice().as_ptr(),
            data_ptr.add(78),
            ephemeral_signers as usize,
        );
        // [78+N..78+N+M)  raw transaction message bytes
        ptr::copy_nonoverlapping(
            tx_message.as_ptr(),
            data_ptr.add(78 + (ephemeral_signers as usize)),
            tx_message_len,
        );
    };
    let transaction_index = multisig_state.transaction_index;
    solana_msg::msg!("transaction index: {}", transaction_index);

    Ok(())
}
