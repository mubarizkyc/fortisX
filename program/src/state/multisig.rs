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
}

impl Multisig {
    pub fn from_account(data: &[u8]) -> &Self {
        unsafe { &*(data.as_ptr() as *const Multisig) }
    }

    pub fn from_account_mut(data: &mut [u8]) -> &mut Self {
        unsafe { &mut *(data.as_mut_ptr() as *mut Multisig) }
    }

    // reads members from the dynamic tail after header
    pub fn is_member(&self, data: &[u8], member: &Pubkey) -> bool {
        let members_len = u32::from_le_bytes(
            data[MULTISIG_HEADER_SIZE..MULTISIG_HEADER_SIZE + 4]
                .try_into()
                .unwrap(),
        ) as usize;

        let members_start = MULTISIG_HEADER_SIZE + 4;
        for i in 0..members_len {
            let start = members_start + i * 32;
            let pk = Pubkey::from(TryInto::<[u8; 32]>::try_into(&data[start..start + 32]).unwrap());
            if pk == *member {
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

    // returns byte slice of a member's encrypted share ciphertext
    // share layout: 32 (member pubkey) + 4 (ct len) + 60 (ciphertext)
    pub fn get_member_share<'a>(data: &'a [u8], member: &Pubkey) -> Option<&'a [u8]> {
        const SHARE_SIZE: usize = 96; // 32 + 4 + 60
        let members_len = Self::members_len(data);
        let shares_start = MULTISIG_HEADER_SIZE + 4 + 32 * members_len;
        let shares_len =
            u32::from_le_bytes(data[shares_start..shares_start + 4].try_into().unwrap()) as usize;

        let mut cur = shares_start + 4;
        for _ in 0..shares_len {
            let pk = Pubkey::from(TryInto::<[u8; 32]>::try_into(&data[cur..cur + 32]).unwrap());
            let ct_len = u32::from_le_bytes(data[cur + 32..cur + 36].try_into().unwrap()) as usize;
            if pk == *member {
                return Some(&data[cur + 36..cur + 36 + ct_len]);
            }
            cur += 32 + 4 + ct_len;
        }
        None
    }
}
