//! Lock-In: a deposit locked on a personal goal.
//! Hit the goal on `days` of the `days + 1` window days → the deposit goes back to the owner.
//! Miss it → after `close_at` the deposit goes to the recipient fixed at creation.
//! Payouts never exceed the deposit, and nobody (admin included) can send it anywhere else.
//! See ARCHITECTURE.md in the project root.

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("6za6iZpEP96dN76pGYj27JmqzMgkRQ3JT3SnvrsZbHbv");

#[program]
pub mod lockin {
    use super::*;

    pub fn init_config(ctx: Context<InitConfig>, min_amount: u64, max_amount: u64) -> Result<()> {
        admin::handle_init_config(ctx, min_amount, max_amount)
    }

    pub fn update_config(ctx: Context<UpdateConfig>, min_amount: u64, max_amount: u64) -> Result<()> {
        admin::handle_update_config(ctx, min_amount, max_amount)
    }

    pub fn transfer_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        admin::handle_transfer_admin(ctx, new_admin)
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        admin::handle_accept_admin(ctx)
    }

    pub fn set_paused_new(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        admin::handle_set_paused_new(ctx, paused)
    }

    pub fn set_safe_mode(ctx: Context<AdminOnly>, on: bool) -> Result<()> {
        admin::handle_set_safe_mode(ctx, on)
    }

    pub fn create_pledge(ctx: Context<CreatePledge>, args: CreatePledgeArgs) -> Result<()> {
        create_pledge::handle_create_pledge(ctx, args)
    }

    pub fn check_in(ctx: Context<CheckIn>, day: u8) -> Result<()> {
        check_in::handle_check_in(ctx, day)
    }

    pub fn set_device_key(ctx: Context<SetDeviceKey>, device_key: Pubkey) -> Result<()> {
        check_in::handle_set_device_key(ctx, device_key)
    }

    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        settle::handle_settle(ctx)
    }

    pub fn refund_in_safe_mode(ctx: Context<RefundInSafeMode>) -> Result<()> {
        settle::handle_refund_in_safe_mode(ctx)
    }

    pub fn close_pledge(ctx: Context<ClosePledge>) -> Result<()> {
        settle::handle_close_pledge(ctx)
    }
}
