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

    // Parse the number of account keys and address lookup tables from the transaction message
    let num_account_keys =
        unsafe { *(transaction_message_data[3..7].as_ptr() as *const u32) as usize };
    let num_lookups = unsafe {
        *(transaction_message_data[7 + (num_account_keys * 32)..7 + (num_account_keys * 32) + 4]
            .as_ptr() as *const u32) as usize
    };

    // Split the remaining accounts slice into message accounts and add

    // Split the remaining accounts slice into message accounts and address lookup table accounts
    let message_account_infos = &remaining_accounts[num_lookups..];
    let address_lookup_table_account_infos = &remaining_accounts[..num_lookups];
    //TODO:strucute validation

    let executable_message = ExecutableTransactionMessage::new_validated(
        transaction_message_data,
        num_account_keys,
        num_lookups,
        message_account_infos,
        address_lookup_table_account_infos,
        &vault_pubkey,
    )?;
    let protected_accounts: &[[u8; 32]] = &[*proposal.key()];

    // Execute the transaction message instructions one-by-one.
    // NOTE: `execute_message()` calls `self.to_instructions_and_accounts()`
    // which in turn calls `take()` on
    // `self.message.instructions`, therefore after this point no more
    // references or usages of `self.message` should be made to avoid
    // faulty behavior.

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

    executable_message.execute_message(signers.as_slice(), protected_accounts)?;

    // Mark the proposal as executed.
    proposal_state.status = 2; //executed;
    proposal_state.timestamp = Clock::get()?.unix_timestamp;

    Ok(())
}

/// Sanitized and validated combination of a `MsTransactionMessage` and `AccountInfo`s it references.
pub struct ExecutableTransactionMessage<'a> {
    //tx_message
    message: &'a [u8],
    //the offset now pointinto to vec <ms_compiled_ix>
    offset: usize,
    /// Resolved `account_keys` of the message.
    static_accounts: Vec<&'a AccountInfo>,
    /// Concatenated vector of resolved `writable_indexes` from all address lookups.
    loaded_writable_accounts: Vec<&'a AccountInfo>,
    /// Concatenated vector of resolved `readonly_indexes` from all address lookups.
    loaded_readonly_accounts: Vec<&'a AccountInfo>,
}
impl<'a> ExecutableTransactionMessage<'a> {
    /// # Arguments
    /// `message` - a `MsTransactionMessage`.
    /// `message_account_infos` - AccountInfo's that are expected to be mentioned in the message.
    /// `address_lookup_table_account_infos` - AccountInfo's that are expected to correspond to the lookup tables mentioned in `message.address_table_lookups`.
    /// `vault_pubkey` - The vault PDA that is expected to sign the message.

    pub fn new_validated(
        message: &'a [u8],
        account_keys_len: usize,
        num_lookups: usize,
        message_account_infos: &'a [AccountInfo],
        address_lookup_table_account_infos: &'a [AccountInfo],
        vault_pubkey: &'a Pubkey,
    ) -> Result<Self, ProgramError> {
        let lookup_tables: HashMap<&Pubkey, &AccountInfo> = address_lookup_table_account_infos
            .iter()
            .enumerate()
            .map(|(index, maybe_lookup_table)| (maybe_lookup_table.key(), maybe_lookup_table))
            .collect::<HashMap<&Pubkey, &AccountInfo>>();

        let mut writable_accounts: Vec<&'a AccountInfo> = Vec::new();
        let mut readonly_accounts: Vec<&'a AccountInfo> = Vec::new();
        let mut static_accounts: Vec<&'a AccountInfo> = Vec::new();

        let account_keys: &[[u8; 32]] =
            bytemuck::cast_slice(&message[7..7 + (account_keys_len * 32)]);

        for (i, _) in account_keys.iter().enumerate() {
            let account_info = &message_account_infos[i];
            static_accounts.push(account_info);
        }
        let mut offset = 7 + (account_keys_len * 32); // start of vec<alt>
        offset += 4;

        let mut message_indexes_cursor = account_keys_len;

        for _ in 0..num_lookups {
            let lookup_table_account_key: [u8; 32] =
                message[offset..offset + 32].try_into().unwrap();

            //fetch the account corresponding to the key
            let lookup_table_data = unsafe {
                &lookup_tables
                    .get(&lookup_table_account_key)
                    .unwrap()
                    .borrow_data_unchecked()[..]
            };
            //needed for verification
            //     let lookup_table = deserialize_lookup(lookup_table_data).unwrap();
            let num_writable_indexes =
                u32::from_le_bytes(message[offset..offset + 4].try_into().unwrap()) as usize;
            offset += 4; // add length of indexes 
            let writable_indexes = &message[offset..offset + num_writable_indexes];
            offset += num_writable_indexes; // add indexes 
            for (i, index_in_lookup_table) in writable_indexes.iter().enumerate() {
                let index = message_indexes_cursor + i;
                let loaded_account_info = &message_account_infos.get(index).unwrap();
                writable_accounts.push(loaded_account_info);
            }
            let num_readonly_indexes =
                u32::from_le_bytes(message[offset..offset + 4].try_into().unwrap()) as usize;
            offset += 4; // add length of indexes 
            let readonly_indexes = &message[offset..offset + num_readonly_indexes];
            offset += num_readonly_indexes; // add indexes 
            for (i, index_in_lookup_table) in readonly_indexes.iter().enumerate() {
                let index = message_indexes_cursor + i;
                let loaded_account_info = &message_account_infos.get(index).unwrap();
                readonly_accounts.push(loaded_account_info);
            }
            message_indexes_cursor += num_readonly_indexes;
        }

        Ok(Self {
            message,
            offset,
            static_accounts,
            loaded_writable_accounts: writable_accounts,
            loaded_readonly_accounts: readonly_accounts,
        })
    }

