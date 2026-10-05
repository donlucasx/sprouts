#!/usr/bin/env bash
# Build leash.so (the verifiable docker build, scripts/sbf.sh verify_build; LEASH_LOCAL_SBF=1 for the local one) and the
# CPI wrapper (Agave 3.1.11 cargo-build-sbf, test-only), then run the tests. Args go to cargo test.
# A build that reports an SBF stack overflow fails here (scripts/sbf.sh), although cargo-build-sbf itself exits 0.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p target
. scripts/sbf.sh
leash_build target/build-leash.log
if [ -d tests/cpi-wrapper ]; then sbf_build tests/cpi-wrapper/Cargo.toml target/build-cpi-wrapper.log; fi
rc=0
cargo test -p leash-tests "$@" || rc=$?
local_sbf_warning
exit $rc
