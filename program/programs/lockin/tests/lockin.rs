//! Lock-In program tests (LiteSVM, clock moved by hand).
//! The "must" list from ARCHITECTURE.md §8 is marked with [§8].

mod common;

use anchor_lang::error::ErrorCode as AnchorError;
use anchor_lang::InstructionData;
use common::*;
use lockin::{
    error::LockinError as E,
    state::{PledgeStatus, ProofKind},
};
use solana_address::Address;
use solana_keypair::Keypair;
use solana_signer::Signer;

// ---------------------------------------------------------------- happy paths

#[test]
fn goal_met_returns_the_deposit_exactly_once() {
    let mut env = Env::new();
    let u = env.user();
    let start_balance = env.balance(&u.ata);
    let p = env.create(&u, 1, 3);

    assert_eq!(env.balance(&u.ata), start_balance - DEPOSIT);
    assert_eq!(env.balance(&p.vault), DEPOSIT);
    let pl = env.pledge(&p);
    assert_eq!(pl.owner, u.key());
    assert_eq!(pl.amount, DEPOSIT);
    assert_eq!(pl.forfeit_to, env.treasury);
    assert_eq!(pl.status, PledgeStatus::Active);
    assert_eq!(pl.bounds.len(), 5);
    assert_eq!(pl.close_at, pl.bounds[4] + DAY);
    assert_eq!(pl.tz_name, "Europe/Kyiv");

    // Days 0, 1 and 3 hit (day 2 is the spare), signed by the device key.
    let b = pl.bounds.clone();
    for day in [0u8, 1, 3] {
        env.set_time(b[day as usize] + HOUR);
        env.check_in(&p, &u.device, day).unwrap();
    }
    assert_eq!(env.pledge(&p).hits(), 3);

    // Met → can be settled right away, before close_at.
    let rent_before = env.lamports(&u.key());
    env.settle(&p, u.ata).unwrap();
    assert_eq!(env.balance(&u.ata), start_balance);
    assert!(!env.exists(&p.vault), "vault closed");
    assert!(env.lamports(&u.key()) > rent_before, "vault rent back to the owner");
    let pl = env.pledge(&p);
    assert_eq!(pl.status, PledgeStatus::Returned);
    assert_eq!(pl.settled_at, env.now());

    // [§8] no second payout
    assert!(env.settle(&p, u.ata).is_err());
    assert_eq!(env.balance(&u.ata), start_balance);
    assert_eq!(env.pledge(&p).status, PledgeStatus::Returned);
}

#[test]
fn goal_missed_forfeits_to_the_recorded_recipient_after_close_at() {
    let mut env = Env::new();
    let u = env.user();
    let p = env.create(&u, 1, 3);
    let pl = env.pledge(&p);
    env.set_time(pl.bounds[0] + HOUR);
    env.check_in(&p, &u.device, 0).unwrap();

    // [§8] no loss before close_at
    env.set_time(pl.close_at - 1);
    assert_eq!(code(env.settle(&p, u.ata)), lockin_err(E::TooEarlyToForfeit));

    env.set_time(pl.close_at);
    env.settle(&p, u.ata).unwrap();
    assert_eq!(env.balance(&env.treasury.clone()), DEPOSIT);
    assert_eq!(env.pledge(&p).status, PledgeStatus::Forfeited);
    assert!(!env.exists(&p.vault));
    assert!(env.settle(&p, u.ata).is_err(), "no second payout");
}

#[test]
fn check_in_is_idempotent_and_owner_can_check_in() {
    let mut env = Env::new();
    let u = env.user();
    let p = env.create(&u, 7, 2);
    let b = env.pledge(&p).bounds;
    env.set_time(b[0] + HOUR);
    env.check_in(&p, &u.device, 0).unwrap();
    env.check_in(&p, &u.device, 0).unwrap();
    env.check_in(&p, &u.kp, 0).unwrap();
    assert_eq!(env.pledge(&p).hits(), 1);
    env.set_time(b[1] + HOUR);
    env.check_in(&p, &u.kp, 1).unwrap();
    assert!(env.pledge(&p).is_met());
}

