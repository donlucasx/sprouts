#!/usr/bin/env bash
# Build leash.so and the CPI wrapper with Agave 3.1.11 cargo-build-sbf, then run the tests. Args go to cargo test.
# A build that reports an SBF stack overflow fails here (scripts/sbf.sh), although cargo-build-sbf itself exits 0.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p target
. scripts/sbf.sh
sbf_build program/Cargo.toml target/build-leash.log
if [ -d tests/cpi-wrapper ]; then sbf_build tests/cpi-wrapper/Cargo.toml target/build-cpi-wrapper.log; fi
cargo test -p leash-tests "$@"
