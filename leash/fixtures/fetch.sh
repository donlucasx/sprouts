#!/usr/bin/env bash
# Mainnet fixtures for the leash tests (git-ignored). Programs via `solana program dump`; accounts and the independent
# reference values via fetch.py (one getMultipleAccounts call = one slot). Re-running refreshes the account snapshot.
set -euo pipefail
cd "$(dirname "$0")"
RPC="${LEASH_RPC:-https://api.mainnet-beta.solana.com}"
mkdir -p accounts
dump() { [ -s "$2" ] || solana program dump "$1" "$2" --url "$RPC" >/dev/null; }
dump De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44 subs.so
dump KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD klend.so
dump jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9 jlend.so
dump jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC jlliq.so
dump SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ skr.so
md5 -r subs.so klend.so jlend.so jlliq.so skr.so
python3 fetch.py "$RPC"