#[test]
fn late_check_ins_for_past_days_count_until_close_at() {
    let mut env = Env::new();
    let u = env.user();
    let p = env.create(&u, 1, 3);
    let pl = env.pledge(&p);

    // Offline for the whole challenge; data syncs after the last day ended.
    env.set_time(pl.bounds[4] + 2 * HOUR);
    for day in 0..3 {
        env.check_in(&p, &u.device, day).unwrap();
    }
    env.settle(&p, u.ata).unwrap();
    assert_eq!(env.pledge(&p).status, PledgeStatus::Returned);
}

// ---------------------------------------------------------------- calendar [§8]

#[test]
fn no_future_day_and_nothing_after_close_at() {
    let mut env = Env::new();
    let u = env.user();
    let p = env.create(&u, 1, 3);
    let pl = env.pledge(&p);

    // Before the challenge starts.
    assert_eq!(code(env.check_in(&p, &u.device, 0)), lockin_err(E::DayNotStarted));
    // During day 0: day 1 is still in the future.
    env.set_time(pl.bounds[0]);
    env.check_in(&p, &u.device, 0).unwrap();
    assert_eq!(code(env.check_in(&p, &u.device, 1)), lockin_err(E::DayNotStarted));
    env.set_time(pl.bounds[1] - 1);
    assert_eq!(code(env.check_in(&p, &u.device, 1)), lockin_err(E::DayNotStarted));
    // Past the window (days 0..=3 exist for a 3-day goal).
    assert_eq!(code(env.check_in(&p, &u.device, 4)), lockin_err(E::DayOutOfRange));
    assert_eq!(code(env.check_in(&p, &u.device, 200)), lockin_err(E::DayOutOfRange));

    env.set_time(pl.close_at - 1);
    env.check_in(&p, &u.device, 1).unwrap();
    env.set_time(pl.close_at);
    assert_eq!(code(env.check_in(&p, &u.device, 2)), lockin_err(E::CheckInClosed));
    assert_eq!(code(env.check_in(&p, &u.kp, 2)), lockin_err(E::CheckInClosed));
}

#[test]
fn bad_day_bounds_are_rejected() {
    let mut env = Env::new();
    let u = env.user();
    let now = env.now();
    let mut id = 0;
    let mut try_bounds = |env: &mut Env, b: Vec<i64>, days: u8| {
        id += 1;
        let mut args = env.args(&u, id, days);
        args.bounds = b;
        env.create_with(&u, args).map(|_| ())
    };

    // wrong length
    assert_eq!(code(try_bounds(&mut env, bounds(now + HOUR, 4, DAY), 3)), lockin_err(E::BoundsLength));
    assert_eq!(code(try_bounds(&mut env, bounds(now + HOUR, 2, DAY), 3)), lockin_err(E::BoundsLength));
    // start: in the past, right now, beyond 48h
    assert_eq!(code(try_bounds(&mut env, bounds(now - 1, 3, DAY), 3)), lockin_err(E::BadStart));
    assert_eq!(code(try_bounds(&mut env, bounds(now, 3, DAY), 3)), lockin_err(E::BadStart));
    assert_eq!(code(try_bounds(&mut env, bounds(now + 48 * HOUR + 1, 3, DAY), 3)), lockin_err(E::BadStart));
    // day length: too short, too long, not increasing, one bad day in the middle
    assert_eq!(code(try_bounds(&mut env, bounds(now + HOUR, 3, 22 * HOUR - 1), 3)), lockin_err(E::BadDayLength));
    assert_eq!(code(try_bounds(&mut env, bounds(now + HOUR, 3, 26 * HOUR + 1), 3)), lockin_err(E::BadDayLength));
    assert_eq!(code(try_bounds(&mut env, bounds(now + HOUR, 3, -DAY), 3)), lockin_err(E::BadDayLength));
    let mut b = bounds(now + HOUR, 3, DAY);
    b[2] = b[1] + HOUR;
    assert_eq!(code(try_bounds(&mut env, b, 3)), lockin_err(E::BadDayLength));
    // overflow-shaped garbage fails cleanly
    assert!(try_bounds(&mut env, vec![i64::MIN, 0, i64::MAX, 0, 0], 3).is_err());

    // edges that are fine: start exactly 48h out, 22h and 26h days
    try_bounds(&mut env, bounds(now + 48 * HOUR, 3, DAY), 3).unwrap();
    try_bounds(&mut env, bounds(now + HOUR, 3, 22 * HOUR), 3).unwrap();
    try_bounds(&mut env, bounds(now + HOUR, 3, 26 * HOUR), 3).unwrap();
}

