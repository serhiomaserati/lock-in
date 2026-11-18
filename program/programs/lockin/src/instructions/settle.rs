use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::{constants::*, error::LockinError, state::*};

/// Sends everything in the vault to `to`, then closes the vault and returns its rent to the owner.
fn pay_out_and_close<'info>(
    pledge: &Account<'info, Pledge>,
    vault: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    to: &InterfaceAccount<'info, TokenAccount>,
    owner: &AccountInfo<'info>,
    token_program: &Interface<'info, TokenInterface>,
) -> Result<()> {
    let id = pledge.id.to_le_bytes();
    let bump = [pledge.bump];
    let seeds: &[&[u8]] = &[PLEDGE_SEED, pledge.owner.as_ref(), &id, &bump];
    let signer = &[seeds];

    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            TransferChecked {
                from: vault.to_account_info(),
                mint: mint.to_account_info(),
                to: to.to_account_info(),
                authority: pledge.to_account_info(),
            },
            signer,
        ),
        vault.amount,
        mint.decimals,
    )?;
    token_interface::close_account(CpiContext::new_with_signer(
        token_program.key(),
        CloseAccount {
            account: vault.to_account_info(),
            destination: owner.clone(),
            authority: pledge.to_account_info(),
        },
        signer,
    ))
}

/// Pays a pledge out by its rules. Anyone can call it, so a deposit never depends on our app:
/// goal met → back to the owner (any time); goal missed → to `forfeit_to`, only from the
/// effective `close_at` on and never in safe mode.
#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, has_one = owner, has_one = mint)]
    pub pledge: Account<'info, Pledge>,
    /// CHECK: the pledge owner (`has_one`); receives the vault rent.
    #[account(mut)]
    pub owner: UncheckedAccount<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, seeds = [VAULT_SEED, pledge.key().as_ref()], bump = pledge.vault_bump)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    /// Needed when the goal is met.
    #[account(mut, token::mint = mint, token::authority = owner, token::token_program = token_program)]
    pub owner_token: Option<InterfaceAccount<'info, TokenAccount>>,
    /// Needed when the goal is missed.
    #[account(mut, address = pledge.forfeit_to)]
    pub forfeit_to: Option<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_settle(ctx: Context<Settle>) -> Result<()> {
    let a = &ctx.accounts;
    require!(a.pledge.status == PledgeStatus::Active, LockinError::NotActive);
    let now = Clock::get()?.unix_timestamp;

    let (to, status) = if a.pledge.is_met() {
        (a.owner_token.as_ref(), PledgeStatus::Returned)
    } else {
        require!(!a.config.safe_mode, LockinError::SafeModeOn);
        require!(now >= a.pledge.effective_close_at(&a.config, now), LockinError::TooEarlyToForfeit);
        (a.forfeit_to.as_ref(), PledgeStatus::Forfeited)
    };
    let to = to.ok_or(LockinError::MissingPayoutAccount)?;
    pay_out_and_close(&a.pledge, &a.vault, &a.mint, to, &a.owner.to_account_info(), &a.token_program)?;

    let pledge = &mut ctx.accounts.pledge;
    pledge.status = status;
    pledge.settled_at = now;
    Ok(())
}

/// Safe mode only: the owner (or the admin on their behalf) takes the deposit back from any
/// unsettled pledge. The money can only go to the owner.
#[derive(Accounts)]
pub struct RefundInSafeMode<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        has_one = owner,
        has_one = mint,
        constraint = authority.key() == pledge.owner || authority.key() == config.admin @ LockinError::NotRefundSigner,
    )]
    pub pledge: Account<'info, Pledge>,
    /// CHECK: the pledge owner (`has_one`); receives the vault rent.
    #[account(mut)]
    pub owner: UncheckedAccount<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, seeds = [VAULT_SEED, pledge.key().as_ref()], bump = pledge.vault_bump)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = owner, token::token_program = token_program)]
    pub owner_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_refund_in_safe_mode(ctx: Context<RefundInSafeMode>) -> Result<()> {
    let a = &ctx.accounts;
    require!(a.config.safe_mode, LockinError::SafeModeOff);
    require!(a.pledge.status == PledgeStatus::Active, LockinError::NotActive);
    pay_out_and_close(&a.pledge, &a.vault, &a.mint, &a.owner_token, &a.owner.to_account_info(), &a.token_program)?;

    let pledge = &mut ctx.accounts.pledge;
    pledge.status = PledgeStatus::Refunded;
    pledge.settled_at = Clock::get()?.unix_timestamp;
    Ok(())
}

/// Deletes a settled pledge (history) and returns its rent to the owner.
#[derive(Accounts)]
pub struct ClosePledge<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        has_one = owner,
        close = owner,
        constraint = pledge.status != PledgeStatus::Active @ LockinError::StillActive,
    )]
    pub pledge: Account<'info, Pledge>,
}

pub fn handle_close_pledge(_ctx: Context<ClosePledge>) -> Result<()> {
    Ok(())
}
