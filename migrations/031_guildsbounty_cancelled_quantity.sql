-- A refused ask records 0 copies sent, and so do the ones already answered.
--
-- `quantity` is what the owner handed over; `quantity_requested` is the ask. Until now a
-- cancellation wrote the ask into both, so a request answered "Not fulfilled" looked like a
-- handover of the number that had been asked for: the requester's history said "1", the
-- answer email said a copy was on its way, and the owner's answered table showed the ask as
-- the amount sent. The code writes 0 from here on, and this fixes the rows it already wrote.
--
-- 019 filled `quantity_requested` from `quantity` for every row that had none, so the ask
-- survives this: a row answered with nothing reads "0 of 2", not "0 of 0".
--
-- Only asks that were sent are touched. A cancellation with no `submitted_at` is a basket
-- row the person took back before asking, and it still holds the copies it was holding.
UPDATE guildsbounty_requests
   SET quantity = 0
 WHERE status IN ('cancelled', 'declined')
   AND submitted_at IS NOT NULL
   AND quantity > 0;
