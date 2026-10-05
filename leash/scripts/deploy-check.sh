#!/usr/bin/env bash
# Read-only checks around the leash program's FIRST mainnet deploy (DEPLOY-RUNBOOK.md). Sends nothing, signs nothing,
# never reads a key's contents: keypairs are used by path only, for their public key.
#   scripts/deploy-check.sh pre    before the deploy: keys, ids, release hash, nothing deployed yet, cost vs balance
#   scripts/deploy-check.sh post   after the deploy: authority, data length, on-chain bytes == the release .so
# LEASH_URL overrides the cluster (default mainnet-beta). It exists only for a localnet dry run of this script.
set -euo pipefail
cd "$(dirname "$0")/.."

URL="${LEASH_URL:-mainnet-beta}"
ADMIN_KP="$HOME/.config/solana/sprouts-admin.json"
PROGRAM_KP="$HOME/.config/solana/sprouts-leash-program.json"
ADMIN=GrHSwzYpgiFzuTpwR6539NpNXktXNEUfVU9UYvHdDKLY
PROGRAM_ID=GyBmDLN72kg6xwAnZfj9c7fjeaJ3GvhkHNhFns83f8f7
# --max-len of the deploy line in DEPLOY-RUNBOOK.md (keep the two equal). Just above the .so size, so the program data
# account is not reserved at a larger size than needed (its rent is paid once, by ADMIN).
MAX_LEN=70000
CONFIG_LEN=1504            # contracts 2.3
FEE_ALLOWANCE=10000000     # 0.01 SOL: ~70 buffer writes + the deploy + 12 admin txs, priority fee and resends included
SO=target/deploy/leash.so

fail() { echo "STOP: $*" >&2; exit 1; }
ok() { echo "ok   $*"; }
lamports_rent() { solana rent "$1" --lamports -u "$URL" | awk '/Rent-exempt minimum/ {print $3}'; }
sol() { awk -v l="$1" 'BEGIN { printf "%.6f SOL", l / 1e9 }'; }

[ -f "$SO" ] || fail "$SO missing: run ./scripts/test.sh first"
SIZE=$(stat -f%z "$SO")
WANT_HASH=$(sed -n 's/.*leash\.so sha256 = \([0-9a-f]\{64\}\).*/\1/p' GATES.md | head -1)
WANT_SIZE=$(sed -n 's/.*leash\.so sha256 = [0-9a-f]\{64\}, size = \([0-9]*\) B.*/\1/p' GATES.md | head -1)
[ -n "$WANT_HASH" ] && [ -n "$WANT_SIZE" ] || fail "no Release line with the .so hash and size in GATES.md"

