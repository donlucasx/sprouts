#!/usr/bin/env bash
# Read-only: reads the leash Config account and compares it byte for byte with the expected body (DEPLOY-RUNBOOK.md).
# Sends nothing, signs nothing, uses no key.
#   scripts/check-config.sh init          expect config/mainnet-init.hex  (after `leash-admin.ts init`: every leg set, all OFF)
#   scripts/check-config.sh day1          expect config/mainnet-day1.hex  (legs 2, 6, 7 ON; the only installable Config)
#   scripts/check-config.sh legs 1,2,6,7 [PULLER]
#                                         any other enabled list (Day 2, a leg taken out, a rotated puller): the
#                                         golden test builds the expected body from the same encoder as the hex files
# The account JSON is saved to target/config.json. LEASH_CONFIG_JSON=<file> compares a saved file instead of fetching;
# LEASH_URL overrides the cluster (default mainnet-beta). Both exist for a localnet dry run and a negative control.
# NEVER compare against TEST-VECTOR-all-legs-NEVER-INSTALL.hex: it is not a Config anyone installs (leg 0 SKR ON).
set -euo pipefail
cd "$(dirname "$0")/.."

URL="${LEASH_URL:-mainnet-beta}"
PROGRAM_ID=GyBmDLN72kg6xwAnZfj9c7fjeaJ3GvhkHNhFns83f8f7
MODE="${1:-}"

ADDR=$(cargo test -q -p leash-tests --test golden -- --ignored print_addresses --nocapture 2>/dev/null)
PDA=$(echo "$ADDR" | sed -n 's/^CONFIG_PDA=//p')
BUMP=$(echo "$ADDR" | sed -n 's/^CONFIG_BUMP=//p')
[ "$(echo "$ADDR" | sed -n 's/^LEASH_PROGRAM_ID=//p')" = "$PROGRAM_ID" ] || { echo "STOP: the tests' program id is not $PROGRAM_ID" >&2; exit 1; }
[ -n "$PDA" ] && [ -n "$BUMP" ] || { echo "STOP: golden print_addresses gave no CONFIG_PDA" >&2; exit 1; }

JSON=target/config.json
if [ -n "${LEASH_CONFIG_JSON:-}" ]; then
  JSON="$LEASH_CONFIG_JSON"
else
  mkdir -p target
  solana account "$PDA" --output json -u "$URL" > "$JSON" || { echo "STOP: could not read the Config account $PDA on $URL (not created yet, or an RPC error)" >&2; exit 1; }
fi
# Absolute: `cargo test` runs in tests/, so a relative path would not be found there.
JSON="$(cd "$(dirname "$JSON")" && pwd)/$(basename "$JSON")"
echo "Config PDA $PDA (bump $BUMP), account JSON $JSON"

case "$MODE" in
init|day1)
  python3 - "$JSON" "config/mainnet-$MODE.hex" "$PDA" "$BUMP" "$PROGRAM_ID" <<'PY'
import base64, json, sys
path, hexfile, pda, bump, program = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), sys.argv[5]
v = json.load(open(path))
data = base64.b64decode(v["account"]["data"][0])
want = bytes.fromhex(open(hexfile).read().strip())
errs = []
if v["pubkey"] != pda: errs.append(f"account is {v['pubkey']}, not the Config PDA {pda}")
if v["account"]["owner"] != program: errs.append(f"owner is {v['account']['owner']}, not the leash program")
if len(data) != 1504: errs.append(f"data length {len(data)}, not 1504")
if data[0:8] != b"LEASHCFG": errs.append(f"magic {data[0:8]!r}, not LEASHCFG")
if len(data) >= 10 and (data[8], data[9]) != (1, bump): errs.append(f"version/bump {data[8]}/{data[9]}, not 1/{bump}")
body = data[16:]
if len(body) == len(want) and body != want:
    if body[:80] != want[:80]: errs.append("header (bytes 16..96: puller, puller USDC, max pull) differs")
    for leg in range(8):
        h, w = body[80 + 176 * leg: 256 + 176 * leg], want[80 + 176 * leg: 256 + 176 * leg]
        if h != w:
            state = "UNSET (all zero)" if not any(h) else f"enabled={h[0]}"
            diff = [i for i in range(176) if h[i] != w[i]]
            errs.append(f"leg {leg} differs: chain {state}, file enabled={w[0]}; first differing leg byte {diff[0]} ({len(diff)} bytes differ)")
elif len(body) != len(want): errs.append(f"body length {len(body)} vs file {len(want)}")
def on(b): return [l for l in range(8) if len(b) >= 81 + 176 * l and b[80 + 176 * l] == 1]
print(f"chain enabled legs {on(body)}; {hexfile} enabled legs {on(want)}")
if errs:
    print("MISMATCH vs " + hexfile)
    for e in errs: print("  - " + e)
    sys.exit(1)
print(f"Config matches {hexfile} byte for byte (1488 B body, magic, version 1, bump {bump}, owner = leash)")
PY
  ;;
legs)
  LEGS="${2:-}"
  [ -n "$LEGS" ] || { echo "usage: scripts/check-config.sh legs <list, e.g. 1,2,6,7> [PULLER]" >&2; exit 2; }
  case ",$LEGS," in *,0,*) echo "STOP: leg 0 (SKR) has no price source and is never enabled (R324)" >&2; exit 1;; esac
  if [ -n "${3:-}" ]; then
    LEASH_ONCHAIN_CONFIG="$JSON" LEASH_EXPECT_LEGS="$LEGS" LEASH_EXPECT_PULLER="$3" \
      cargo test -q -p leash-tests --test golden -- --ignored onchain_config_matches --nocapture
  else
    LEASH_ONCHAIN_CONFIG="$JSON" LEASH_EXPECT_LEGS="$LEGS" \
      cargo test -q -p leash-tests --test golden -- --ignored onchain_config_matches --nocapture
  fi
  ;;
*)
  echo "usage: scripts/check-config.sh init | day1 | legs <list> [PULLER]" >&2
  exit 2
  ;;
esac
