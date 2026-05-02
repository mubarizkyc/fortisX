// Local crate imports
use crate::{
    instruction::{MAX_EPHEMERAL_SIGNERS, PROPOSAL_HEADER_SIZE},
    state::{
        ProposalHeader, SEED_TRANSACTION,
        multisig::{MULTISIG_HEADER_SIZE, Multisig},
        seeds::{SEED_EPHEMERAL_SIGNER, SEED_MULTISIG, SEED_PREFIX, SEED_PROPOSAL, SEED_VAULT},
    },
};

// External crates
use arrayvec::ArrayVec;
use std::collections::HashMap;

// Pinocchio / Solana imports
use pinocchio::{
    ProgramResult,
    account_info::AccountInfo,
    cpi,
    instruction::{AccountMeta, Instruction, Seed, Signer},
    program_error::ProgramError,
    pubkey::{self, Pubkey},
    sysvars::{Sysvar, clock::Clock},
};

// Solana helper macros / logging
use solana_msg::sol_log;

// Constants
pub const LOOKUP_TABLE_META_SIZE: usize = 56;
pub const TRANSACTION_HEADER_LEN: usize = 78;

pub fn process_execute_proposal(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let [
        multisig,
        proposal,
        transaction,
        member,
        remaining_accounts @ ..,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    let multisig_data = unsafe {
        multisig
            .borrow_data_unchecked()
            .split_at(MULTISIG_HEADER_SIZE)
    };
    let multisig_state = unsafe { &*(multisig_data.0.as_ptr() as *const Multisig) };
    let members_len: u32 = unsafe { *(multisig_data.1[0..4].as_ptr() as *const u32) };

    let proposal_data = unsafe {
        proposal
            .borrow_mut_data_unchecked()
            .split_at_mut(PROPOSAL_HEADER_SIZE)
    };

    let proposal_state = unsafe { &mut *(proposal_data.0.as_mut_ptr() as *mut ProposalHeader) };
    let transaction_data = unsafe { transaction.borrow_data_unchecked() };
    //multisig & proposal & transaction pda verification
    //TODO:transaction bump verification
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
    if pubkey::find_program_address(
        &[
            SEED_PREFIX,
            multisig.key().as_ref(),
            SEED_TRANSACTION,
            &multisig_state.transaction_index.to_le_bytes(),
        ],
        &crate::ID,
    )
    .0
    .ne(transaction.key())
    {
        return Err(ProgramError::InvalidAccountOwner);
    };

    // Verify the signer is a valid multisig member
    if !multisig_state.is_member(members_len as u16, *member.key(), &multisig_data.1[4..]) {
        sol_log("member not authorized");
        return Err(ProgramError::IncorrectAuthority);
    }

    // Verify the proposal is in `Approved` status
    if proposal_state.status != 1 {
        sol_log("invalid proposal status");
        return Err(ProgramError::InvalidAccountData);
    }

    // Parse ephemeral signer bumps from the transaction data
    let ephemeral_signers_bump_count = transaction_data[74] as usize;
    let ephemeral_signer_bumps = &transaction_data
        [TRANSACTION_HEADER_LEN..TRANSACTION_HEADER_LEN + ephemeral_signers_bump_count];

    // Extract the raw transaction message
    let transaction_message_data: &[u8] =
        &transaction_data[(TRANSACTION_HEADER_LEN + ephemeral_signers_bump_count)..];

    // Reconstruct the vault signer PDA
    let vault_bump = [transaction_data[73]];
    let vault_seeds = &[
        Seed::from(SEED_PREFIX),
        Seed::from(multisig.key().as_ref()),
        Seed::from(SEED_VAULT),
        Seed::from(&vault_bump),
    ];
    let vault_signer = Signer::from(&vault_seeds[..]);

    let vault_pubkey = pubkey::create_program_address(
        &[
            SEED_PREFIX,
            multisig.key().as_ref(),
            SEED_VAULT,
            &vault_bump,
        ],
        &crate::ID,
    )?;
    solana_msg::msg!("tx_msg_len: {}", transaction_message_data.len());
    //  return Ok(());
    // Parse the number of account keys and address lookup tables from the transaction message
    let num_account_keys = transaction_message_data[3] as usize;
    solana_msg::msg!("num_account_keys: {}", num_account_keys);

    let num_ixs = transaction_message_data[3 + (num_account_keys * 32) + 1] as usize;
    solana_msg::msg!("num_ixs: {}", num_ixs);

    let executable_message = ExecutableTransactionMessage::new_validated(
        transaction_message_data,
        num_account_keys,
        remaining_accounts,
    )?;
    let protected_accounts: &[[u8; 32]] = &[*proposal.key()];

    let mut index_bytes: ArrayVec<[u8; 1], MAX_EPHEMERAL_SIGNERS> = ArrayVec::new();
    let mut bump_bytes: ArrayVec<[u8; 1], MAX_EPHEMERAL_SIGNERS> = ArrayVec::new();
    let mut seeds_array: ArrayVec<[Seed; 5], MAX_EPHEMERAL_SIGNERS> = ArrayVec::new();
    let mut signers: ArrayVec<Signer, MAX_EPHEMERAL_SIGNERS> = ArrayVec::new();
    for (index, bump) in ephemeral_signer_bumps.iter().enumerate() {
        index_bytes.push([index as u8]);
        bump_bytes.push([*bump]);
    }
    for i in 0..ephemeral_signer_bumps.len() {
        seeds_array.push([
            Seed::from(SEED_PREFIX),                // static slice OK
            Seed::from(transaction.key().as_ref()), // stable buffer
            Seed::from(SEED_EPHEMERAL_SIGNER),      // static slice OK
            Seed::from(&index_bytes[i][..]),        // stable array
            Seed::from(&bump_bytes[i][..]),         // stable array
        ]);
    }

    for seeds in &seeds_array {
        signers.push(Signer::from(&seeds[..]));
    }

    signers.push(vault_signer);

    executable_message.execute_message(signers.as_slice())?;

    // Mark the proposal as executed.
    proposal_state.status = 2; //executed;
    proposal_state.timestamp = Clock::get()?.unix_timestamp;

    Ok(())
}

/// Sanitized and validated combination of a `MsTransactionMessage` and `AccountInfo`s it references.
pub struct ExecutableTransactionMessage<'a> {
    //tx_message
    message: &'a [u8],
    /// Resolved `account_keys` of the message.
    static_accounts: Vec<&'a AccountInfo>,
}
impl<'a> ExecutableTransactionMessage<'a> {
    pub fn new_validated(
        message: &'a [u8],
        account_keys_len: usize,
        message_account_infos: &'a [AccountInfo],
    ) -> Result<Self, ProgramError> {
        // account keys start at byte 4:
        // [0] numSigners, [1] numWritableSigners, [2] numWritableNonSigners, [3] keys_len
        let keys_start = 4;
        let keys_end = keys_start + account_keys_len * 32;

        let account_keys: &[[u8; 32]] = bytemuck::cast_slice(&message[keys_start..keys_end]);

        let mut static_accounts: Vec<&'a AccountInfo> = Vec::with_capacity(account_keys_len);
        for i in 0..account_keys_len {
            static_accounts.push(&message_account_infos[i]);
        }

        Ok(Self {
            message,
            static_accounts,
        })
    }
    pub fn execute_message(&self, signers: &[Signer]) -> Result<(), ProgramError> {
        // layout:
        // [0]        numSigners (u8)
        // [1]        numWritableSigners (u8)
        // [2]        numWritableNonSigners (u8)
        // [3]        accountKeys length (u8)
        // [4..4+N*32] accountKeys (N * 32 bytes)
        // [4+N*32]   instructions length (u8)
        // then per instruction:
        //   [0]      programIdIndex (u8)
        //   [1]      accountIndexes length (u8)       ← was wrongly u32
        //   [2..2+M] accountIndexes (M bytes)
        //   [2+M]    data length (u16 LE)             ← was wrongly u32
        //   [4+M..4+M+D] data (D bytes)

        let num_account_keys = self.message[3] as usize;
        let mut offset = 1 + 1 + 1 + 1 + (32 * num_account_keys); // skip header + keys

        let ms_compiled_instruction_count = self.message[offset] as usize;
        offset += 1;

        for _ in 0..ms_compiled_instruction_count {
            // programIdIndex: u8
            let program_id_index = self.message[offset] as usize;
            offset += 1;

            // accountIndexes length: u8  ← FIXED (was u32)
            let num_account_indexes = self.message[offset] as usize;
            offset += 1;

            let account_indexes = &self.message[offset..offset + num_account_indexes];
            offset += num_account_indexes;

            // data length: u16 LE  ← FIXED (was u32)
            let data_len =
                u16::from_le_bytes(self.message[offset..offset + 2].try_into().unwrap()) as usize;
            offset += 2;

            let ix_data = &self.message[offset..offset + data_len];
            offset += data_len;

            // build account metas
            let ix_accounts: Vec<(&AccountInfo, AccountMeta)> = account_indexes
                .iter()
                .map(|&account_index| {
                    let idx = account_index as usize;
                    let account_info = self.get_account_by_index(idx).unwrap();
                    let is_signer = self.is_signer_index(idx);
                    let meta = if self.is_writable_index(idx) {
                        AccountMeta::new(account_info.key(), true, is_signer)
                    } else {
                        AccountMeta::new(account_info.key(), false, is_signer)
                    };
                    (account_info, meta)
                })
                .collect();

            let ix_program = self.get_account_by_index(program_id_index).unwrap();

            let ix = Instruction {
                program_id: ix_program.key(),
                accounts: &ix_accounts
                    .iter()
                    .map(|(_, m)| m.clone())
                    .collect::<Vec<_>>(),
                data: ix_data,
            };

            let mut account_infos: Vec<&AccountInfo> =
                ix_accounts.into_iter().map(|(ai, _)| ai).collect();
            account_infos.push(ix_program);

            cpi::slice_invoke_signed(&ix, account_infos.as_slice(), signers)?;
        }

        Ok(())
    }