case "${1:-}" in
pre)
  [ -f "$ADMIN_KP" ] || fail "ADMIN keypair file missing at $ADMIN_KP"
  [ -f "$PROGRAM_KP" ] || fail "program keypair file missing at $PROGRAM_KP"
  [ "$(solana-keygen pubkey "$ADMIN_KP")" = "$ADMIN" ] || fail "the ADMIN keypair file is not $ADMIN"
  ok "ADMIN keypair is $ADMIN"
  [ "$(grep -c "$ADMIN" program/src/constants.rs)" = 1 ] || fail "program/src/constants.rs does not hard-code $ADMIN exactly once"
  ok "program/src/constants.rs hard-codes the same ADMIN"
  [ "$(solana-keygen pubkey "$PROGRAM_KP")" = "$PROGRAM_ID" ] || fail "the program keypair file is not $PROGRAM_ID"
  ok "program keypair is $PROGRAM_ID"
  [ "$(grep -c "declare_id!(\"$PROGRAM_ID\")" program/src/lib.rs)" = 1 ] || fail "program/src/lib.rs does not declare $PROGRAM_ID"
  ok "program/src/lib.rs declares the same id"

  HASH=$(shasum -a 256 "$SO" | awk '{print $1}')
  [ "$HASH" = "$WANT_HASH" ] || fail "leash.so sha256 $HASH differs from GATES.md's Release $WANT_HASH (not the tested build)"
  [ "$SIZE" = "$WANT_SIZE" ] || fail "leash.so is $SIZE B, GATES.md's Release says $WANT_SIZE B"
  ok "leash.so sha256 $HASH and size $SIZE B equal GATES.md's Release line"
  [ "$MAX_LEN" -ge "$SIZE" ] || fail "MAX_LEN $MAX_LEN is under the .so size $SIZE"

  # Fail closed: only an explicit AccountNotFound counts as "nothing deployed"; an RPC error or rate limit STOPs.
  if PROBE=$(solana account "$PROGRAM_ID" -u "$URL" 2>&1); then
    fail "$PROGRAM_ID already exists on $URL. Right after an A4 attempt: run A5 (the deploy may have landed). Otherwise this runbook (first deploy only) does not apply"
  fi
  # Exact line: the CLI also labels a transport error "AccountNotFound: pubkey=...: error sending request ..." (seen).
  echo "$PROBE" | grep -qx "Error: AccountNotFound: pubkey=$PROGRAM_ID" || fail "could not read $PROGRAM_ID on $URL (RPC error, not an answer): rerun A3 in a minute"
  ok "nothing is deployed at $PROGRAM_ID yet"
  BUFFERS=$(solana program show --buffers -k "$ADMIN_KP" -u "$URL" | awk 'NF && $1 != "Buffer" && $1 !~ /^-+$/' | wc -l | tr -d ' ')
  [ "$BUFFERS" = 0 ] || fail "ADMIN owns $BUFFERS leftover buffer(s); see 'If the deploy stops part-way' in DEPLOY-RUNBOOK.md"
  ok "no leftover deploy buffers"

  R_DATA=$(lamports_rent $((MAX_LEN + 45)))     # program data account: 45 B header + max-len
  R_PROG=$(lamports_rent 36)                    # program account
  R_BUF=$(lamports_rent $((SIZE + 37)))         # write buffer: 37 B header + the .so; refunded inside the deploy tx
  R_CFG=$(lamports_rent "$CONFIG_LEN")          # Config PDA, created by init_config
  NEED=$((R_DATA + R_PROG + R_CFG + FEE_ALLOWANCE))
  PEAK=$(( (R_BUF > R_DATA ? R_BUF : R_DATA) + R_PROG + FEE_ALLOWANCE ))
  BAL=$(solana balance "$ADMIN" --lamports -u "$URL" | awk '{print $1}')
  echo "     program data rent ($((MAX_LEN + 45)) B)   $(sol "$R_DATA")"
  echo "     program account rent (36 B)     $(sol "$R_PROG")"
  echo "     Config rent ($CONFIG_LEN B)            $(sol "$R_CFG")"
  echo "     fee allowance                   $(sol "$FEE_ALLOWANCE")"
  echo "     total the runbook spends        $(sol "$NEED")"
  echo "     most held at one time (deploy)  $(sol "$PEAK")  (the buffer, $(sol "$R_BUF"), is refunded inside the deploy tx)"
  echo "     ADMIN balance                   $(sol "$BAL")"
  [ "$BAL" -ge "$NEED" ] || fail "ADMIN holds $(sol "$BAL"), the runbook needs $(sol "$NEED")"
  ok "ADMIN balance covers the deploy and the Config"
  echo "PRE-CHECK PASSED"
  ;;
post)
  SHOW=$(solana program show "$PROGRAM_ID" -k "$ADMIN_KP" -u "$URL")
  echo "$SHOW"
  AUTH=$(echo "$SHOW" | awk '/^Authority:/ {print $2}')
  DLEN=$(echo "$SHOW" | awk '/^Data Length:/ {print $3}')
  [ "$AUTH" = "$ADMIN" ] || fail "upgrade authority is '$AUTH', not ADMIN $ADMIN"
  ok "upgrade authority is ADMIN"
  [ "$DLEN" = "$MAX_LEN" ] || fail "Data Length is '$DLEN', expected the deploy's --max-len $MAX_LEN"
  ok "data length $DLEN = --max-len"
  DUMP=target/onchain-leash.so
  rm -f "$DUMP"
  solana program dump "$PROGRAM_ID" "$DUMP" -k "$ADMIN_KP" -u "$URL" >/dev/null
  # Hash the first SIZE bytes: macOS `cmp -n` still reports "EOF on leash.so" (exit 1) when the dump is longer.
  HEAD_HASH=$(head -c "$SIZE" "$DUMP" | shasum -a 256 | awk '{print $1}')
  [ "$HEAD_HASH" = "$WANT_HASH" ] || fail "the first $SIZE on-chain bytes hash to $HEAD_HASH, not the release $WANT_HASH"
  TAIL_NONZERO=$(tail -c +$((SIZE + 1)) "$DUMP" | tr -d '\000' | wc -c | tr -d ' ')
  [ "$TAIL_NONZERO" = 0 ] || fail "the on-chain bytes after the first $SIZE are not all zero"
  ok "on-chain program bytes = leash.so (sha256 $WANT_HASH), zero-padded to $DLEN"
  echo "POST-CHECK PASSED"
  ;;
*)
  echo "usage: scripts/deploy-check.sh pre|post" >&2
  exit 2
  ;;
esac
