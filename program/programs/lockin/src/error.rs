use anchor_lang::prelude::*;

#[error_code]
pub enum LockinError {
    #[msg("Only the admin can do this")]
    NotAdmin,
    #[msg("Only the pending admin can accept")]
    NotPendingAdmin,
    #[msg("New pledges are paused")]
    NewPledgesPaused,
    #[msg("Not allowed while safe mode is on")]
    SafeModeOn,
    #[msg("Only allowed in safe mode")]
    SafeModeOff,
    #[msg("Too many safe-mode periods recorded")]
    TooManySafePeriods,
    #[msg("Deposit amount is outside the allowed range")]
    AmountOutOfRange,
    #[msg("Invalid amount limits")]
    InvalidLimits,
    #[msg("Goal length must be 1..=60 days")]
    InvalidDays,
    #[msg("Day bounds must have days + 2 entries")]
    BoundsLength,
    #[msg("The first day must start within the next 48 hours")]
    BadStart,
    #[msg("Each day must be 22 to 26 hours long")]
    BadDayLength,
    #[msg("Timezone name too long")]
    TzTooLong,
    #[msg("Steps goals need a daily target")]
    BadStepsTarget,
    #[msg("Invalid device key")]
    BadDeviceKey,
    #[msg("Pledge is not active")]
    NotActive,
    #[msg("Pledge is still active")]
    StillActive,
    #[msg("Signer may not check in for this pledge")]
    NotCheckInSigner,
    #[msg("Day index outside the pledge window")]
    DayOutOfRange,
    #[msg("This day has not started yet")]
    DayNotStarted,
    #[msg("Check-in window is closed")]
    CheckInClosed,
    #[msg("Too early to settle a missed goal")]
    TooEarlyToForfeit,
    #[msg("Missing the account this payout goes to")]
    MissingPayoutAccount,
    #[msg("Signer may not refund this pledge")]
    NotRefundSigner,
    #[msg("Arithmetic overflow")]
    Overflow,
}
