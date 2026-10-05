//! Error codes (contracts sec 2.9). 6000-6012 keep the spike's numbers that research 28 cites.
use pinocchio::error::ProgramError;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum LeashError {
    NotTopLevel = 6000,
    BadPda = 6001,
    BadProgram = 6002,
    BadMint = 6003,
    ReceiptNotUsers = 6004,
    MissingSettle = 6005,
    ExtraLeashIx = 6006,
    SettleMismatch = 6007,
    BelowFloor = 6008,
    Underdelivered = 6009,
    BadData = 6010,
    NotPuller = 6011,
    BadReceiver = 6012,
    BadConfig = 6013,
    NotAdmin = 6014,
    LegDisabled = 6015,
    BadReceipt = 6016,
    BadPriceAccount = 6017,
    StalePrice = 6018,
    PriceConfidence = 6019,
    BadReader = 6020,
    Overflow = 6021,
    OverCap = 6022,
    AlreadyInitialized = 6023,
}

impl From<LeashError> for ProgramError {
    fn from(e: LeashError) -> Self {
        ProgramError::Custom(e as u32)
    }
}
