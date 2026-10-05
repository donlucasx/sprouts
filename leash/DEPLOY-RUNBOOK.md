# Leash program: mainnet deploy runbook (Task 9)

You run every line yourself, in your own Terminal, one line at a time, in order. Paste a line, read its output, compare it
with "Expected", then go on. If the output differs, STOP and send the coordinator the output.

What this does: puts the leash program on mainnet (upgrade authority = your ADMIN key), creates its Config account, and turns
on the Day-1 legs. None of this moves anyone's money: no delegation names the leash until the API's go-live (contracts 8.3).

## Before you start

- Keys are used by PATH only. No line prints, cats or echoes a key file. `solana-keygen pubkey` prints only the public key.
  - ADMIN (pays, upgrade authority, Config admin): `~/.config/solana/sprouts-admin.json` = `GrHSwzYpgiFzuTpwR6539NpNXktXNEUfVU9UYvHdDKLY`
  - Program address (used once, by the deploy): `~/.config/solana/sprouts-leash-program.json` = `GyBmDLN72kg6xwAnZfj9c7fjeaJ3GvhkHNhFns83f8f7`
  - Config account (no key; derived from the program): `E6Yce4hy6DHj2XoegipCStJ7xjZHdopWHMsxPtyUf5Nd` (bump 255)
- Never: `--final`, the server's puller key, Vercel, or `config/TEST-VECTOR-all-legs-NEVER-INSTALL.hex` (leg 0 SKR on).
- Money: ADMIN holds 0.6 SOL. The whole runbook spends about **0.376 SOL**, almost all of it rent that stays in the accounts:

| What | SOL |
|---|---|
| Program data account (70,045 B, from `--max-len 70000`) | 0.356479 |
| Program account (36 B) | 0.000833 |
| Config account (1,504 B) | 0.008291 |
| Fees, allowance (about 70 buffer writes, the deploy, 12 admin txs; a localnet run of the deploy used 0.0004) | 0.010000 |
| **Total** | **0.375603** |

The deploy first writes the program into a temporary buffer (0.3358 SOL), and the deploy transaction itself refunds the
buffer before it pays for the program data, so the most ADMIN holds out at one time is about 0.367 SOL. About 0.22 SOL stays.
`--max-len 70000` is set on purpose: the program data account is sized to it (4,072 B above the 65,928 B program, room for a
small fix without an extend) and its rent is fixed by it. The pre-check prints these numbers from live rent.

The steps fall in three parts:
- **Part A, the program.** Can run now.
- **Part B, the Config.** Waits on the API track: `api/scripts/leash-admin.ts` (API plan Task 13) is not written yet, and the
  coordinator must merge it (and this branch) into main first. Part B's lines name it by its planned CLI.
- **Part C, after.** The API runbook (its Task 22), Day-2 legs, the puller rotation at go-live.

---

## Part A: deploy the program (run now)

**A1. The tree is the committed one**
```
cd ~/Documents/claude/seekerhackathon/build/sprouts-leash/leash && git status --porcelain && git log --oneline -1
```
Expected: nothing from `git status`, then one line: the Task 9 runbook commit (`leash: Task 9 deploy runbook ...`).

**A2. Rebuild and retest (about 30 seconds)**
```
cd ~/Documents/claude/seekerhackathon/build/sprouts-leash/leash && ./scripts/test.sh 2>&1 | grep -E '^test result|FAILED'
```
Expected: 14 `test result: ok.` lines (112 passed and 3 ignored in all), no `FAILED`. A3 then checks the rebuilt hash.

**A3. Pre-check (read-only: sends nothing)**
```
cd ~/Documents/claude/seekerhackathon/build/sprouts-leash/leash && ./scripts/deploy-check.sh pre
```
It checks: the ADMIN key file is `GrHSwz...DKLY` and the program hard-codes it; the program key file is `GyBmDL...f8f7` and
the program declares it; `target/deploy/leash.so` has the sha256 and size on GATES.md's Release line
(`3b80a2942c10089880574b857eeffa25a58489f88688197f411ed7e86dbe65e5`, 65,928 B); nothing is deployed at the program address
yet; ADMIN has no leftover buffers; ADMIN's balance covers the table above.
Expected: seven `ok` lines, the cost table, `ok   ADMIN balance covers the deploy and the Config`, `PRE-CHECK PASSED`.
Any `STOP:` line: stop here. A different hash means the build is not the tested one. "already exists" means this runbook
is not for you (it is for the first deploy only).

**A4. Deploy (this spends about 0.357 SOL)**
```
cd ~/Documents/claude/seekerhackathon/build/sprouts-leash/leash && solana program deploy target/deploy/leash.so --program-id ~/.config/solana/sprouts-leash-program.json --keypair ~/.config/solana/sprouts-admin.json --upgrade-authority ~/.config/solana/sprouts-admin.json --max-len 70000 --url mainnet-beta --use-rpc --with-compute-unit-price 20000 --max-sign-attempts 50
```
Expected (a minute or a few): `Program Id: GyBmDLN72kg6xwAnZfj9c7fjeaJ3GvhkHNhFns83f8f7` and `Signature: <sig>`. Copy the
signature for A6.

