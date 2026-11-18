use anchor_lang::prelude::*;

use crate::constants::*;

/// Global settings. They apply to pledges created after a change; every pledge keeps its own snapshot.
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    /// Set by `transfer_admin`, takes over on `accept_admin`. Default = none pending.
    pub pending_admin: Pubkey,
    /// Token accepted for new pledges.
    pub mint: Pubkey,
    /// Token account that receives forfeited deposits of new pledges.
    pub forfeit_to: Pubkey,
    pub min_amount: u64,
    pub max_amount: u64,
    pub paused_new: bool,
    /// Emergency switch: forfeits are blocked, refunds to owners are allowed.
    pub safe_mode: bool,
    /// Every safe-mode period so far (`end == 0` while it is on), oldest first.
    #[max_len(MAX_SAFE_PERIODS)]
    pub safe_periods: Vec<SafePeriod>,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct SafePeriod {
    pub start: i64,
    pub end: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum ProofKind {
    /// Honor system: the owner (or their device) marks the day.
    SelfReport,
    /// The app marks the day when Health Connect shows `steps_per_day`. The contract can't see steps.
    Steps,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum PledgeStatus {
    Active,
    /// Goal met, deposit back to the owner.
    Returned,
    /// Goal missed, deposit sent to `forfeit_to`.
    Forfeited,
    /// Deposit back to the owner in safe mode.
    Refunded,
}

/// One goal with its deposit. Settled pledges are kept as history until the owner closes them.
#[account]
pub struct Pledge {
    /// First field, so the app can find a wallet's pledges with a memcmp at offset 8.
    pub owner: Pubkey,
    pub id: u64,
    pub version: u8,
    pub mint: Pubkey,
    /// Amount that landed in the vault at creation.
    pub amount: u64,
    pub forfeit_to: Pubkey,
    /// Key the app holds to check in without a wallet prompt. It can't move the deposit.
    pub device_key: Pubkey,
    pub proof: ProofKind,
    pub steps_per_day: u32,
    /// Required days (N). The window has N + 1 calendar days.
    pub days: u8,
    /// Bit i set = calendar day i of the window was hit.
    pub checked: u64,
    pub created_at: i64,
    /// End of the last day + 24h, before safe-mode extensions. Check-ins stop and forfeits start here.
    pub close_at: i64,
    pub status: PledgeStatus,
    pub settled_at: i64,
    pub bump: u8,
    pub vault_bump: u8,
    /// UTC start of every window day plus the end of the last one (days + 2 values, seconds).
    pub bounds: Vec<i64>,
    /// Device timezone at creation, display only.
    pub tz_name: String,
}

impl Pledge {
    pub const FIXED_SPACE: usize = 8 // discriminator
        + 32 + 8 + 1 // owner, id, version
        + 32 + 8 + 32 + 32 // mint, amount, forfeit_to, device_key
        + 1 + 4 + 1 + 8 // proof, steps_per_day, days, checked
        + 8 + 8 + 1 + 8 // created_at, close_at, status, settled_at
        + 1 + 1 // bumps
        + 4 // bounds length prefix
        + 4; // tz_name length prefix

    pub fn space(days: u8, tz_len: usize) -> usize {
        Self::FIXED_SPACE + 8 * (days as usize + 2) + tz_len
    }

    pub fn hits(&self) -> u32 {
        self.checked.count_ones()
    }

    pub fn is_met(&self) -> bool {
        self.hits() >= self.days as u32
    }

    /// `close_at` pushed back by every safe-mode period that began while the pledge was still open,
    /// so an outage on our side can't eat the check-in window. An ongoing period counts up to `now`.
    pub fn effective_close_at(&self, config: &Config, now: i64) -> i64 {
        let mut close = self.close_at;
        for p in &config.safe_periods {
            let end = if p.end == 0 { now.max(p.start) } else { p.end };
            if p.start < close && end > self.created_at {
                close = close.saturating_add(end - p.start.max(self.created_at));
            }
        }
        close
    }
}
