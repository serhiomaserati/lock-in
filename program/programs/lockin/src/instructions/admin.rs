use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{constants::*, error::LockinError, program::Lockin, state::*};

fn check_limits(min_amount: u64, max_amount: u64) -> Result<()> {
    require!(min_amount >= 1 && max_amount >= min_amount, LockinError::InvalidLimits);
    Ok(())
}

/// One-time setup. Only the program's upgrade authority can become the first admin,
/// so nobody can front-run the deploy and take the config.
#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(token::mint = mint, token::token_program = token_program)]
    pub forfeit_to: InterfaceAccount<'info, TokenAccount>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()))]
    pub program: Program<'info, Lockin>,
    #[account(constraint = program_data.upgrade_authority_address == Some(admin.key()) @ LockinError::NotAdmin)]
    pub program_data: Account<'info, ProgramData>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle_init_config(ctx: Context<InitConfig>, min_amount: u64, max_amount: u64) -> Result<()> {
    check_limits(min_amount, max_amount)?;
    ctx.accounts.config.set_inner(Config {
        admin: ctx.accounts.admin.key(),
        pending_admin: Pubkey::default(),
        mint: ctx.accounts.mint.key(),
        forfeit_to: ctx.accounts.forfeit_to.key(),
        min_amount,
        max_amount,
        paused_new: false,
        safe_mode: false,
        safe_periods: Vec::new(),
        bump: ctx.bumps.config,
    });
    Ok(())
}

/// Token, forfeit recipient and amount limits for pledges created from now on.
#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ LockinError::NotAdmin)]
    pub config: Account<'info, Config>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(token::mint = mint, token::token_program = token_program)]
    pub forfeit_to: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_update_config(ctx: Context<UpdateConfig>, min_amount: u64, max_amount: u64) -> Result<()> {
    check_limits(min_amount, max_amount)?;
    let config = &mut ctx.accounts.config;
    config.mint = ctx.accounts.mint.key();
    config.forfeit_to = ctx.accounts.forfeit_to.key();
    config.min_amount = min_amount;
    config.max_amount = max_amount;
    Ok(())
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ LockinError::NotAdmin)]
    pub config: Account<'info, Config>,
}

/// Step one of an admin handover (e.g. to a multisig). Pass the default key to cancel.
pub fn handle_transfer_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
    ctx.accounts.config.pending_admin = new_admin;
    Ok(())
}

pub fn handle_set_paused_new(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
    ctx.accounts.config.paused_new = paused;
    Ok(())
}

/// Turning safe mode on or off records a period; pledges that were open during it get
/// their `close_at` pushed back by its length (see `Pledge::effective_close_at`).
pub fn handle_set_safe_mode(ctx: Context<AdminOnly>, on: bool) -> Result<()> {
    let config = &mut ctx.accounts.config;
    if config.safe_mode == on {
        return Ok(());
    }
    let now = Clock::get()?.unix_timestamp;
    if on {
        require!(config.safe_periods.len() < MAX_SAFE_PERIODS, LockinError::TooManySafePeriods);
        config.safe_periods.push(SafePeriod { start: now, end: 0 });
    } else if let Some(last) = config.safe_periods.last_mut() {
        // `end == 0` means "ongoing", so a zero-length period still ends one second later.
        last.end = now.max(last.start + 1);
    }
    config.safe_mode = on;
    Ok(())
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub new_admin: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.pending_admin == new_admin.key() @ LockinError::NotPendingAdmin,
    )]
    pub config: Account<'info, Config>,
}

pub fn handle_accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.new_admin.key();
    config.pending_admin = Pubkey::default();
    Ok(())
}
