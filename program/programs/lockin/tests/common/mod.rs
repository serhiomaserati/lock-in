#![allow(dead_code)]

use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use litesvm::LiteSVM;
use litesvm_token::{CreateAssociatedTokenAccount, CreateMint, MintTo};
use lockin::{
    state::{Config, Pledge, ProofKind},
    CreatePledgeArgs, CONFIG_SEED, PLEDGE_SEED, VAULT_SEED,
};
use solana_address::Address;
use solana_clock::Clock;
use solana_instruction::{error::InstructionError, Instruction};
use solana_keypair::Keypair;
use solana_signer::Signer;
use solana_transaction::Transaction;
use solana_transaction_error::TransactionError;

pub const T0: i64 = 1_790_000_000;
pub const HOUR: i64 = 3_600;
pub const DAY: i64 = 24 * HOUR;
pub const SOL: u64 = 1_000_000_000;
/// 100 tokens with 6 decimals.
pub const DEPOSIT: u64 = 100_000_000;
pub const MIN_AMOUNT: u64 = 1_000_000;
pub const MAX_AMOUNT: u64 = 10_000_000_000;

pub type TxResult = Result<(), TransactionError>;

pub fn system_program() -> Address {
    Address::default()
}
pub fn token_program() -> Address {
    litesvm_token::TOKEN_ID
}
pub fn token_2022_program() -> Address {
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb".parse().unwrap()
}
fn loader_v3() -> Address {
    "BPFLoaderUpgradeab1e11111111111111111111111".parse().unwrap()
}
pub fn program_data() -> Address {
    Address::find_program_address(&[lockin::ID.as_ref()], &loader_v3()).0
}
pub fn config_address() -> Address {
    Address::find_program_address(&[CONFIG_SEED], &lockin::ID).0
}
pub fn pledge_address(owner: &Address, id: u64) -> Address {
    Address::find_program_address(&[PLEDGE_SEED, owner.as_ref(), &id.to_le_bytes()], &lockin::ID).0
}
pub fn vault_address(pledge: &Address) -> Address {
    Address::find_program_address(&[VAULT_SEED, pledge.as_ref()], &lockin::ID).0
}

/// Code of a program error from `lockin::error::LockinError`.
pub fn lockin_err(e: lockin::error::LockinError) -> u32 {
    6000 + e as u32
}
/// Code of an Anchor framework error (constraint failures etc.).
pub fn anchor_err(e: anchor_lang::error::ErrorCode) -> u32 {
    e as u32
}

/// The custom error code a failed transaction returned.
#[track_caller]
pub fn code(res: TxResult) -> u32 {
    match res {
        Err(TransactionError::InstructionError(_, InstructionError::Custom(c))) => c,
        other => panic!("expected a custom program error, got {other:?}"),
    }
}

pub struct User {
    pub kp: Keypair,
    pub ata: Address,
    pub device: Keypair,
}

impl User {
    pub fn key(&self) -> Address {
        self.kp.pubkey()
    }
}

#[derive(Clone, Copy, Debug)]
pub struct P {
    pub address: Address,
    pub vault: Address,
    pub owner: Address,
    pub id: u64,
}

pub struct Env {
    pub svm: LiteSVM,
    pub admin: Keypair,
    pub mint: Address,
    pub token_program: Address,
    /// Token account that receives forfeits.
    pub treasury: Address,
}

impl Env {
    /// Program deployed with `admin` as upgrade authority, a mint, a treasury, config initialized.
    pub fn new() -> Self {
        Self::with_token_program(token_program())
    }

    pub fn with_token_program(token_program: Address) -> Self {
        let mut env = Self::bare(token_program);
        let admin = env.admin.insecure_clone();
        let ix = env.init_config_ix(&admin.pubkey(), &env.mint.clone(), &env.treasury.clone());
        env.send(&[ix], &[&admin]).unwrap();
        env
    }

    /// Program deployed (upgrade authority = admin), mint and treasury created, no config yet.
    pub fn bare(token_program: Address) -> Self {
        let mut svm = LiteSVM::new();
        let admin = Keypair::new();
        svm.airdrop(&admin.pubkey(), 100 * SOL).unwrap();
        let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/lockin.so"));
        svm.add_program(lockin::ID, bytes).unwrap();
        let mut env = Env { svm, admin, mint: Address::default(), token_program, treasury: Address::default() };
        env.set_upgrade_authority(Some(env.admin.pubkey()));
        env.set_time(T0);
        env.mint = env.new_mint();
        let treasury_owner = Address::new_unique();
        env.treasury = env.ata_for(&treasury_owner, &env.mint.clone());
        env
    }

    /// LiteSVM deploys without an upgrade authority; patch the ProgramData header
    /// (bincode: u32 tag, u64 slot, Option<Address>).
    pub fn set_upgrade_authority(&mut self, authority: Option<Address>) {
        let pd = program_data();
        let mut acc = self.svm.get_account(&pd).unwrap();
        acc.data[12] = authority.is_some() as u8;
        acc.data[13..45].copy_from_slice(authority.unwrap_or_default().as_ref());
        self.svm.set_account(pd, acc).unwrap();
    }

