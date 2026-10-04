#!/usr/bin/env bash
# Build leash.so (and the CPI wrapper once it exists) with Agave 3.1.11 cargo-build-sbf, then run the tests. Args go to cargo test.
set -euo pipefail
cd "$(dirname "$0")/.."
BIN="${AGAVE_BIN:-$HOME/.local/share/agave-v3.1.11/solana-release/bin}"
"$BIN/cargo-build-sbf" --manifest-path program/Cargo.toml --sbf-out-dir target/deploy
if [ -d tests/cpi-wrapper ]; then "$BIN/cargo-build-sbf" --manifest-path tests/cpi-wrapper/Cargo.toml --sbf-out-dir target/deploy; fi
cargo test -p leash-tests "$@"