#[test]
fn dst_days_of_23_and_25_hours_are_accepted() {
    let mut env = Env::new();
    let u = env.user();
    // Europe/Kyiv local midnights around 2026-10-25 (clocks go back 04:00 → 03:00):
    // Oct 24 00:00 +03, Oct 25 00:00 +03, Oct 26 00:00 +02 (25h day), Oct 27 00:00 +02.
    let oct24 = 1_792_789_200; // 2026-10-23T21:00:00Z
    let fall = vec![oct24, oct24 + DAY, oct24 + 2 * DAY + HOUR, oct24 + 3 * DAY + HOUR];
    env.set_time(oct24 - 2 * HOUR);
    let mut args = env.args(&u, 1, 2);
    args.bounds = fall;
    env.create_with(&u, args).unwrap();

    // Spring forward: a 23h day.
    let start = env.now() + HOUR;
    let mut args = env.args(&u, 2, 2);
    args.bounds = vec![start, start + 23 * HOUR, start + 47 * HOUR, start + 71 * HOUR];
    env.create_with(&u, args).unwrap();
}

// ---------------------------------------------------------------- nobody else gets the money [§8]

#[test]
fn stranger_cannot_redirect_a_payout() {
    let mut env = Env::new();
    let u = env.user();
    let thief = env.user();
    let p = env.create(&u, 1, 1);
    let b = env.pledge(&p).bounds;
    env.set_time(b[0] + HOUR);
    env.check_in(&p, &u.device, 0).unwrap();
    let treasury = env.treasury;

    // Owner payout into the thief's token account.
    let r = env.settle_raw(&thief.kp, &p, p.owner, p.vault, Some(thief.ata), Some(treasury));
    assert_eq!(code(r), anchor_err(AnchorError::ConstraintTokenOwner));
    // Thief as the "owner" (to grab the vault rent) with their own token account.
    let r = env.settle_raw(&thief.kp, &p, thief.key(), p.vault, Some(thief.ata), Some(treasury));
    assert_eq!(code(r), anchor_err(AnchorError::ConstraintHasOne));
    // Another pledge's vault.
    let other = env.create(&thief, 1, 1);
    let r = env.settle_raw(&thief.kp, &p, p.owner, other.vault, Some(u.ata), Some(treasury));
    assert_eq!(code(r), anchor_err(AnchorError::ConstraintSeeds));

    assert_eq!(env.balance(&p.vault), DEPOSIT);
    // The honest call still works, paid by a stranger.
    env.settle_raw(&thief.kp, &p, p.owner, p.vault, Some(u.ata), None).unwrap();
    assert_eq!(env.balance(&u.ata), 10 * DEPOSIT);
}

#[test]
fn forfeit_recipient_cannot_be_swapped() {
    let mut env = Env::new();
    let u = env.user();
    let thief = env.user();
    let p = env.create(&u, 1, 1);
    let pl = env.pledge(&p);
    env.set_time(pl.close_at);

    let r = env.settle_raw(&thief.kp, &p, p.owner, p.vault, None, Some(thief.ata));
    assert_eq!(code(r), anchor_err(AnchorError::ConstraintAddress));
    // Missing the account the payout needs.
    let r = env.settle_raw(&thief.kp, &p, p.owner, p.vault, Some(u.ata), None);
    assert_eq!(code(r), lockin_err(E::MissingPayoutAccount));

    // Admin moves forfeits of NEW pledges elsewhere; this pledge keeps its snapshot.
    let new_treasury = env.ata_for(&Address::new_unique(), &env.mint.clone());
    let admin = env.admin.insecure_clone();
    let ix = update_config_ix(&env, &admin.pubkey(), env.mint, new_treasury);
    env.send(&[ix], &[&admin]).unwrap();
    let r = env.settle_raw(&thief.kp, &p, p.owner, p.vault, None, Some(new_treasury));
    assert_eq!(code(r), anchor_err(AnchorError::ConstraintAddress));

    let old_treasury = env.treasury;
    env.settle_raw(&thief.kp, &p, p.owner, p.vault, None, Some(old_treasury)).unwrap();
    assert_eq!(env.balance(&old_treasury), DEPOSIT);
    assert_eq!(env.balance(&new_treasury), 0);
}

