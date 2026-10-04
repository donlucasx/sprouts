#!/usr/bin/env bash
# Mutation proof (contracts sec 2.10): for each row of tests/mutations.tsv, delete the line ending in `// GUARD:<ID>`,
# rebuild (svm rows), run the row's test, and require it to FAIL. No args = every row; args = guard ids.
set -euo pipefail
cd "$(dirname "$0")/.."
BIN="${AGAVE_BIN:-$HOME/.local/share/agave-v3.1.11/solana-release/bin}"
TSV=tests/mutations.tsv
mkdir -p target
build() { "$BIN/cargo-build-sbf" --manifest-path program/Cargo.toml --sbf-out-dir target/deploy >target/mutate-build.log 2>&1; }
rows() { if [ $# -eq 0 ]; then grep -v '^#' "$TSV" | grep -v '^[[:space:]]*$'; else for g in "$@"; do awk -v g="$g" '$1==g' "$TSV"; done; fi; }
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
  mv "$file.mutbak" "$file"
done < <(rows "$@")
build
if ! git diff --quiet -- program; then echo "TREE DIRTY after mutation run"; fail=1; fi
echo "mutation rows RED: $red / $total"
exit $fail
