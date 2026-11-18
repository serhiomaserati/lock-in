use anchor_lang::prelude::*;

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";
#[constant]
pub const PLEDGE_SEED: &[u8] = b"pledge";
#[constant]
pub const VAULT_SEED: &[u8] = b"vault";

/// Longest goal, in required days. The window is days + 1 calendar days, one bit each in `Pledge::checked`.
pub const MAX_DAYS: u8 = 60;

/// A calendar day is 23 or 25 hours around a DST switch; allow some slack for odd zones.
pub const MIN_DAY_SECS: i64 = 22 * 3600;
pub const MAX_DAY_SECS: i64 = 26 * 3600;

/// The first day must start in the future, but no later than this from now.
pub const MAX_START_DELAY_SECS: i64 = 48 * 3600;

/// Check-ins for past days are accepted until the end of the last day plus this (`close_at`).
pub const CLOSE_GRACE_SECS: i64 = 24 * 3600;

/// IANA zone name, display only ("America/Argentina/ComodRivadavia" is 32).
pub const MAX_TZ_LEN: usize = 48;

/// Safe-mode periods kept in the config to extend `close_at` of pledges they overlapped.
pub const MAX_SAFE_PERIODS: usize = 16;