#[test]
fn only_the_configured_token_and_own_tokens_can_be_locked() {
    let mut env = Env::new();
    let u = env.user();
    let victim = env.user();

    // Another mint.
    let fake_mint = env.new_mint();
    let fake_ata = env.ata_for(&u.key(), &fake_mint);
    env.mint_to(&fake_mint, &fake_ata, DEPOSIT);
    let args = env.args(&u, 1, 3);
    let ix = env.create_ix(&u.key(), &fake_ata, &fake_mint, args);
    assert_eq!(code(env.send(&[ix], &[&u.kp])), anchor_err(AnchorError::ConstraintAddress));

    // Someone else's token account.
    let args = env.args(&u, 2, 3);
    let ix = env.create_ix(&u.key(), &victim.ata, &env.mint.clone(), args);
    assert_eq!(code(env.send(&[ix], &[&u.kp])), anchor_err(AnchorError::ConstraintTokenOwner));
    assert_eq!(env.balance(&victim.ata), 10 * DEPOSIT);
}

#[test]
fn revoked_device_key_stops_working() {
    let mut env = Env::new();
    let u = env.user();
    let p = env.create(&u, 1, 3);
    let b = env.pledge(&p).bounds;
    env.set_time(b[0] + HOUR);
    env.check_in(&p, &u.device, 0).unwrap();

    // The device key can't replace itself; strangers can't check in.
    let stranger = Keypair::new();
    env.svm.airdrop(&stranger.pubkey(), SOL).unwrap();
    assert_eq!(code(env.set_device_key(&p, &u.device, stranger.pubkey())), anchor_err(AnchorError::ConstraintHasOne));
    assert_eq!(code(env.check_in(&p, &stranger, 0)), lockin_err(E::NotCheckInSigner));

    // [§8] new phone: owner sets a new key, the old one is dead at once.
    let new_device = Keypair::new();
    env.svm.airdrop(&new_device.pubkey(), SOL).unwrap();
    env.set_device_key(&p, &u.kp, new_device.pubkey()).unwrap();
    env.set_time(b[1] + HOUR);
    assert_eq!(code(env.check_in(&p, &u.device, 1)), lockin_err(E::NotCheckInSigner));
    env.check_in(&p, &new_device, 1).unwrap();
    assert_eq!(code(env.set_device_key(&p, &u.kp, Address::default())), lockin_err(E::BadDeviceKey));
}

// ---------------------------------------------------------------- safe mode [§8]

#[test]
fn safe_mode_blocks_forfeits_but_not_returns_or_refunds() {
    let mut env = Env::new();
    let u = env.user();
    let met = env.create(&u, 1, 1);
    let missed = env.create(&u, 2, 1);
    let other = env.create(&u, 3, 1);
    let b = env.pledge(&met).bounds;
    env.set_time(b[0] + HOUR);
    env.check_in(&met, &u.device, 0).unwrap();

    env.set_time(env.pledge(&missed).close_at + HOUR);
    env.set_safe_mode(true).unwrap();
    assert!(env.config().safe_mode);

    // No forfeits, and no new pledges.
    assert_eq!(code(env.settle(&missed, u.ata)), lockin_err(E::SafeModeOn));
    let args = env.args(&u, 4, 1);
    assert_eq!(code(env.create_with(&u, args).map(|_| ())), lockin_err(E::SafeModeOn));
    // A met goal still pays out normally.
    env.settle(&met, u.ata).unwrap();
    assert_eq!(env.pledge(&met).status, PledgeStatus::Returned);

    // Refunds: the owner, or the admin on the owner's behalf - always into the owner's account.
    let stranger = env.user();
    assert_eq!(code(env.refund(&stranger.kp, &missed, u.ata)), lockin_err(E::NotRefundSigner));
    let admin = env.admin.insecure_clone();
    let admin_ata = env.ata_for(&admin.pubkey(), &env.mint.clone());
    assert_eq!(code(env.refund(&admin, &missed, admin_ata)), anchor_err(AnchorError::ConstraintTokenOwner));
    env.refund(&admin, &missed, u.ata).unwrap();
    env.refund(&u.kp, &other, u.ata).unwrap();
    assert!(env.refund(&u.kp, &other, u.ata).is_err(), "no second refund");
    assert_eq!(env.pledge(&missed).status, PledgeStatus::Refunded);
    assert_eq!(env.pledge(&other).status, PledgeStatus::Refunded);
    assert_eq!(env.balance(&u.ata), 10 * DEPOSIT);
    assert_eq!(env.balance(&env.treasury.clone()), 0);
}

