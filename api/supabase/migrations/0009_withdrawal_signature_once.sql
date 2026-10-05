-- K-I4 (final audit 10-04): one basket row per unstake signature. Two posts of the same signed unstake raced past the
-- "one basket at a time" read and both inserted; the reconcile then subtracted the shares twice and booked a phantom own-stake.
-- The confirm route treats a conflict as "already recorded" and answers from the existing row. Wallet-source rows have no
-- signature (null) and are not constrained. Push with 0008, BEFORE the API deploy. Pre-check (must return no rows):
--   select unstake_signature, count(*) from withdrawals where unstake_signature is not null group by 1 having count(*) > 1;
create unique index if not exists withdrawals_unstake_signature_once on withdrawals (unstake_signature) where unstake_signature is not null;
