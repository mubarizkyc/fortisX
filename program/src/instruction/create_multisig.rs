use crate::state::MULTISIG_HEADER_SIZE;
use crate::state::{
    Multisig,
    seeds::{SEED_MULTISIG, SEED_PREFIX},
};
use pinocchio::log::sol_log_slice;
use pinocchio::syscalls::sol_log_pubkey;
use pinocchio::sysvars::rent;
use pinocchio::{
    ProgramResult,
    account_info::AccountInfo,
    instruction::{Seed, Signer},
    program_error::ProgramError,
    pubkey::Pubkey,
    pubkey::{self, pubkey_eq},
};
use pinocchio_system::create_account_with_minimum_balance_signed;
use solana_msg::sol_log;
pub const CREATION_FEE: usize = 50_000_000;
pub const CREATOR_WALLET: [u8; 32] = [
    73, 79, 187, 161, 231, 177, 205, 90, 98, 10, 47, 106, 245, 62, 123, 153, 152, 27, 85, 77, 195,
    221, 135, 210, 46, 152, 26, 129, 6, 139, 65, 215,
];
pub fn process_create_multisig(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    solana_msg::msg!("data len: {}", data.len());
    let mut offset = 0;

    let threshold = u16::from_le_bytes(data[offset..offset + 2].try_into().unwrap());
    offset += 2;
    solana_msg::msg!("threshold: {}", threshold);
    let rent_collector: [u8; 32] = data[offset..(offset + 32)]
        .try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    unsafe {
        sol_log_pubkey(rent_collector.as_ref().as_ptr());
    }
    offset += 32;

    let members_len = u32::from_le_bytes(data[offset..offset + 4].try_into().unwrap()) as usize;
    offset += 4;

    if members_len > u16::MAX as usize || threshold as usize > members_len {
        sol_log("invalid members config");
        return Err(ProgramError::InvalidInstructionData);
    }
    solana_msg::msg!("members_len: {}", members_len);
    solana_msg::msg!("offset: {}", offset);

    let members: &[u8] = &data[offset..(offset + 32 * members_len)];
    offset += 32 * members_len;

    let shares_len = u32::from_le_bytes(data[offset..offset + 4].try_into().unwrap()) as usize;
    offset += 4;

    if shares_len != members_len {
        sol_log("shares count must equal members count");
        return Err(ProgramError::InvalidInstructionData);
    }

    const SHARE_SIZE: usize = 32 + 4 + 60;
    let shares_bytes: &[u8] = &data[offset..offset + SHARE_SIZE * shares_len];
    offset += SHARE_SIZE * shares_len;

    let treasury_utxo_pubkey: [u8; 32] = data[offset..offset + 32]
        .try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let [treasury, multisig, create_key, creator, _] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let (derived_multisig_pda, bump) = pubkey::find_program_address(
        &[SEED_PREFIX, SEED_MULTISIG, create_key.key().as_ref()],
        &crate::ID,
    );
    if derived_multisig_pda.ne(multisig.key()) {
        return Err(ProgramError::InvalidAccountOwner);
    }

    let space = MULTISIG_HEADER_SIZE          // 139
        + 4 + 32 * members_len                // members vec
        + 4 + SHARE_SIZE * shares_len         // encrypted shares vec
        + 32                                  // treasury_utxo_pubkey
        + 32; // latest_utxo_commitment

    let bump_binding = [bump];

    create_account_with_minimum_balance_signed(
        multisig,
        space,
        &crate::ID,
        creator,
        None,
        &[Signer::from(&[
            Seed::from(SEED_PREFIX),
            Seed::from(SEED_MULTISIG),
            Seed::from(create_key.key().as_ref()),
            Seed::from(&bump_binding),
        ])],
    )?;

    let multisig_data = unsafe { multisig.borrow_mut_data_unchecked() };

    // safe — only fixed-size fields in Multisig header
    let state = Multisig::from_account_mut(multisig_data);
    state.create_key = *create_key.key();
    state.rent_collector = rent_collector;
    state.treasury_utxo_pubkey = treasury_utxo_pubkey;
    state.latest_utxo_commitment = [0u8; 32];
    state.transaction_index = 0;
    state.threshold = threshold;
    state.bump = bump;

    // dynamic tail
    let mut cur = MULTISIG_HEADER_SIZE;

    multisig_data[cur..cur + 4].copy_from_slice(&(members_len as u32).to_le_bytes());
    cur += 4;

    multisig_data[cur..cur + 32 * members_len].copy_from_slice(members);
    cur += 32 * members_len;

    multisig_data[cur..cur + 4].copy_from_slice(&(shares_len as u32).to_le_bytes());
    cur += 4;
    multisig_data[cur..cur + SHARE_SIZE * shares_len].copy_from_slice(shares_bytes);
    cur += SHARE_SIZE * shares_len;

    // treasury_utxo_pubkey already written via header cast above
    // but it's in header, not here — so nothing extra needed

    // latest_utxo_commitment also in header

    if !pubkey_eq(treasury.key(), &CREATOR_WALLET) {
        sol_log("invalid treasury");
        return Err(ProgramError::IncorrectAuthority);
    }
    pinocchio_system::instructions::Transfer {
        from: &creator,
        to: &treasury,
        lamports: CREATION_FEE as u64,
    }
    .invoke()?;
    sol_log("fortis created");
    Ok(())
}
