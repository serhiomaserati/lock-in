# Lock-In program (Solana, Anchor 1.2)

The on-chain half of Lock-In: each goal is a `Pledge` account with its own token vault.
The app's client lives in `../seeker-app/lib/chain/`.

| | |
|---|---|
| Program ID | `6za6iZpEP96dN76pGYj27JmqzMgkRQ3JT3SnvrsZbHbv` |
| Toolchain | Rust 1.97, Agave 4.3 (`cargo build-sbf`, SBPF v3), Anchor CLI 1.2.1, LiteSVM 0.18 |

## Instructions

| Instruction | Who | What |
|---|---|---|
| `init_config` | program upgrade authority, once | token, forfeit account, deposit limits |
| `update_config` | admin | the same for **new** pledges (existing ones keep their snapshot) |
| `transfer_admin` / `accept_admin` | admin / new admin | two-step handover (e.g. to a Squads multisig) |
| `set_paused_new` | admin | stop/allow new pledges |
| `set_safe_mode` | admin | emergency: no forfeits, owners can take deposits back, `close_at` is pushed back by the outage |
| `create_pledge` | owner | locks the deposit, fixes the calendar (UTC day bounds, DST-aware) |
| `check_in(day)` | device key or owner | marks a started day, until `close_at` |
| `set_device_key` | owner | new phone / reinstall; the old key stops working |
| `settle` | anyone | met: deposit to owner (any time); missed: to `forfeit_to` from `close_at`, never in safe mode |
| `refund_in_safe_mode` | owner or admin | safe mode only; money can only go to the owner |
| `close_pledge` | owner | deletes a settled pledge (history), returns its rent |

## Build and test

```bash
anchor build
cargo test        # 22 LiteSVM tests, the clock is moved by hand
cp target/idl/lockin.json idl/
```

After changing instructions or accounts, update the discriminators/layouts in
`seeker-app/lib/chain/lockin-program.ts` from `idl/lockin.json`.

Keypairs are never committed (`keys/` is git-ignored).

## Fast test program (devnet only)

`test-config/build-fast.sh` copies this source to `~/lockin-fast`, sets the minimum day length to 60 s and the
grace after the last day to 180 s **in the copy**, swaps in a separate test program ID, and builds it. The real
source has no test switches; the copy declares a different ID, so it can't run at the real address.

## Local validator

```bash
solana-test-validator --reset \
  --upgradeable-program 6za6iZpEP96dN76pGYj27JmqzMgkRQ3JT3SnvrsZbHbv target/deploy/lockin.so ~/.config/solana/id.json
# in seeker-app
LOCKIN_RPC=http://127.0.0.1:8899 npx tsx scripts/lockin-admin.ts setup
LOCKIN_RPC=http://127.0.0.1:8899 npx tsx scripts/lockin-e2e.ts
```