If it stops part-way (dropped transactions, an RPC error):
- It may print a 12-word seed phrase for the temporary buffer. Treat it like a key: do not paste it anywhere. You will not
  need it, because the next line closes the buffer and returns its SOL to ADMIN.
- See the leftover buffer: `solana program show --buffers --keypair ~/.config/solana/sprouts-admin.json -u mainnet-beta`
- Close it (refund to ADMIN): `solana program close --buffers --keypair ~/.config/solana/sprouts-admin.json -u mainnet-beta`
- Then run A3 again (it must pass), then A4 again.

**A5. Post-check (read-only)**
```
cd ~/Documents/claude/seekerhackathon/build/sprouts-leash/leash && ./scripts/deploy-check.sh post
```
It prints `solana program show` for the program, then checks the authority, the data length, and downloads the on-chain
bytes to compare them with the release file.
Expected: the show block with `Authority: GrHSwzYpgiFzuTpwR6539NpNXktXNEUfVU9UYvHdDKLY` and
`Data Length: 70000 (0x11170) bytes`, then `ok   upgrade authority is ADMIN`, `ok   data length 70000 = --max-len`,
`ok   on-chain program bytes = leash.so (sha256 3b80a294...), zero-padded to 70000`, `POST-CHECK PASSED`.

**A6. Write it down**
In GATES.md, "Mainnet deploy record": the A4 signature and the A5 show block. Or send both to the next session, which commits them.

---

## Part B: install the Config (waits on the API track)

**Waits on:** API plan Task 13 (`api/scripts/leash-admin.ts`, subcommands `init`, `set --enable <legs> [--puller <pubkey>]`,
`show`, each with `--admin <keypair path>`) built, reviewed, and merged into main together with this branch. Until then
`api/scripts/leash-admin.ts` does not exist anywhere (checked 2026-10-04: no worktree has it). Do Part B the same day as
Part A if you can; nothing is at risk in between (the program refuses every planting until a Config exists).

How the script sends: one admin instruction per transaction (largest 436 B, under the 1,232 B limit), each size-checked and
simulated before it is sent; a rerun reads the chain and sends only what is still missing. It reads no `.env` file (RPC from
`--rpc <url>`, else an exported `HELIUS_RPC_URL`, else the public mainnet RPC).

**B0. The script exists and matches the golden bytes**
```
cd ~/Documents/claude/seekerhackathon/build/sprouts/api && test -f scripts/leash-admin.ts && pnpm vitest run tests/scripts/leash-admin.test.ts 2>&1 | tail -3
```
Expected: `7 passed`, and the golden Config test ran (not skipped): it proves the script encodes exactly
`leash/config/mainnet-init.hex` and `mainnet-day1.hex`. `No such file` or a skip: STOP, Part B is not ready.

**B1. Create the Config, every leg OFF (9 transactions)**
```
cd ~/Documents/claude/seekerhackathon/build/sprouts/api && pnpm tsx scripts/leash-admin.ts init --admin ~/.config/solana/sprouts-admin.json
```
Expected: `step 1/9 init_config confirmed <sig>`, then `step 2/9 set_leg 0 confirmed <sig>` up to `step 9/9 set_leg 7
confirmed <sig>`, then `Config matches`. Costs the Config rent (0.0083 SOL) plus 9 fees.
Interrupted: run the SAME line again; it sends only the missing steps. A half-done Config moves nothing (a leg never set is
refused by the program).

