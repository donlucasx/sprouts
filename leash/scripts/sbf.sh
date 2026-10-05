# Sourced by test.sh and mutate.sh. cargo-build-sbf exits 0 when the SBF backend reports a stack-frame overflow
# ("Error: Function ... Stack offset of 4928 exceeded max offset of 4096 by 832 bytes ..."), and the program then fails
# at runtime with ProgramFailedToComplete in unrelated tests (Task 5 report, concern 1). These helpers make it a build failure.
BIN="${AGAVE_BIN:-$HOME/.local/share/agave-v3.1.11/solana-release/bin}"

# stack_overflow_in <log>: true when the build log carries the overflow line.
stack_overflow_in() { grep -q 'Stack offset' "$1"; }

# sbf_build <manifest> <log> [quiet]: build into target/deploy; fail on a non-zero exit OR a stack overflow line.
sbf_build() {
  local manifest=$1 log=$2 quiet=${3:-}
  local rc=0
  # A no-op rebuild prints no codegen output, so an overflow line from an earlier build would not reappear: touch the
  # crate's sources so every call recompiles it and the log always carries this build's diagnostics.
  find "$(dirname "$manifest")/src" -name '*.rs' -exec touch {} +
  if [ -n "$quiet" ]; then
    "$BIN/cargo-build-sbf" --manifest-path "$manifest" --sbf-out-dir target/deploy >"$log" 2>&1 || rc=$?
  else
    # pipefail set here, in a subshell, so the build's exit status is kept whatever the caller's shell options are
    ( set -o pipefail; "$BIN/cargo-build-sbf" --manifest-path "$manifest" --sbf-out-dir target/deploy 2>&1 | tee "$log" ) || rc=$?
  fi
  if [ "$rc" != 0 ]; then echo "SBF BUILD FAILED ($manifest, exit $rc, $log)" >&2; return 1; fi
  if stack_overflow_in "$log"; then
    echo "SBF STACK OVERFLOW ($manifest): cargo-build-sbf exited 0 but reported:" >&2
    grep 'Stack offset' "$log" >&2
    return 1
  fi
}

# Verifiable build (owner ruling R334): the release leash.so is built by solana-verify in docker, from the Agave 3.1.11
# image pinned by digest, so anyone can rebuild the same bytes and `solana-verify verify-from-repo` can match them on chain.
# Needs docker (on this Mac: `colima start`) and solana-verify 0.5.2 (`cargo install solana-verify --version 0.5.2 --locked`).
VERIFY_IMAGE=solanafoundation/solana-verifiable-build@sha256:4687aba06e83923eb01b550451335fcf452c9feb9c70f309ba75a8e683a482c2
SOLANA_VERIFY="${SOLANA_VERIFY:-$HOME/.cargo/bin/solana-verify}"

# verify_build <log> [quiet]: solana-verify build of the leash crate (mount = this leash/ directory) into target/deploy/leash.so;
# fail on a non-zero exit OR a stack overflow line, as sbf_build does. Run from leash/ (test.sh and mutate.sh cd there).
# Keep no other crate named `leash` under leash/ (no clones in target/): solana-verify builds the first one it finds.
verify_build() {
  local log=$1 quiet=${2:-}
  local rc=0
  docker info >/dev/null 2>&1 || { echo "VERIFY BUILD: docker is not running (on this Mac: colima start)" >&2; return 1; }
  [ -x "$SOLANA_VERIFY" ] || { echo "VERIFY BUILD: $SOLANA_VERIFY missing (cargo install solana-verify --version 0.5.2 --locked)" >&2; return 1; }
  find program/src -name '*.rs' -exec touch {} +
  if [ -n "$quiet" ]; then
    "$SOLANA_VERIFY" build --library-name leash --base-image "$VERIFY_IMAGE" "$PWD" >"$log" 2>&1 || rc=$?
  else
    ( set -o pipefail; "$SOLANA_VERIFY" build --library-name leash --base-image "$VERIFY_IMAGE" "$PWD" 2>&1 | tee "$log" ) || rc=$?
  fi
  if [ "$rc" != 0 ]; then echo "VERIFY BUILD FAILED (exit $rc, $log)" >&2; return 1; fi
  if stack_overflow_in "$log"; then
    echo "SBF STACK OVERFLOW (verify build): solana-verify exited 0 but reported:" >&2
    grep 'Stack offset' "$log" >&2
    return 1
  fi
  grep -q '^Building program at /build//program/$' "$log" || { echo "VERIFY BUILD built another crate than leash/program ($log)" >&2; return 1; }
}

# leash_build <log> [quiet]: the release path (verify_build) unless LEASH_LOCAL_SBF=1 asks for this machine's cargo-build-sbf,
# whose bytes differ from the release (fine for a quick local loop, never for a gate).
leash_build() {
  if [ -n "${LEASH_LOCAL_SBF:-}" ]; then sbf_build program/Cargo.toml "$@"; else verify_build "$@"; fi
}

# local_sbf_warning: one loud line when LEASH_LOCAL_SBF is set (printed when this file is sourced and again at the end of
# test.sh and mutate.sh), because those runs test this Mac's bytes, not the release. It changes nothing else.
local_sbf_warning() {
  if [ -n "${LEASH_LOCAL_SBF:-}" ]; then
    echo "WARNING: LEASH_LOCAL_SBF is set: leash.so was built by this Mac's cargo-build-sbf, NOT the release (verifiable) bytes. Nothing from this run counts as a gate result." >&2
  fi
}
local_sbf_warning
