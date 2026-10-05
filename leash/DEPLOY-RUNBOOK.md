# Leash program: mainnet deploy runbook (Task 9)

You run every line yourself, in your own Terminal, one line at a time, in order. Paste a line, read its output, compare it
with "Expected", then go on. If the output differs, STOP and send the coordinator the output (leave out any 12-word phrase).

What this does: puts the leash program on mainnet (upgrade authority = your ADMIN key), creates its Config account, and turns
on the Day-1 legs. None of this moves anyone's money.

## Before you start

- **Where:** every line runs from `~/Documents/claude/seekerhackathon/build/sprouts` (main), after the coordinator has merged
  the leash branch and the API branch (with `leash-admin.ts`) into main. Not from any `sprouts-*` worktree.
- **Keys** are used by path only. No line prints a key file. `solana-keygen pubkey` prints only the public key.
  - ADMIN (pays, upgrade authority, Config admin): `~/.config/solana/sprouts-admin.json` = `GrHSwzYpgiFzuTpwR6539NpNXktXNEUfVU9UYvHdDKLY`
  - Program address (used once, by the deploy): `~/.config/solana/sprouts-leash-program.json` = `GyBmDLN72kg6xwAnZfj9c7fjeaJ3GvhkHNhFns83f8f7`
  - Config account: `E6Yce4hy6DHj2XoegipCStJ7xjZHdopWHMsxPtyUf5Nd`
- **Never:** `--final`, the server's puller key, or `config/TEST-VECTOR-all-legs-NEVER-INSTALL.hex`.
- **Money:** ADMIN holds 0.6 SOL. The whole runbook spends about **0.376 SOL**; about 0.22 SOL stays.

| What | SOL |
|---|---|
| Program data account (70,045 B) | 0.356479 |
| Program account | 0.000833 |
| Config account | 0.008291 |
| Fees, allowance | 0.010000 |
| **Total** | **0.375603** |

Three parts: **A** the program, **B** the Config, **C** after (the API runbook, Day-2 legs, go-live).

---

## Part A: deploy the program

**A1. The tree is the merged one**
```
cd ~/Documents/claude/seekerhackathon/build/sprouts && git status --porcelain && git log --oneline -1
```
Expected: nothing from `git status`, then one line: the commit the coordinator named for this deploy. (After A6 you will
have edited `leash/GATES.md`; then `git status` shows ` M leash/GATES.md`. That is expected.)

**A2. Rebuild the program**
```
cd ~/Documents/claude/seekerhackathon/build/sprouts/leash && mkdir -p target && bash -c '. scripts/sbf.sh && sbf_build program/Cargo.toml target/build-leash.log quiet' && cargo test -q -p leash-tests --test golden 2>&1 | grep -E '^test result|FAILED'
```
Expected: `test result: ok. 3 passed; 0 failed; 2 ignored; ...`. A3 then checks that the rebuilt file is the tested one.

**A3. Pre-check (read-only: sends nothing)**
```
cd ~/Documents/claude/seekerhackathon/build/sprouts/leash && ./scripts/deploy-check.sh pre
```
Expected: seven `ok` lines, a cost table, `ok   ADMIN balance covers the deploy and the Config`, `PRE-CHECK PASSED`.
If you see `STOP:`:
- "differs from GATES.md's Release": the build is not the tested one. Stop.
- "already exists": if you just ran A4, the deploy may have landed: run A5. Otherwise stop.
- "could not read ... (RPC error)": wait a minute and run A3 again.

**A4. Deploy (spends about 0.357 SOL)**

