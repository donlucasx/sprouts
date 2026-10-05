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
