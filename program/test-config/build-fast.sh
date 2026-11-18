#!/bin/bash
# Devnet-only TEST build of Lock-In with minute-long days, for clicking through time-based
# scenarios (win, loss after close, safe mode) in the app without waiting real days.
#
# The real program source has no test switches. This script copies it to ~/lockin-fast,
# rewrites two timing constants and the program id IN THE COPY, and builds it there.
# The copy declares a different program id, so it can never run at the real program's address.
# Never deploy this anywhere but devnet.
set -euo pipefail
. ~/.cargo/env
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

SRC="$(cd "$(dirname "$0")/.." && pwd)"
DST=~/lockin-fast
REAL_ID=6za6iZpEP96dN76pGYj27JmqzMgkRQ3JT3SnvrsZbHbv
FAST_KEY=$SRC/keys/lockin-fast-keypair.json
FAST_ID=$(solana-keygen pubkey "$FAST_KEY")

mkdir -p $DST/target/deploy
rsync -a --delete --exclude target --exclude keys --exclude Cargo.lock --exclude test-config $SRC/ $DST/
cp "$FAST_KEY" $DST/target/deploy/lockin-keypair.json

# Replace exactly one occurrence or fail.
patch() { # file, from, to
  local n; n=$(grep -cF -- "$2" "$1" || true)
  [ "$n" = "1" ] || { echo "patch: expected 1 match of '$2' in $1, got $n" >&2; exit 1; }
  python3 - "$1" "$2" "$3" <<'PY'
import sys
p, a, b = sys.argv[1:]
s = open(p).read()
open(p, 'w').write(s.replace(a, b))
PY
}
cd $DST
patch programs/lockin/src/constants.rs 'pub const MIN_DAY_SECS: i64 = 22 * 3600;' 'pub const MIN_DAY_SECS: i64 = 60; // FAST TEST BUILD'
patch programs/lockin/src/constants.rs 'pub const CLOSE_GRACE_SECS: i64 = 24 * 3600;' 'pub const CLOSE_GRACE_SECS: i64 = 180; // FAST TEST BUILD'
patch programs/lockin/src/lib.rs "declare_id!(\"$REAL_ID\");" "declare_id!(\"$FAST_ID\");"
sed -i "s/$REAL_ID/$FAST_ID/g" Anchor.toml

anchor build 2>&1 | grep -E '^(error|warning)' || true
ls -la target/deploy/lockin.so
echo "fast program id: $FAST_ID"