    /// Executes all instructions in the message via CPI calls.
    /// # Arguments
    /// * `vault_seeds` - Seeds for the vault PDA.
    /// * `ephemeral_signer_seeds` - Seeds for the ephemeral signer PDAs.
    /// * `protected_accounts` - Accounts that must not be passed as writable to the CPI calls to prevent potential reentrancy attacks.
    pub fn execute_message(
        &self,
        signers: &[Signer],
        protected_accounts: &[Pubkey],
    ) -> Result<(), ProgramError> {
        let mut offset = self.offset;

        let ms_compiled_instruction_count =
            u32::from_le_bytes(self.message[offset..offset + 4].try_into().unwrap()) as usize;

        offset += 4;
        for _ in 0..ms_compiled_instruction_count {
            let program_id_index = self.message[offset];
            offset += 1;
            let num_account_indexes =
                u32::from_le_bytes(self.message[offset..offset + 4].try_into().unwrap()) as usize;
            offset += 4;
            let account_indexes = &self.message[offset..offset + num_account_indexes];
            offset += num_account_indexes;

            let data_len =
                u32::from_le_bytes(self.message[offset..offset + 4].try_into().unwrap()) as usize;
            offset += 4;
            let ix_data = &self.message[offset..offset + data_len];
            offset += data_len;
            let ix_accounts: Vec<(&AccountInfo, AccountMeta)> = account_indexes
                .iter()
                .map(|account_index| {
                    let account_index = usize::from(*account_index);
                    let account_info = self.get_account_by_index(account_index).unwrap();

                    // `is_signer` cannot just be taken from the account info, because for `authority`
                    // it's always false in the passed account infos, but might be true in the actual instructions.
                    let is_signer = self.is_signer_index(account_index);

                    let account_meta = if self.is_writable_index(account_index) {
                        AccountMeta::new(account_info.key(), true, is_signer)
                    } else {
                        AccountMeta::new(account_info.key(), false, is_signer)
                    };

                    (account_info, account_meta)
                })
                .collect();
            let ix_program_account_info = self
                .get_account_by_index(usize::from(program_id_index))
                .unwrap();
            let ix = Instruction {
                program_id: ix_program_account_info.key(),
                accounts: &ix_accounts
                    .iter()
                    .map(|(_, m)| m.clone())
                    .collect::<Vec<_>>(),
                data: ix_data,
            };
            let mut account_infos: Vec<&AccountInfo> = ix_accounts
                .into_iter()
                .map(|(account_info, _)| account_info)
                .collect();
            // Add Program ID
            account_infos.push(ix_program_account_info);

            cpi::slice_invoke_signed(&ix, account_infos.as_slice(), signers)?;
        }

        Ok(())
        // executable_instructions
    }

    fn get_account_by_index(&self, index: usize) -> Result<&'a AccountInfo, ProgramError> {
        if index < self.static_accounts.len() {
            return Ok(self.static_accounts[index]);
        }

        let index = index - self.static_accounts.len();
        if index < self.loaded_writable_accounts.len() {
            return Ok(self.loaded_writable_accounts[index]);
        }

        let index = index - self.loaded_writable_accounts.len();
        if index < self.loaded_readonly_accounts.len() {
            return Ok(self.loaded_readonly_accounts[index]);
        }

        Err(ProgramError::InvalidAccountData) //invalid trnasaction message
    }
    /// Returns true if the account at the specified index is a part of static `account_keys` and was requested to be writable.
    pub fn is_static_writable_index(&self, key_index: usize) -> bool {
        let num_account_keys = u32::from_le_bytes(self.message[3..7].try_into().unwrap()) as usize;
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

        index < self.loaded_writable_accounts.len()
    }
    /// Returns true if the account at the specified index was requested to be a signer.
    pub fn is_signer_index(&self, key_index: usize) -> bool {
        let num_signers = self.message[0];
        key_index < usize::from(num_signers)
    }
}

pub struct AddressLookupTable<'a> {
    pub meta: LookupTableMeta,
    pub addresses: &'a [Pubkey],
}
#[repr(C, packed)]
#[derive(Clone, Copy, Debug, PartialEq, bytemuck::Pod, bytemuck::Zeroable)]
pub struct LookupTableMeta {
    pub deactivation_slot: u64,
    pub last_extended_slot: u64,
    pub last_extended_slot_start_index: u8,
    pub is_some_auth: u8,
    pub authority: Pubkey,
    pub _padding: u16,
}
pub fn deserialize_lookup(data: &[u8]) -> Result<AddressLookupTable, ProgramError> {
    if data
        .get(0)
        .copied()
        .ok_or(ProgramError::InvalidAccountData)?
        == 0
    {
        sol_log("uninitialized lookup table");
        return Err(ProgramError::InvalidAccountData);
    }

    let meta_start = 1;
    let meta_end = meta_start + LOOKUP_TABLE_META_SIZE;
    let meta: &LookupTableMeta = bytemuck::from_bytes(
        data.get(meta_start..meta_end)
            .ok_or(ProgramError::InvalidAccountData)?,
    );

    let raw_addresses_data = data
        .get(meta_end..)
        .ok_or(ProgramError::InvalidAccountData)?;
    let addresses: &[Pubkey] = bytemuck::try_cast_slice(raw_addresses_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;

    Ok(AddressLookupTable {
        meta: *meta, // copy meta
        addresses,   // borrowed slice
    })
}
