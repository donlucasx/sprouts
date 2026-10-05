#!/usr/bin/env bash
# Mutation proof (contracts sec 2.10): for each row of tests/mutations.tsv, delete the line ending in `// GUARD:<ID>`,
# rebuild (svm rows), run the row's test, and require it to FAIL. No args = every row; args = guard ids.
set -euo pipefail
cd "$(dirname "$0")/.."
TSV=tests/mutations.tsv
mkdir -p target
. scripts/sbf.sh # BIN, sbf_build: a stack-overflow build is a BUILDFAIL, never a false RED
# Restore every guard a mutation pass removed, however the run ends (EXIT, Ctrl-C, kill); touch so cargo rebuilds.
restore() { find program/src -name '*.mutbak' -print0 | while IFS= read -r -d '' b; do mv "$b" "${b%.mutbak}" && touch "${b%.mutbak}"; done; }
trap restore EXIT
trap 'restore; exit 130' INT
trap 'restore; exit 143' TERM
build() { sbf_build program/Cargo.toml target/mutate-build.log quiet; }
rows() { if [ $# -eq 0 ]; then grep -v '^#' "$TSV" | grep -v '^[[:space:]]*$'; else for g in "$@"; do awk -v g="$g" '$1==g' "$TSV"; done; fi; }
# the CPI wrapper (cpi.rs rows) is never mutated; build it once so those rows never run a stale or missing .so
if [ -d tests/cpi-wrapper ]; then sbf_build tests/cpi-wrapper/Cargo.toml target/build-cpi-wrapper.log quiet || exit 1; fi
fail=0; red=0; total=0
while read -r id kind file testfile testname; do
  [ -z "${id:-}" ] && continue
  total=$((total + 1))
  n=$(grep -c "// GUARD:${id}\$" "$file" || true)
  if [ "$n" != "1" ]; then echo "MARKER   $id: $n lines in $file (need exactly 1)"; fail=1; continue; fi
  cp "$file" "$file.mutbak"
  perl -pi -e "s{^.*// GUARD:${id}\\b.*}{// MUTATED:${id}}" "$file"
  built=1
  if [ "$kind" = svm ]; then build || { echo "BUILDFAIL $id (target/mutate-build.log)"; built=0; fail=1; }; fi
  if [ "$built" = 1 ]; then
    if cargo test -q -p leash-tests --test "$testfile" "$testname" -- --exact >target/mutate-test.log 2>&1; then
      echo "SURVIVED $id: $testfile::$testname passed without the guard"; fail=1
    elif grep -q 'error\[E' target/mutate-test.log; then
      echo "COMPILE  $id: the mutated program does not compile (target/mutate-test.log)"; fail=1
    else
      echo "RED      $id ($testfile::$testname)"; red=$((red + 1))
    fi
  fi
  mv "$file.mutbak" "$file" && touch "$file" # the backup's old mtime would make cargo keep the mutated build
done < <(rows "$@")
build || { echo "BUILDFAIL restored program (target/mutate-build.log)"; fail=1; }
if [ -n "$(git status --porcelain -- program)" ]; then echo "TREE DIRTY after mutation run"; git status --porcelain -- program; fail=1; fi
echo "mutation rows RED: $red / $total"
exit $fail
