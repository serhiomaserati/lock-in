use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::{constants::*, error::LockinError, state::*};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreatePledgeArgs {
    /// Picked by the app, unique per owner (part of the pledge address).
    pub id: u64,
    pub amount: u64,
    pub days: u8,
    pub proof: ProofKind,
    pub steps_per_day: u32,
    /// UTC start of every window day plus the end of the last one, in seconds (days + 2 values).
    pub bounds: Vec<i64>,
    pub tz_name: String,
    pub device_key: Pubkey,
}

#[derive(Accounts)]
#[instruction(args: CreatePledgeArgs)]
pub struct CreatePledge<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = owner,
        space = Pledge::space(args.days, args.tz_name.len()),
        seeds = [PLEDGE_SEED, owner.key().as_ref(), &args.id.to_le_bytes()],
        bump,
    )]
    pub pledge: Account<'info, Pledge>,
    #[account(address = config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = owner,
        seeds = [VAULT_SEED, pledge.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = pledge,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = owner, token::token_program = token_program)]
    pub owner_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

fn check_bounds(bounds: &[i64], days: u8, now: i64) -> Result<()> {
    require!(bounds.len() == days as usize + 2, LockinError::BoundsLength);
    let delay = bounds[0].checked_sub(now).ok_or(LockinError::Overflow)?;
    require!(delay > 0 && delay <= MAX_START_DELAY_SECS, LockinError::BadStart);
    for w in bounds.windows(2) {
        let len = w[1].checked_sub(w[0]).ok_or(LockinError::Overflow)?;
        require!((MIN_DAY_SECS..=MAX_DAY_SECS).contains(&len), LockinError::BadDayLength);
    }
    Ok(())
}

pub fn handle_create_pledge(ctx: Context<CreatePledge>, args: CreatePledgeArgs) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(!config.paused_new, LockinError::NewPledgesPaused);
    require!(!config.safe_mode, LockinError::SafeModeOn);
    require!(
        (config.min_amount..=config.max_amount).contains(&args.amount),
        LockinError::AmountOutOfRange
    );
    require!((1..=MAX_DAYS).contains(&args.days), LockinError::InvalidDays);
    require!(args.tz_name.len() <= MAX_TZ_LEN, LockinError::TzTooLong);
    require!(args.device_key != Pubkey::default(), LockinError::BadDeviceKey);
    match args.proof {
        ProofKind::Steps => require!(args.steps_per_day > 0, LockinError::BadStepsTarget),
        ProofKind::SelfReport => require!(args.steps_per_day == 0, LockinError::BadStepsTarget),
    }
    let now = Clock::get()?.unix_timestamp;
    check_bounds(&args.bounds, args.days, now)?;
    let close_at = args.bounds[args.bounds.len() - 1]
        .checked_add(CLOSE_GRACE_SECS)
        .ok_or(LockinError::Overflow)?;

    let mint = &ctx.accounts.mint;
    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.owner_token.to_account_info(),
                mint: mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        args.amount,
        mint.decimals,
    )?;
    // Record what actually arrived (a mint with a transfer fee delivers less).
    ctx.accounts.vault.reload()?;

    ctx.accounts.pledge.set_inner(Pledge {
        owner: ctx.accounts.owner.key(),
        id: args.id,
        version: 1,
        mint: mint.key(),
        amount: ctx.accounts.vault.amount,
        forfeit_to: config.forfeit_to,
        device_key: args.device_key,
        proof: args.proof,
        steps_per_day: args.steps_per_day,
        days: args.days,
        checked: 0,
        created_at: now,
        close_at,
        status: PledgeStatus::Active,
        settled_at: 0,
        bump: ctx.bumps.pledge,
        vault_bump: ctx.bumps.vault,
        bounds: args.bounds,
        tz_name: args.tz_name,
    });
    Ok(())
}