#[test]
fn refund_needs_safe_mode() {
    let mut env = Env::new();
    let u = env.user();
    let p = env.create(&u, 1, 1);
    assert_eq!(code(env.refund(&u.kp, &p, u.ata)), lockin_err(E::SafeModeOff));
    let admin = env.admin.insecure_clone();
    assert_eq!(code(env.refund(&admin, &p, u.ata)), lockin_err(E::SafeModeOff));
}

#[test]
fn safe_mode_pushes_back_close_at_of_open_pledges_only() {
    let mut env = Env::new();
    let u = env.user();
    // Already past close_at when safe mode starts.
    let closed = env.create(&u, 1, 2);
    env.set_time(env.pledge(&closed).close_at + HOUR);
    // Still open when safe mode starts (2-day goal, so one check-in isn't enough).
    let open = env.create(&u, 2, 2);
    let close = env.pledge(&open).close_at;

    let safe_start = env.now() + 10 * HOUR;
    let ext = 100 * HOUR;
    env.set_time(safe_start);
    env.set_safe_mode(true).unwrap();
    // While on, the window stays open past the original close.
    env.set_time(close + 5 * HOUR);
    env.check_in(&open, &u.device, 0).unwrap();
    env.set_time(safe_start + ext);
    env.set_safe_mode(false).unwrap();
    assert_eq!(env.config().safe_periods.len(), 1);

    // Open pledge: check-ins until close + ext, forfeit from then on.
    env.set_time(close + ext - 1);
    assert_eq!(code(env.settle(&open, u.ata)), lockin_err(E::TooEarlyToForfeit));
    env.set_time(close + ext);
    assert_eq!(code(env.check_in(&open, &u.device, 1)), lockin_err(E::CheckInClosed));
    env.settle(&open, u.ata).unwrap();
    assert_eq!(env.pledge(&open).status, PledgeStatus::Forfeited);

    // Closed before safe mode began: no reopening.
    assert_eq!(code(env.check_in(&closed, &u.device, 0)), lockin_err(E::CheckInClosed));
    env.settle(&closed, u.ata).unwrap();

    // Created after the period: no extension.
    let later = env.create(&u, 3, 2);
    env.set_time(env.pledge(&later).close_at);
    assert_eq!(code(env.check_in(&later, &u.device, 0)), lockin_err(E::CheckInClosed));
    env.settle(&later, u.ata).unwrap();
    assert_eq!(env.balance(&env.treasury.clone()), 3 * DEPOSIT);
}

#[test]
fn safe_mode_toggle_is_admin_only_and_idempotent() {
    let mut env = Env::new();
    let stranger = env.user();
    let ix = env.admin_ix(&stranger.key(), lockin::instruction::SetSafeMode { on: true }.data());
    assert_eq!(code(env.send(&[ix], &[&stranger.kp])), lockin_err(E::NotAdmin));
    env.set_safe_mode(true).unwrap();
    env.set_safe_mode(true).unwrap();
    env.set_safe_mode(false).unwrap();
    env.set_safe_mode(false).unwrap();
    let periods = env.config().safe_periods;
    assert_eq!(periods.len(), 1);
    assert!(periods[0].end > periods[0].start);
}

// ---------------------------------------------------------------- creation rules