**B2. Check it byte for byte (read-only)**
```
cd ~/Documents/claude/seekerhackathon/build/sprouts-leash/leash && ./scripts/check-config.sh init
```
Expected: `chain enabled legs []; config/mainnet-init.hex enabled legs []` and
`Config matches config/mainnet-init.hex byte for byte (...)`. A `MISMATCH` lists which part differs: STOP and send it to
the coordinator (the API encoder differs from the program's golden body; with every leg off nothing can move).

**B3. Which legs turn on today**

The Day-1 Config is `config/mainnet-day1.hex`: legs **2 (USDC on K-Lend), 6 (hSOL), 7 (cbBTC)** on; legs 0, 1, 3, 4, 5 off.
A leg goes on only when its gates in GATES.md pass:

| Leg | Gates before B4 | State today |
|---|---|---|
| 2 USDC K-Lend | GATES row: Task 7 actual-deposit PASS (supersedes its S2 FAIL), tests, mutation, fork | PASS: turn on |
| 6 hSOL | GATES row: all PASS | PASS: turn on |
| 7 cbBTC | GATES row: all PASS; plus the S4 age sample keeps `max_age_s` 600 | PASS: max age 280 s, 280 + 60 = 340 <= 600 (API `spikes/RESULTS.md`): turn on |
| 0 SKR | no price source (R324) | never, until you decide a price source |
| 1 stORE | plus the ORE S4 sample | Day 2 |
| 3 USDC Jupiter Lend | GATES row | Day 2 (GATES: Day-2 leg) |
| 4, 5 SOL lending | plus S1 (the real SOL planting fits 1,232 B and simulates) | Day 2 |

A Day-1 leg that fails a gate is left OFF: drop it from the B4 list (for example `--enable 2,6`), and in B5 use
`./scripts/check-config.sh legs 2,6` instead of `day1`.

Every enabled leg also needs one simulated leashed planting on mainnet (contracts 8, invariant 3) before any user is
re-linked to it. That simulation can only run AFTER the leg is on (the program refuses a disabled leg, LegDisabled 6015),
so it is the API runbook's D7 (Part C); a leg that fails it is turned off again there before go-live.

**B4. Turn on the Day-1 legs (3 transactions)**
```
cd ~/Documents/claude/seekerhackathon/build/sprouts/api && pnpm tsx scripts/leash-admin.ts set --admin ~/.config/solana/sprouts-admin.json --enable 2,6,7
```
Expected: three lines, `set_leg 2 confirmed <sig>`, `set_leg 6 confirmed <sig>`, `set_leg 7 confirmed <sig>`, then
`Config matches`. Interrupted: rerun the same line.

**B5. Final check against the Day-1 file (read-only)**
```
cd ~/Documents/claude/seekerhackathon/build/sprouts-leash/leash && ./scripts/check-config.sh day1
```
Expected: `chain enabled legs [2, 6, 7]; config/mainnet-day1.hex enabled legs [2, 6, 7]` and
`Config matches config/mainnet-day1.hex byte for byte (1488 B body, magic, version 1, bump 255, owner = leash)`.
Then the script's own view:
```
cd ~/Documents/claude/seekerhackathon/build/sprouts/api && pnpm tsx scripts/leash-admin.ts show --admin ~/.config/solana/sprouts-admin.json
```
Expected: legs 2, 6, 7 enabled, the rest off, no `UNSET` leg.

**B6. Write it down**
In GATES.md: each leg's own `set_leg` signature in its "Enabled on chain" cell (legs 2, 6, 7), and the B1 signatures in
"Mainnet deploy record". The next session commits GATES.md.

---

## Part C: after the Config

**C1. The API runbook comes next.** The API plan's Task 22 runs after Parts A and B: D0 (merge and test), D1 (the ALT),
D2-D3, then D4 (migration 0008 push and the API deploy in one line, which refuses to start between 13:30 and 14:10 UTC =
06:30-07:10 PDT, the daily cron). Its D5 is Part B above: if Part B is done, run only its `show` line. Note for the
coordinator: D5's text proposes `--enable 3,6` / `2,3,6,7`; this runbook installs `mainnet-day1.hex` (2, 6, 7) only.
Then D6 (re-link one test wallet), D7 (one leashed simulation per enabled leg; a leg without `ok=true` is turned off with
`leash-admin.ts set --enable <the list without it>` and checked with `./scripts/check-config.sh legs <that list>`).

**C2. Day 2: one more leg at a time, only when its GATES row passes**
```
cd ~/Documents/claude/seekerhackathon/build/sprouts/api && pnpm tsx scripts/leash-admin.ts set --admin ~/.config/solana/sprouts-admin.json --enable 1,2,6,7
cd ~/Documents/claude/seekerhackathon/build/sprouts-leash/leash && ./scripts/check-config.sh legs 1,2,6,7
```
(The list is cumulative; the script sends one `set_leg` for the new leg only.) Expected: one `set_leg 1 confirmed <sig>`,
then `on-chain Config OK: legs [1, 2, 6, 7] enabled, puller HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd` and
`test result: ok. 1 passed`. To take a leg out, rerun with the list without it. Leg 0 (SKR) is never in the list
(`check-config.sh` refuses it).

**C3. Go-live only (after D7 is green for every enabled leg): rotate the puller (one `set_header` tx)**
```
cd ~/Documents/claude/seekerhackathon/build/sprouts/api && pnpm tsx scripts/leash-admin.ts set --admin ~/.config/solana/sprouts-admin.json --enable <current list> --puller <NEW_PULLER_PUBKEY>
cd ~/Documents/claude/seekerhackathon/build/sprouts-leash/leash && ./scripts/check-config.sh legs <current list> <NEW_PULLER_PUBKEY>
```
Expected: one `set_header confirmed <sig>` (no `set_leg`), then `on-chain Config OK: legs [...] enabled, puller <NEW>`.
Old delegations to the old puller stay valid until each user revokes (the app copy says so).

## Read-only helpers this runbook calls

- `scripts/deploy-check.sh pre|post`: keys by path (public key only), release hash vs GATES.md, nothing deployed yet, cost
  vs balance; after: authority, data length, on-chain bytes vs the release hash.
- `scripts/check-config.sh init|day1|legs <list> [puller]`: downloads the Config account to `target/config.json` and
  compares bytes 16..1504 with `config/mainnet-init.hex` / `config/mainnet-day1.hex` (plus magic, version, bump, owner),
  naming each leg that differs; `legs` runs the golden test `onchain_config_matches` for any other list.
- Both were dry-run on a local validator (2026-10-04): post-check and both Config modes green on the right accounts and red
  on a wrong data length, a wrong file, and a Day-1 body with leg 0 switched on; pre-check green on mainnet (read-only).
