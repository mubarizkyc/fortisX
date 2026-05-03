use pinocchio::pubkey::Pubkey;
pub const MULTISIG_HEADER_SIZE: usize = 139; // 32+32+32+32+8+2+1

#[repr(C)]
#[derive(Clone, Debug, PartialEq)]
pub struct Multisig {
    pub create_key: Pubkey,               // 32
    pub rent_collector: Pubkey,           // 32
    pub treasury_utxo_pubkey: [u8; 32],   // 32
    pub latest_utxo_commitment: [u8; 32], // 32
    pub transaction_index: u64,           // 8
    pub threshold: u16,                   // 2
    pub bump: u8,                         // 1
                                          // total: 139
                                          //vec<Pubkey> members; //4 + 32 * members_len
                                          //vec<Share> shares; // 4 + 96 * shares_len
}

impl Multisig {
    pub fn from_account(data: &[u8]) -> &Self {
        unsafe { &*(data.as_ptr() as *const Multisig) }
    }

    pub fn from_account_mut(data: &mut [u8]) -> &mut Self {
        unsafe { &mut *(data.as_mut_ptr() as *mut Multisig) }
    }

    pub fn is_member(&self, members_len: u16, member: Pubkey, members: &[u8]) -> bool {
        for i in 0..members_len as usize {
            if member.eq(&members[(i * 32)..(i * 32) + 32]) {
                return true;
            }
        }
        false
    }

    pub fn members_len(data: &[u8]) -> usize {
        u32::from_le_bytes(
            data[MULTISIG_HEADER_SIZE..MULTISIG_HEADER_SIZE + 4]
                .try_into()
                .unwrap(),
        ) as usize
    }
}