#[test]
fn creation_rules() {
    let mut env = Env::new();
    let u = env.user();
    let mut a = env.args(&u, 1, 3);

    a.amount = MIN_AMOUNT - 1;
    assert_eq!(code(env.create_with(&u, a.clone()).map(|_| ())), lockin_err(E::AmountOutOfRange));
    a.amount = MAX_AMOUNT + 1;
    assert_eq!(code(env.create_with(&u, a.clone()).map(|_| ())), lockin_err(E::AmountOutOfRange));
    a.amount = DEPOSIT;

    let mut b = env.args(&u, 1, 0);
    assert_eq!(code(env.create_with(&u, b.clone()).map(|_| ())), lockin_err(E::InvalidDays));
    b = env.args(&u, 1, 61);
    assert_eq!(code(env.create_with(&u, b).map(|_| ())), lockin_err(E::InvalidDays));

    a.proof = ProofKind::Steps;
    assert_eq!(code(env.create_with(&u, a.clone()).map(|_| ())), lockin_err(E::BadStepsTarget));
    a.proof = ProofKind::SelfReport;
    a.steps_per_day = 8000;
    assert_eq!(code(env.create_with(&u, a.clone()).map(|_| ())), lockin_err(E::BadStepsTarget));
    a.steps_per_day = 0;

    let mut t = a.clone();
    t.tz_name = "x".repeat(49);
    assert_eq!(code(env.create_with(&u, t).map(|_| ())), lockin_err(E::TzTooLong));
    let mut d = a.clone();
    d.device_key = Address::default();
    assert_eq!(code(env.create_with(&u, d).map(|_| ())), lockin_err(E::BadDeviceKey));

    env.set_paused_new(true).unwrap();
    assert_eq!(code(env.create_with(&u, a.clone()).map(|_| ())), lockin_err(E::NewPledgesPaused));
    env.set_paused_new(false).unwrap();

    env.create_with(&u, a.clone()).unwrap();
    // Same id twice → same address, already in use.
    assert!(env.create_with(&u, a).is_err());

    let mut s = env.args(&u, 2, 60);
    s.proof = ProofKind::Steps;
    s.steps_per_day = 10_000;
    s.tz_name = "America/Argentina/ComodRivadavia".into();
    let p60 = env.create_with(&u, s).unwrap();
    let pl = env.pledge(&p60);
    assert_eq!((pl.days, pl.proof, pl.steps_per_day, pl.bounds.len()), (60, ProofKind::Steps, 10_000, 62));
    // Last day (index 60) is checkable.
    env.set_time(pl.bounds[60] + 1);
    env.check_in(&p60, &u.device, 60).unwrap();
    assert_eq!(env.pledge(&p60).checked, 1u64 << 60);
}

#[test]
fn settled_pledge_can_be_closed_by_its_owner_only() {
    let mut env = Env::new();
    let u = env.user();
    let p = env.create(&u, 1, 1);
    assert_eq!(code(env.close_pledge(&u.kp, &p)), lockin_err(E::StillActive));
    env.set_time(env.pledge(&p).close_at);
    env.settle(&p, u.ata).unwrap();

    let stranger = env.user();
    assert_eq!(code(env.close_pledge(&stranger.kp, &p)), anchor_err(AnchorError::ConstraintHasOne));
    let before = env.lamports(&u.key());
    env.close_pledge(&u.kp, &p).unwrap();
    assert!(!env.exists(&p.address));
    assert!(env.lamports(&u.key()) > before);
}

// ---------------------------------------------------------------- admin

fn update_config_ix(env: &Env, admin: &Address, mint: Address, forfeit_to: Address) -> solana_instruction::Instruction {
    use anchor_lang::ToAccountMetas;
    solana_instruction::Instruction {
        program_id: lockin::ID,
        accounts: lockin::accounts::UpdateConfig {
            admin: *admin,
            config: config_address(),
            mint,
            forfeit_to,
            token_program: env.token_program,
        }
        .to_account_metas(None),
        data: lockin::instruction::UpdateConfig { min_amount: MIN_AMOUNT, max_amount: MAX_AMOUNT }.data(),
    }
}