    pub fn new_mint(&mut self) -> Address {
        let tp = self.token_program;
        CreateMint::new(&mut self.svm, &self.admin).decimals(6).token_program_id(&tp).send().unwrap()
    }

    pub fn ata_for(&mut self, owner: &Address, mint: &Address) -> Address {
        let tp = self.token_program;
        CreateAssociatedTokenAccount::new(&mut self.svm, &self.admin, mint)
            .owner(owner)
            .token_program_id(&tp)
            .send()
            .unwrap()
    }

    pub fn mint_to(&mut self, mint: &Address, dest: &Address, amount: u64) {
        let tp = self.token_program;
        MintTo::new(&mut self.svm, &self.admin, mint, dest, amount).token_program_id(&tp).send().unwrap();
    }

    /// A wallet with SOL, a funded token account and a fresh device key.
    pub fn user(&mut self) -> User {
        let kp = Keypair::new();
        self.svm.airdrop(&kp.pubkey(), 10 * SOL).unwrap();
        let mint = self.mint;
        let ata = self.ata_for(&kp.pubkey(), &mint);
        self.mint_to(&mint, &ata, 10 * DEPOSIT);
        let device = Keypair::new();
        self.svm.airdrop(&device.pubkey(), SOL / 100).unwrap();
        User { kp, ata, device }
    }