This line runs A3 again first and deploys only if it passes. It sends through your Helius RPC: the address is copied from
`api/.env.local` into a private temporary settings file (never typed, never shown), any echo of it in the output is
replaced by `HIDDEN`, and the file is deleted at the end.
```
cd ~/Documents/claude/seekerhackathon/build/sprouts/leash && ./scripts/deploy-check.sh pre && (umask 077; grep -m1 '^HELIUS_RPC_URL=https' ../api/.env.local | sed 's/^HELIUS_RPC_URL=/json_rpc_url: /' > target/helius-cli.yml) && [ -s target/helius-cli.yml ] && solana -C target/helius-cli.yml program deploy target/deploy/leash.so --program-id ~/.config/solana/sprouts-leash-program.json --keypair ~/.config/solana/sprouts-admin.json --upgrade-authority ~/.config/solana/sprouts-admin.json --max-len 70000 --use-rpc --with-compute-unit-price 20000 --max-sign-attempts 50 2>&1 | sed -l -e 's#helius-rpc\.com/[^ )]*#helius-rpc.com/HIDDEN#g' -e 's/api-key=[^ )&]*/api-key=HIDDEN/g'; rm -f target/helius-cli.yml
```
Expected (a minute or a few): `PRE-CHECK PASSED`, then `Program Id: GyBmDLN72kg6xwAnZfj9c7fjeaJ3GvhkHNhFns83f8f7` and
`Signature: <sig>`. Copy the signature for A6. If nothing follows `PRE-CHECK PASSED`, `api/.env.local` has no
`HELIUS_RPC_URL`: stop and tell the coordinator.

**If A4 stops with an error (part-way):**
1. First run A5. If it says `POST-CHECK PASSED`, the deploy worked (the error was only the CLI losing track): go to A6.
2. If A5 says the program is not found, the deploy did not land. It may have printed a 12-word phrase for a temporary
   buffer: treat it like a key, do not paste it anywhere; you will not need it.
3. Close the leftover buffer (its SOL goes back to ADMIN):
   `cd ~/Documents/claude/seekerhackathon/build/sprouts/leash && solana program close --buffers --keypair ~/.config/solana/sprouts-admin.json -u mainnet-beta`
4. Run A3 (it must pass), then A4 again.
5. If A4 fails the same way twice, use the public route instead (no Helius; sends straight to the validators):
   `cd ~/Documents/claude/seekerhackathon/build/sprouts/leash && ./scripts/deploy-check.sh pre && solana program deploy target/deploy/leash.so --program-id ~/.config/solana/sprouts-leash-program.json --keypair ~/.config/solana/sprouts-admin.json --upgrade-authority ~/.config/solana/sprouts-admin.json --max-len 70000 --url mainnet-beta --with-compute-unit-price 20000 --max-sign-attempts 50`

**A5. Post-check (read-only)**
```
cd ~/Documents/claude/seekerhackathon/build/sprouts/leash && ./scripts/deploy-check.sh post
```
Expected: a block with `Authority: GrHSwzYpgiFzuTpwR6539NpNXktXNEUfVU9UYvHdDKLY` and `Data Length: 70000 (0x11170) bytes`,
then `ok   upgrade authority is ADMIN`, `ok   data length 70000 = --max-len`, `ok   on-chain program bytes = leash.so ...`,
`POST-CHECK PASSED`.

**A6. Write it down**
In `leash/GATES.md`, "Mainnet deploy record": the A4 signature and the A5 block. Or send both to the next session.

---

## Part B: install the Config

**B0. The admin script passes its tests**
```
cd ~/Documents/claude/seekerhackathon/build/sprouts/api && pnpm vitest run tests/scripts/leash-admin.test.ts 2>&1 | tail -4
```
Expected: the `Tests` line says only `passed` (no `failed`, no `skipped`). A skipped test means the golden Config
comparison did not run: stop.

**B1. Create the Config, every leg OFF (9 transactions)**
```
cd ~/Documents/claude/seekerhackathon/build/sprouts/api && pnpm tsx scripts/leash-admin.ts init --admin ~/.config/solana/sprouts-admin.json
```
Expected: nine lines, `step 1/9 init_config confirmed <sig> (371 B)`, then `step 2/9 set_leg 0 confirmed <sig> (436 B)`
up to `step 9/9 set_leg 7 confirmed <sig> (436 B)`, then `Config matches (bytes 16..1504 == encodeConfig). ...`.
If it stops (an error, or `simulation FAILED ... Stopped; rerun the same command to resume`): run the SAME line again; it
sends only the steps still missing. A rerun after success prints `nothing to do: the on-chain Config already matches`.
If it says `over Solana's 1232` or `does not equal what was planned`: stop and send the output.

