-- 11-12: tokenized shares (xStocks, Ondo, Backpack Securities, PreStocks) get their own swap label instead of 'memecoin'.
-- Run BEFORE deploying the API that writes 'stock' (an insert with the old check would fail and the swap would not be booked).
alter table swaps drop constraint if exists swaps_class_check;
alter table swaps add constraint swaps_class_check check (class in ('stable', 'major', 'LST', 'stock', 'memecoin'));