#[test]
fn only_the_upgrade_authority_can_init_config_once() {
    let mut env = Env::bare(token_program());
    let stranger = env.user();
    let (mint, treasury) = (env.mint, env.treasury);

    let ix = env.init_config_ix(&stranger.key(), &mint, &treasury);
    assert_eq!(code(env.send(&[ix], &[&stranger.kp])), lockin_err(E::NotAdmin));
    env.set_upgrade_authority(None);
    let admin = env.admin.insecure_clone();
    let ix = env.init_config_ix(&admin.pubkey(), &mint, &treasury);
    assert_eq!(code(env.send(&[ix], &[&admin])), lockin_err(E::NotAdmin));

    env.set_upgrade_authority(Some(admin.pubkey()));
    let ix = env.init_config_ix(&admin.pubkey(), &mint, &treasury);
    env.send(&[ix], &[&admin]).unwrap();
    let c = env.config();
    assert_eq!((c.admin, c.mint, c.forfeit_to), (admin.pubkey(), mint, treasury));

    let ix = env.init_config_ix(&admin.pubkey(), &mint, &treasury);
    assert!(env.send(&[ix], &[&admin]).is_err(), "config exists already");
}

#[test]
fn forfeit_account_must_match_the_mint() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let other_mint = env.new_mint();
    let wrong = env.ata_for(&Address::new_unique(), &other_mint);
    let ix = update_config_ix(&env, &admin.pubkey(), env.mint, wrong);
    assert_eq!(code(env.send(&[ix], &[&admin])), anchor_err(AnchorError::ConstraintTokenMint));
}

#[test]
fn admin_handover_is_two_step() {
    let mut env = Env::new();
    let old = env.admin.insecure_clone();
    let new = env.user();
    let stranger = env.user();

    let ix = env.admin_ix(&stranger.key(), lockin::instruction::TransferAdmin { new_admin: stranger.key() }.data());
    assert_eq!(code(env.send(&[ix], &[&stranger.kp])), lockin_err(E::NotAdmin));
    let ix = env.admin_ix(&old.pubkey(), lockin::instruction::TransferAdmin { new_admin: new.key() }.data());
    env.send(&[ix], &[&old]).unwrap();
    assert_eq!(env.config().admin, old.pubkey(), "nothing changes until accepted");

    let accept = |k: &Keypair| {
        use anchor_lang::ToAccountMetas;
        solana_instruction::Instruction {
            program_id: lockin::ID,
            accounts: lockin::accounts::AcceptAdmin { new_admin: k.pubkey(), config: config_address() }
                .to_account_metas(None),
            data: lockin::instruction::AcceptAdmin {}.data(),
        }
    };
    assert_eq!(code(env.send(&[accept(&stranger.kp)], &[&stranger.kp])), lockin_err(E::NotPendingAdmin));
    env.send(&[accept(&new.kp)], &[&new.kp]).unwrap();
    let c = env.config();
    assert_eq!((c.admin, c.pending_admin), (new.key(), Address::default()));

    let ix = env.admin_ix(&old.pubkey(), lockin::instruction::SetPausedNew { paused: true }.data());
    assert_eq!(code(env.send(&[ix], &[&old])), lockin_err(E::NotAdmin));
    let ix = env.admin_ix(&new.key(), lockin::instruction::SetPausedNew { paused: true }.data());
    env.send(&[ix], &[&new.kp]).unwrap();
}

#[test]
fn update_config_rejects_bad_limits() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let mut ix = update_config_ix(&env, &admin.pubkey(), env.mint, env.treasury);
    ix.data = lockin::instruction::UpdateConfig { min_amount: 0, max_amount: 5 }.data();
    assert_eq!(code(env.send(&[ix.clone()], &[&admin])), lockin_err(E::InvalidLimits));
    ix.data = lockin::instruction::UpdateConfig { min_amount: 10, max_amount: 5 }.data();
    assert_eq!(code(env.send(&[ix], &[&admin])), lockin_err(E::InvalidLimits));
}

// ---------------------------------------------------------------- Token-2022

#[test]
fn works_with_a_token_2022_mint() {
    let mut env = Env::with_token_program(token_2022_program());
    let u = env.user();
    let p = env.create(&u, 1, 1);
    assert_eq!(env.balance(&p.vault), DEPOSIT);
    let b = env.pledge(&p).bounds;
    env.set_time(b[1] + HOUR);
    env.check_in(&p, &u.device, 1).unwrap();
    env.settle(&p, u.ata).unwrap();
    assert_eq!(env.balance(&u.ata), 10 * DEPOSIT);

    let p2 = env.create(&u, 2, 1);
    env.set_time(env.pledge(&p2).close_at);
    env.settle(&p2, u.ata).unwrap();
    assert_eq!(env.balance(&env.treasury.clone()), DEPOSIT);
}