**B2. Check it byte for byte (read-only)**
```
cd ~/Documents/claude/seekerhackathon/build/sprouts/leash && ./scripts/check-config.sh init
```
Expected: `chain enabled legs []; config/mainnet-init.hex enabled legs []` and
`Config matches config/mainnet-init.hex byte for byte (...)`. `MISMATCH`: stop and send the output.

**B3. Which legs turn on today: 2 (USDC on K-Lend), 6 (hSOL), 7 (cbBTC)**

This is `config/mainnet-day1.hex`. All three passed their gates in `leash/GATES.md` (cbBTC also its price-age sample:
280 s at most, under the 600 s limit). Legs 0, 1, 3, 4, 5 stay off. If the coordinator tells you one of 2, 6, 7 failed a
gate, leave it out of B4 (for example `--enable 2,6`) and in B5 run `./scripts/check-config.sh legs 2,6` instead of `day1`.

**B4. Turn on the Day-1 legs (3 transactions)**
```
cd ~/Documents/claude/seekerhackathon/build/sprouts/api && pnpm tsx scripts/leash-admin.ts set --enable 2,6,7 --admin ~/.config/solana/sprouts-admin.json
```
Expected: `step 1/3 set_leg 2 confirmed <sig> (436 B)`, `step 2/3 set_leg 6 confirmed <sig> (436 B)`,
`step 3/3 set_leg 7 confirmed <sig> (436 B)`, then `Config matches ...`. If it stops: rerun the same line.

**B5. Final check against the Day-1 file (read-only)**
```
cd ~/Documents/claude/seekerhackathon/build/sprouts/leash && ./scripts/check-config.sh day1
```
Expected: `chain enabled legs [2, 6, 7]; config/mainnet-day1.hex enabled legs [2, 6, 7]` and
`Config matches config/mainnet-day1.hex byte for byte (1488 B body, magic, version 1, bump 255, owner = leash)`.
```
cd ~/Documents/claude/seekerhackathon/build/sprouts/api && pnpm tsx scripts/leash-admin.ts show --admin ~/.config/solana/sprouts-admin.json
```
Expected: `leg 2 ON`, `leg 6 ON`, `leg 7 ON`, every other leg `off`, no `UNSET` line.

**B6. Write it down**
In `leash/GATES.md`: each leg's `set_leg` signature in its "Enabled on chain" cell (legs 2, 6, 7), and the B1 signatures in
"Mainnet deploy record". The next session commits it.

---

## Part C: after the Config

**C1. The API runbook (API plan Task 22).** Its D0 (merge and tests) already happened before Part B (B0 is part of it).
Its D5 is Part B: run only its `show` line. Then, in order: D1 (the ALT), D2-D3, D4 (migration 0008 and the API deploy;
the line refuses to start between 06:30 and 07:10 PDT), D6 (re-link one test wallet), D7 (one leashed simulation per
enabled leg). A leg without `ok=true` in D7 is turned off:
```
cd ~/Documents/claude/seekerhackathon/build/sprouts/api && pnpm tsx scripts/leash-admin.ts set --enable <the list without it> --admin ~/.config/solana/sprouts-admin.json
cd ~/Documents/claude/seekerhackathon/build/sprouts/leash && ./scripts/check-config.sh legs <that list>
```

**C2. Day 2: one more leg at a time, only when the coordinator says its gates passed**
```
cd ~/Documents/claude/seekerhackathon/build/sprouts/api && pnpm tsx scripts/leash-admin.ts set --enable 1,2,6,7 --admin ~/.config/solana/sprouts-admin.json
cd ~/Documents/claude/seekerhackathon/build/sprouts/leash && ./scripts/check-config.sh legs 1,2,6,7
```
The list is the full list that should be on. Expected: one `set_leg 1 confirmed` line, then
`on-chain Config OK: legs [1, 2, 6, 7] enabled, ...` and `test result: ok. 1 passed`. Leg 0 (SKR) is never in the list.

