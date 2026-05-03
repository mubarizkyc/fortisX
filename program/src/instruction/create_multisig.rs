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
use solana_msg::msg;
use solana_msg::sol_log;
pub const CREATION_FEE: usize = 50_000_000;
pub const CREATOR_WALLET: [u8; 32] = [
    73, 79, 187, 161, 231, 177, 205, 90, 98, 10, 47, 106, 245, 62, 123, 153, 152, 27, 85, 77, 195,
    221, 135, 210, 46, 152, 26, 129, 6, 139, 65, 215,
];
// 32+32+32+32+8+2+1
pub const MEMBER_PUBKEY_SIZE: usize = 32;
pub const ENCRYPTED_SHARE_CIPHERTEXT_SIZE: usize = 105; // NaCl box: 32 ephemeral + 24 nonce + 48 ciphertext+auth
pub const ENCRYPTED_SHARE_SIZE: usize = MEMBER_PUBKEY_SIZE + ENCRYPTED_SHARE_CIPHERTEXT_SIZE; // 32 + 105 = 137

// ────────────────────────────────────────────────────────────
// Instruction: process_create_multisig
// ────────────────────────────────────────────────────────────
pub fn process_create_multisig(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    msg!("process_create_multisig: data len = {}", data.len());

    let mut offset = 0;

    // 1. Parse threshold (u16 LE)
    let threshold = u16::from_le_bytes(
        data[offset..offset + 2]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    offset += 2;
    msg!("threshold: {}", threshold);

    // 2. Parse rent_collector (32 bytes)
    let rent_collector: [u8; 32] = data[offset..offset + 32]
        .try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    offset += 32;
    unsafe { sol_log_pubkey(rent_collector.as_ptr()) };

    // 3. Parse members_len (u32 LE)
    let members_len = u32::from_le_bytes(
        data[offset..offset + 4]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    ) as usize;
    offset += 4;

    if members_len == 0 || members_len > u16::MAX as usize || threshold as usize > members_len {
        sol_log("invalid members config: members_len or threshold out of bounds");
        return Err(ProgramError::InvalidInstructionData);
    }
    msg!("members_len: {}", members_len);
    msg!("offset after members_len: {}", offset);

    // 4. Parse members array: N * 32 bytes
    let members_bytes_start = offset;
    let members_bytes_end = offset + MEMBER_PUBKEY_SIZE * members_len;
    if members_bytes_end > data.len() {
        sol_log("instruction data too short for members array");
        return Err(ProgramError::InvalidInstructionData);
    }
    let _members_bytes: &[u8] = &data[members_bytes_start..members_bytes_end];
    offset = members_bytes_end;
    msg!("offset after members: {}", offset);

    // 5. Parse shares_len (u32 LE)
    let shares_len = u32::from_le_bytes(
        data[offset..offset + 4]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    ) as usize;
    offset += 4;

    // Validate: shares count must equal members count
    if shares_len != members_len {
        sol_log("shares count must equal members count");
        return Err(ProgramError::InvalidInstructionData);
    }
    msg!("shares_len: {}", shares_len);

    // 6. Parse encrypted shares array: M * 136 bytes (fixed size, NO length prefix)
    let shares_bytes_start = offset;
    let shares_bytes_end = offset + ENCRYPTED_SHARE_SIZE * shares_len;
    if shares_bytes_end > data.len() {
        sol_log(&format!(
            "instruction data too short for shares: expected {} bytes, have {}",
            shares_bytes_end,
            data.len()
        ));
        return Err(ProgramError::InvalidInstructionData);
    }
    let shares_bytes: &[u8] = &data[shares_bytes_start..shares_bytes_end];
    offset = shares_bytes_end;
    msg!("offset after shares: {}", offset);

    // 7. Parse treasury_utxo_pubkey (32 bytes)
    let treasury_utxo_pubkey: [u8; 32] = data[offset..offset + 32]
        .try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    offset += 32;

    // Validate: no extra data
    if offset != data.len() {
        sol_log(&format!(
            "unexpected trailing data: offset={} data.len()={}",
            offset,
            data.len()
        ));
        return Err(ProgramError::InvalidInstructionData);
    }

    // ────────────────────────────────────────────────────────
    // Account Validation
    // ────────────────────────────────────────────────────────
    let [treasury, multisig, create_key, creator, system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Verify multisig PDA
    let (derived_multisig_pda, bump) = pubkey::find_program_address(
        &[SEED_PREFIX, SEED_MULTISIG, create_key.key().as_ref()],
        &crate::ID,
    );
    if derived_multisig_pda.ne(multisig.key()) {
        sol_log("invalid multisig PDA");
        return Err(ProgramError::InvalidAccountOwner);
    }

    // ────────────────────────────────────────────────────────
    // Calculate Account Space
    // ────────────────────────────────────────────────────────
    let space = MULTISIG_HEADER_SIZE                    // 139
        + 4                                             // members_len (u32)
        + 32 * members_len              // members array
        + 4                                             // shares_len (u32)
        + ENCRYPTED_SHARE_SIZE * shares_len             // encrypted shares array (137 bytes each)
        + 32                                            // treasury_utxo_pubkey (already in header, but counted for clarity)
        + 32; // latest_utxo_commitment (in header)

    // ────────────────────────────────────────────────────────
    // Create Multisig Account via CPI
    // ────────────────────────────────────────────────────────
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

    // ────────────────────────────────────────────────────────
    // Initialize Multisig State
    // ────────────────────────────────────────────────────────
    let multisig_data = unsafe { multisig.borrow_mut_data_unchecked() };
    let state = Multisig::from_account_mut(multisig_data);

    state.create_key = *create_key.key();
    state.rent_collector = rent_collector;
    state.treasury_utxo_pubkey = treasury_utxo_pubkey;
    state.latest_utxo_commitment = [0u8; 32];
    state.transaction_index = 0;
    state.threshold = threshold;
    state.bump = bump;

    // Write dynamic tail: members array
    let mut cur = MULTISIG_HEADER_SIZE;
    multisig_data[cur..cur + 4].copy_from_slice(&(members_len as u32).to_le_bytes());
    cur += 4;
    multisig_data[cur..cur + MEMBER_PUBKEY_SIZE * members_len].copy_from_slice(_members_bytes);
    cur += MEMBER_PUBKEY_SIZE * members_len;

    // Write dynamic tail: encrypted shares array (fixed 136 bytes each)
    multisig_data[cur..cur + 4].copy_from_slice(&(shares_len as u32).to_le_bytes());
    cur += 4;
    multisig_data[cur..cur + ENCRYPTED_SHARE_SIZE * shares_len].copy_from_slice(shares_bytes);
    // cur += ENCRYPTED_SHARE_SIZE * shares_len; // not needed after last write

    // ────────────────────────────────────────────────────────
    // Transfer Creation Fee to Treasury
    // ────────────────────────────────────────────────────────
    if !pinocchio::pubkey::pubkey_eq(treasury.key(), &CREATOR_WALLET) {
        sol_log("invalid treasury account");
        return Err(ProgramError::IncorrectAuthority);
    }

    pinocchio_system::instructions::Transfer {
        from: creator,
        to: treasury,
        lamports: CREATION_FEE as u64,
    }
    .invoke()?;

    sol_log("✅ Multisig created successfully");
    Ok(())
}
