-- ============================================================
-- TFHQ Laundry — Schema v2 additions
-- Run this in Supabase SQL Editor AFTER the original schema
-- ============================================================

-- Add blue/white gown breakdown to existing rows table
ALTER TABLE laundry_log_rows
  ADD COLUMN IF NOT EXISTS blue_gowns  INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS white_gowns INTEGER DEFAULT 0;

-- Add bag color to buildings (optional label, e.g. "Black", "Red", "Blue")
ALTER TABLE laundry_buildings
  ADD COLUMN IF NOT EXISTS bag_color TEXT DEFAULT '';

-- Daily extras: bags per building + repair types (one record per client per date)
CREATE TABLE IF NOT EXISTS laundry_daily_extras (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id      UUID REFERENCES laundry_clients(id) ON DELETE CASCADE NOT NULL,
  log_date       DATE NOT NULL,
  submitted_by   UUID REFERENCES auth.users(id),
  -- Bag counts stored as JSON: { "building_id": count, ... }
  bag_counts     JSONB DEFAULT '{}',
  -- Process / repair counts
  labelling      INTEGER DEFAULT 0,
  sleeve_repair  INTEGER DEFAULT 0,
  general_repair INTEGER DEFAULT 0,
  fp_inject      INTEGER DEFAULT 0,
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (client_id, log_date)
);

-- RLS
ALTER TABLE laundry_daily_extras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "extras_select" ON laundry_daily_extras FOR SELECT
  USING (has_client_access(client_id));

CREATE POLICY "extras_insert" ON laundry_daily_extras FOR INSERT
  WITH CHECK (has_client_access(client_id));

CREATE POLICY "extras_update" ON laundry_daily_extras FOR UPDATE
  USING (submitted_by = auth.uid() OR is_laundry_admin());

CREATE POLICY "extras_delete" ON laundry_daily_extras FOR DELETE
  USING (is_laundry_admin());

-- ── Optional: seed bag colors for existing Fisher & Paykel buildings ──
-- Find your building IDs first:
-- SELECT id, name FROM laundry_buildings;
-- Then run:
-- UPDATE laundry_buildings SET bag_color = 'Black' WHERE name = 'Paykel';
-- UPDATE laundry_buildings SET bag_color = 'Red'   WHERE name = 'Daniel';
-- UPDATE laundry_buildings SET bag_color = 'Blue'  WHERE name = 'Stewart';