    fn get_account_by_index(&self, index: usize) -> Result<&'a AccountInfo, ProgramError> {
        return Ok(&self.static_accounts[index]);
    }
    /// Returns true if the account at the specified index is a part of static `account_keys` and was requested to be writable.
    pub fn is_static_writable_index(&self, key_index: usize) -> bool {
        let num_account_keys = usize::from(self.message[3]);
        let num_signers = usize::from(self.message[0]);
        let num_writable_signers = usize::from(self.message[1]);
        let num_writable_non_signers = usize::from(self.message[2]);

        if key_index >= num_account_keys {
            // `index` is not a part of static `account_keys`.
            return false;
        }

        if key_index < num_writable_signers {
            // `index` is within the range of writable signer keys.
            return true;
        }

        if key_index >= num_signers {
            // `index` is within the range of non-signer keys.
            let index_into_non_signers = key_index.saturating_sub(num_signers);
            // Whether `index` is within the range of writable non-signer keys.
            return index_into_non_signers < num_writable_non_signers;
        }

        false
    }
    /// Whether the account at the `index` is requested as writable.
    fn is_writable_index(&self, index: usize) -> bool {
        if self.is_static_writable_index(index) {
            return true;
        }

        if index < self.static_accounts.len() {
            // Index is within static accounts but is not writable.
            return false;
        }

        // "Skip" the static account indexes.
        let index = index - self.static_accounts.len();

        index < 0
    }
    /// Returns true if the account at the specified index was requested to be a signer.
    pub fn is_signer_index(&self, key_index: usize) -> bool {
        let num_signers = self.message[0];
        key_index < usize::from(num_signers)
    }
}
