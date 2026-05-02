use pinocchio::pubkey::Pubkey;
/*
//A proposal can be in one of the following states
ProposalStatus {
    /// Proposal is live and ready for voting.
    Active, (Note:this status does not mean ,you can vote when its marked as active and dealine has passed )
    /// Proposal has been approved and is pending execution.
    Approved,
    /// Proposal has been executed.
    Executed,
}
*/
//Proposal : Header + approved:[Pubkey]
#[repr(C)]
#[derive(Clone, Copy, PartialEq)]
pub struct ProposalHeader {
    /// The multisig this belongs to.
    pub multisig: Pubkey,
    /// Index of the multisig transaction this proposal is associated with.
    pub transaction_index: u64,
    //last updated timestamp
    pub timestamp: i64,
    //deadline for voting
    pub deadline: i64,
    /// The status of the transaction.
    pub status: u8,
    /// proposal_type
    pub proposal_type: u8, //0 for public ,1 for private
    /// PDA bump.
    pub bump: u8,
}
#[repr(C)]
#[derive(Clone, Copy, PartialEq)]
pub struct PrivateTransferTransaction {
    pub target: Pubkey,
    pub amount: u64,
}
