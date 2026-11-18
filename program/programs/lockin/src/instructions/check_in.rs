use anchor_lang::prelude::*;

use crate::{constants::*, error::LockinError, state::*};

/// Marks one window day as hit. The device key or the owner can sign; the contract trusts
/// the app's verdict (it can't see steps). Re-marking a day is a no-op.
#[derive(Accounts)]
pub struct CheckIn<'info> {
    pub signer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        constraint = signer.key() == pledge.device_key || signer.key() == pledge.owner @ LockinError::NotCheckInSigner,
    )]
    pub pledge: Account<'info, Pledge>,
}

pub fn handle_check_in(ctx: Context<CheckIn>, day: u8) -> Result<()> {
    let pledge = &mut ctx.accounts.pledge;
    require!(pledge.status == PledgeStatus::Active, LockinError::NotActive);
    // The window has days + 1 calendar days: indexes 0..=days.
    require!(day <= pledge.days, LockinError::DayOutOfRange);
    let now = Clock::get()?.unix_timestamp;
    require!(now >= pledge.bounds[day as usize], LockinError::DayNotStarted);
    require!(now < pledge.effective_close_at(&ctx.accounts.config, now), LockinError::CheckInClosed);
    pledge.checked |= 1u64 << day;
    Ok(())
}

/// Replaces the device key (new phone, reinstall). The old key stops working at once.
#[derive(Accounts)]
pub struct SetDeviceKey<'info> {
    pub owner: Signer<'info>,
    #[account(mut, has_one = owner)]
    pub pledge: Account<'info, Pledge>,
}

pub fn handle_set_device_key(ctx: Context<SetDeviceKey>, device_key: Pubkey) -> Result<()> {
    let pledge = &mut ctx.accounts.pledge;
    require!(pledge.status == PledgeStatus::Active, LockinError::NotActive);
    require!(device_key != Pubkey::default(), LockinError::BadDeviceKey);
    pledge.device_key = device_key;
    Ok(())
}
