-- R137 (2026-10-01): the pins an Undo creates hold the manager's previous split still; they are not the user's choice. The undo
-- marks them, and a save that turns the Yield Manager back on clears marked pins, so the manager is free again. Pins the user set
-- by hand stay, and any save that carries pins clears the mark. Service role only under RLS, like every table (0002).
alter table rules add column pins_by_undo boolean not null default false;