**C3. Go-live only (after D7 is green for every enabled leg): new puller (one transaction)**
```
cd ~/Documents/claude/seekerhackathon/build/sprouts/api && pnpm tsx scripts/leash-admin.ts set --enable <current list> --puller <NEW_PULLER_PUBKEY> --admin ~/.config/solana/sprouts-admin.json
cd ~/Documents/claude/seekerhackathon/build/sprouts/leash && ./scripts/check-config.sh legs <current list> <NEW_PULLER_PUBKEY>
```
Expected: one `step 1/1 set_header confirmed <sig>` line, then `on-chain Config OK: legs [...] enabled, puller <NEW>`.

---

## Notes for the coordinator

- **RPC for A4 (review I1):** Helius with `--use-rpc`. The URL goes by pipeline (`grep | sed`) from `api/.env.local` into a
  0600 CLI config file `leash/target/helius-cli.yml` (git-ignored, deleted at the end of the same line) read by
  `solana -C`. Not `--url "$(grep ... | cut ...)"`: this machine's secret hook blocks reading a .env value into a command
  substitution (a captured value once leaked when a program echoed its raw input), and the solana CLI cannot read the URL
  from stdin. Tested read-only: `solana -C <that file> balance` and `block-height` answered through Helius, nothing secret
  printed. Why Helius: the public `api.mainnet-beta` RPC limits requests per IP per 10 s and `--use-rpc` sends all ~70 buffer writes
  there; the TPU path (no `--use-rpc`) sends unstaked QUIC from a home connection, which leaders drop first under load.
  Leak guard: measured on this CLI, a transport error prints the full URL (`error sending request for url (...?api-key=...)`),
  so the output is piped through `sed` that rewrites `helius-rpc.com/...` and `api-key=...` to `HIDDEN` (tested on that
  error text). The URL is never in the process arguments (only the file path is). The pipe hides the
  CLI's exit code, which is why A5 is the judge of success. Fallback (A4 step 5): the public route on the TPU path. The
  Helius plan's sendTransaction rate limit is not measured; throttled writes are re-sent (`--max-sign-attempts 50`).
  `deploy-check.sh` and `leash-admin.ts` stay on the public RPC (a few reads; 9-12 sequential txs).
- Cost: the deploy writes the program into a temporary buffer (0.3358 SOL), and the deploy instruction refunds it before
  paying for the program data (read in solana-bpf-loader-program 3.1.14; a localnet deploy with the payer funded below
  buffer + program data succeeded), so ADMIN never holds out more than about 0.367 SOL. `--max-len 70000` sizes the
  program data (CLI 3.1.11's default is the exact .so size, measured); 4,072 B of headroom for a small fix costs 0.0207 SOL.
- A2 runs only the golden tests: on main the venue fixtures (git-ignored) are absent, so `scripts/test.sh` would fail there.
  The full suite passed in the leash worktree (112 passed, 3 ignored), and a fresh clone of the branch rebuilt leash.so to
  the same sha256 (3b80a294...), which A3 checks.
- Gates: legs 2, 6, 7 are enabled from their GATES rows (leg 2: Task 7 actual-deposit PASS supersedes its S2 FAIL; leg 7:
  S4 max age 280 s in `api/spikes/RESULTS.md`). Contracts 8 invariant 3 (one simulated leashed planting per enabled leg)
  can only run on an enabled leg (the program answers LegDisabled 6015 otherwise), so it gates the relink and go-live
  (API D7, D8), not the enable; a leg that fails it is turned off in C1. Legs 4, 5 also need S1; leg 1 the ORE sample;
  leg 3 is a Day-2 leg in GATES; leg 0 has no price source (R324). Nothing moves money before go-live: no delegation names
  the leash until then (contracts 8.3).
- `leash-admin.ts` exit codes: 0 matched, 1 simulation failed, 2 a tx over 1,232 B, 3 the final read differs; a send error
  (dropped tx, RPC) throws and is resumed by rerunning the same line.
- Read-only helpers: `leash/scripts/deploy-check.sh pre|post` and `leash/scripts/check-config.sh init|day1|legs <list> [puller]`.
  Both fail closed on an RPC error (the CLI labels a transport error `AccountNotFound: pubkey=...: error sending request`,
  so the probe requires the exact `Error: AccountNotFound: pubkey=<id>` line).
