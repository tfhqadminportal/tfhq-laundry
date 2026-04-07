-- ============================================================
-- TFHQ Laundry App — Schema v4 Additions
-- Run this in Supabase SQL Editor AFTER schema-v3
-- ============================================================

-- 1. Update role constraint to include 'accounts' role
ALTER TABLE laundry_profiles DROP CONSTRAINT IF EXISTS laundry_profiles_role_check;
ALTER TABLE laundry_profiles
  ADD CONSTRAINT laundry_profiles_role_check
  CHECK (role IN ('admin', 'staff', 'accounts'));

-- 2. Pricing items catalogue
--    Used by the Accounts panel to drive Xero quote generation.
CREATE TABLE IF NOT EXISTS laundry_pricing_items (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  unit        TEXT NOT NULL DEFAULT 'per item',
  unit_price  NUMERIC(10,2) NOT NULL DEFAULT 0,
  sort_order  INTEGER DEFAULT 0,
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 3. RLS
ALTER TABLE laundry_pricing_items ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read active pricing items
CREATE POLICY "pricing_select" ON laundry_pricing_items FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Admins AND accounts-role users can manage pricing items
CREATE POLICY "pricing_insert" ON laundry_pricing_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM laundry_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'accounts')
    )
  );

CREATE POLICY "pricing_update" ON laundry_pricing_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM laundry_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'accounts')
    )
  );

CREATE POLICY "pricing_delete" ON laundry_pricing_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM laundry_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'accounts')
    )
  );

-- 4. Seed default pricing items matching the Xero invoice structure
--    (safe to re-run — uses ON CONFLICT DO NOTHING)
INSERT INTO laundry_pricing_items (name, description, unit, unit_price, sort_order) VALUES
  ('Laundry',               'Gown laundering per item — includes laundered rejects and repairs',  'per gown',   1.35,   1),
  ('Repairs',               'General garment repair charge per item',                              'per item',   5.50,   2),
  ('Garment Labelling',     'Labelling service per label applied',                                 'per label',  3.65,   3),
  ('Sleeve Repair',         'Sleeve repair service per item',                                      'per item',   7.93,   4),
  ('Reject Gowns Disposal', 'Flat monthly fee for reject gown disposal/injection',                 'flat fee', 360.00,   5),
  ('Linen Bags',            'Linen bag charge per bag used',                                       'per bag',    0.95,   6)
ON CONFLICT DO NOTHING;

-- ============================================================
-- Verification
-- ============================================================
-- SELECT * FROM laundry_pricing_items ORDER BY sort_order;
-- SELECT DISTINCT role FROM laundry_profiles;
