-- ============================================================
-- TFHQ Laundry App — Schema v3 Additions
-- Run this in Supabase SQL Editor AFTER schema-v2
-- ============================================================

-- 1. Grey gowns column on log rows
ALTER TABLE laundry_log_rows
  ADD COLUMN IF NOT EXISTS grey_gowns INTEGER DEFAULT 0;

-- Update qty_packed to include grey where applicable (optional retroactive fix)
-- UPDATE laundry_log_rows SET qty_packed = COALESCE(blue_gowns,0) + COALESCE(white_gowns,0) + COALESCE(grey_gowns,0);

-- 2. Reject/repair distribution percentage per building
--    (must sum to 100 across all buildings of a client for correct distribution)
ALTER TABLE laundry_buildings
  ADD COLUMN IF NOT EXISTS reject_pct DECIMAL(5,2) DEFAULT 0;

-- Set default distribution for Fisher & Paykel buildings
-- Adjust building names to match exactly what you entered
UPDATE laundry_buildings SET reject_pct = 50 WHERE LOWER(name) = 'stewart';
UPDATE laundry_buildings SET reject_pct = 30 WHERE LOWER(name) = 'paykel';
UPDATE laundry_buildings SET reject_pct = 20 WHERE LOWER(name) = 'daniel';

-- 3. Productivity settings on the client record
ALTER TABLE laundry_clients
  ADD COLUMN IF NOT EXISTS staff_count INTEGER DEFAULT 3;
ALTER TABLE laundry_clients
  ADD COLUMN IF NOT EXISTS target_gowns_per_hour INTEGER DEFAULT 60;

-- 4. Shift tracking on daily extras
--    shift_hours  = total hours the team worked that day
--    staff_on_shift = how many staff actually worked (may differ from the client default)
ALTER TABLE laundry_daily_extras
  ADD COLUMN IF NOT EXISTS shift_hours DECIMAL(4,2);
ALTER TABLE laundry_daily_extras
  ADD COLUMN IF NOT EXISTS staff_on_shift INTEGER;

-- ============================================================
-- Verification queries (run to confirm columns exist)
-- ============================================================
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'laundry_log_rows' AND column_name = 'grey_gowns';
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'laundry_buildings' AND column_name = 'reject_pct';
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'laundry_clients' AND column_name = 'staff_count';
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'laundry_daily_extras' AND column_name = 'shift_hours';