    pub fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }

    pub fn set_time(&mut self, t: i64) {
        let mut clock: Clock = self.svm.get_sysvar();
        clock.unix_timestamp = t;
        self.svm.set_sysvar(&clock);
    }

    /// Sends a transaction; the first signer pays. A fresh blockhash every time so a retry
    /// of the same instruction isn't rejected as a duplicate.
    pub fn send(&mut self, ixs: &[Instruction], signers: &[&Keypair]) -> TxResult {
        let payer = signers[0].pubkey();
        let tx = Transaction::new_signed_with_payer(ixs, Some(&payer), signers, self.svm.latest_blockhash());
        let res = self.svm.send_transaction(tx).map(|_| ()).map_err(|e| e.err);
        self.svm.expire_blockhash();
        res
    }

    /// Token amount, read from the base layout both token programs share (mint 0..32,
    /// owner 32..64, amount 64..72), so it works for Token-2022 accounts with extensions too.
    pub fn balance(&self, token_account: &Address) -> u64 {
        let acc = self.svm.get_account(token_account).expect("token account exists");
        assert!(acc.owner == self.token_program, "not a token account of {}", self.token_program);
        u64::from_le_bytes(acc.data[64..72].try_into().unwrap())
    }

    pub fn exists(&self, address: &Address) -> bool {
        self.svm.get_account(address).is_some_and(|a| a.lamports > 0)
    }

    pub fn lamports(&self, address: &Address) -> u64 {
        self.svm.get_account(address).map_or(0, |a| a.lamports)
    }

    pub fn pledge(&self, p: &P) -> Pledge {
        let acc = self.svm.get_account(&p.address).unwrap();
        Pledge::try_deserialize(&mut acc.data.as_slice()).unwrap()
    }

    pub fn config(&self) -> Config {
        let acc = self.svm.get_account(&config_address()).unwrap();
        Config::try_deserialize(&mut acc.data.as_slice()).unwrap()
    }

    // ---- instruction builders ----

    pub fn init_config_ix(&self, admin: &Address, mint: &Address, forfeit_to: &Address) -> Instruction {
        Instruction {
            program_id: lockin::ID,
            accounts: lockin::accounts::InitConfig {
                admin: *admin,
                config: config_address(),
                mint: *mint,
                forfeit_to: *forfeit_to,
                program: lockin::ID,
                program_data: program_data(),
                token_program: self.token_program,
                system_program: system_program(),
            }
            .to_account_metas(None),
            data: lockin::instruction::InitConfig { min_amount: MIN_AMOUNT, max_amount: MAX_AMOUNT }.data(),
        }
    }

    pub fn admin_ix(&self, admin: &Address, data: Vec<u8>) -> Instruction {
        Instruction {
            program_id: lockin::ID,
            accounts: lockin::accounts::AdminOnly { admin: *admin, config: config_address() }.to_account_metas(None),
            data,
        }
    }

    pub fn set_safe_mode(&mut self, on: bool) -> TxResult {
        let admin = self.admin.insecure_clone();
        let ix = self.admin_ix(&admin.pubkey(), lockin::instruction::SetSafeMode { on }.data());
        self.send(&[ix], &[&admin])
    }

    pub fn set_paused_new(&mut self, paused: bool) -> TxResult {
        let admin = self.admin.insecure_clone();
        let ix = self.admin_ix(&admin.pubkey(), lockin::instruction::SetPausedNew { paused }.data());
        self.send(&[ix], &[&admin])
    }

    /// Default args: `days`-day self-report goal starting in one hour, plain 24h days.
    pub fn args(&self, u: &User, id: u64, days: u8) -> CreatePledgeArgs {
        CreatePledgeArgs {
            id,
            amount: DEPOSIT,
            days,
            proof: ProofKind::SelfReport,
            steps_per_day: 0,
            bounds: bounds(self.now() + HOUR, days, DAY),
            tz_name: "Europe/Kyiv".to_string(),
            device_key: u.device.pubkey(),
        }
    }

    pub fn create_ix(&self, owner: &Address, owner_token: &Address, mint: &Address, args: CreatePledgeArgs) -> Instruction {
        let pledge = pledge_address(owner, args.id);
        Instruction {
            program_id: lockin::ID,
            accounts: lockin::accounts::CreatePledge {
                owner: *owner,
                config: config_address(),
                pledge,
                mint: *mint,
                vault: vault_address(&pledge),
                owner_token: *owner_token,
                token_program: self.token_program,
                system_program: system_program(),
            }
            .to_account_metas(None),
            data: lockin::instruction::CreatePledge { args }.data(),
        }
    }

    pub fn create_with(&mut self, u: &User, args: CreatePledgeArgs) -> Result<P, TransactionError> {
        let id = args.id;
        let ix = self.create_ix(&u.key(), &u.ata, &self.mint.clone(), args);
        self.send(&[ix], &[&u.kp])?;
        let address = pledge_address(&u.key(), id);
        Ok(P { address, vault: vault_address(&address), owner: u.key(), id })
    }

    pub fn create(&mut self, u: &User, id: u64, days: u8) -> P {
        let args = self.args(u, id, days);
        self.create_with(u, args).unwrap()
    }

    pub fn check_in(&mut self, p: &P, signer: &Keypair, day: u8) -> TxResult {
        let ix = Instruction {
            program_id: lockin::ID,
            accounts: lockin::accounts::CheckIn { signer: signer.pubkey(), config: config_address(), pledge: p.address }
                .to_account_metas(None),
            data: lockin::instruction::CheckIn { day }.data(),
        };
        self.send(&[ix], &[signer])
    }

    pub fn set_device_key(&mut self, p: &P, signer: &Keypair, device_key: Address) -> TxResult {
        let ix = Instruction {
            program_id: lockin::ID,
            accounts: lockin::accounts::SetDeviceKey { owner: signer.pubkey(), pledge: p.address }.to_account_metas(None),
            data: lockin::instruction::SetDeviceKey { device_key }.data(),
        };
        self.send(&[ix], &[signer])
    }

    /// Raw settle: every account explicit, so tests can pass wrong ones.
    pub fn settle_raw(
        &mut self,
        payer: &Keypair,
        p: &P,
        owner: Address,
        vault: Address,
        owner_token: Option<Address>,
        forfeit_to: Option<Address>,
    ) -> TxResult {
        let mint = self.pledge(p).mint;
        let ix = Instruction {
            program_id: lockin::ID,
            accounts: lockin::accounts::Settle {
                config: config_address(),
                pledge: p.address,
                owner,
                mint,
                vault,
                owner_token,
                forfeit_to,
                token_program: self.token_program,
            }
            .to_account_metas(None),
            data: lockin::instruction::Settle {}.data(),
        };
        self.send(&[ix], &[payer])
    }

    /// Settle the way the app does it: both payout accounts passed, a stranger pays the fee.
    pub fn settle(&mut self, p: &P, owner_token: Address) -> TxResult {
        let payer = Keypair::new();
        self.svm.airdrop(&payer.pubkey(), SOL).unwrap();
        let forfeit_to = self.pledge(p).forfeit_to;
        self.settle_raw(&payer, p, p.owner, p.vault, Some(owner_token), Some(forfeit_to))
    }

    pub fn refund(&mut self, authority: &Keypair, p: &P, owner_token: Address) -> TxResult {
        let mint = self.pledge(p).mint;
        let ix = Instruction {
            program_id: lockin::ID,
            accounts: lockin::accounts::RefundInSafeMode {
                authority: authority.pubkey(),
                config: config_address(),
                pledge: p.address,
                owner: p.owner,
                mint,
                vault: p.vault,
                owner_token,
                token_program: self.token_program,
            }
            .to_account_metas(None),
            data: lockin::instruction::RefundInSafeMode {}.data(),
        };
        self.send(&[ix], &[authority])
    }

    pub fn close_pledge(&mut self, owner: &Keypair, p: &P) -> TxResult {
        let ix = Instruction {
            program_id: lockin::ID,
            accounts: lockin::accounts::ClosePledge { owner: owner.pubkey(), pledge: p.address }.to_account_metas(None),
            data: lockin::instruction::ClosePledge {}.data(),
        };
        self.send(&[ix], &[owner])
    }
}

/// `days + 2` bounds starting at `start`, every day `day_len` long.
pub fn bounds(start: i64, days: u8, day_len: i64) -> Vec<i64> {
    (0..days as i64 + 2).map(|i| start + i * day_len).collect()
}
