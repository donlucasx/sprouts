#!/usr/bin/env bash
# Mainnet fixtures for the leash tests (git-ignored). Programs via `solana program dump`; accounts and the independent
# reference values via fetch.py (one getMultipleAccounts call = one slot). Re-running refreshes the account snapshot.
# Every run re-dumps EVERY program binary too (Task 8): a venue upgrade changes its account layout and its .so together,
# so new accounts must never run against an old binary. Order: dump all binaries to new-<name>.so, fetch the accounts,
# and only then move the new binaries into place; a failed dump or fetch leaves the old .so set as it was (and removes
# the new-*.so files). The md5 lines show which binaries changed.
set -euo pipefail
cd "$(dirname "$0")"
RPC="${LEASH_RPC:-https://api.mainnet-beta.solana.com}"
PROGRAMS=(
  "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44 subs.so"
  "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD klend.so"
  "jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9 jlend.so"
  "jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC jlliq.so"
  "SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ skr.so"
)
cleanup() { rm -f new-*.so; }
trap cleanup EXIT
mkdir -p accounts
for p in "${PROGRAMS[@]}"; do
  set -- $p
  solana program dump "$1" "new-$2" --url "$RPC" >/dev/null
  [ -s "new-$2" ] || { echo "empty dump of $1" >&2; exit 1; }
done
python3 fetch.py "$RPC"
for p in "${PROGRAMS[@]}"; do
  set -- $p
  old=$( [ -f "$2" ] && md5 -q "$2" || echo none )
  mv "new-$2" "$2"
  new=$(md5 -q "$2")
  if [ "$old" = "$new" ]; then echo "$new $2 (unchanged)"; else echo "$new $2 (CHANGED from $old)"; fi
done
