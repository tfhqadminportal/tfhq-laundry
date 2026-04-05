-- ============================================================
-- TFHQ Laundry Processing App — Supabase Schema
-- Run this in your Supabase SQL Editor
-- ============================================================

-- ─── Enable UUID extension ──────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Profiles (extends auth.users) ─────────────────────────
CREATE TABLE IF NOT EXISTS laundry_profiles (
  id          UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email       TEXT,
  full_name   TEXT,
  role        TEXT DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_laundry_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO laundry_profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_laundry ON auth.users;
CREATE TRIGGER on_auth_user_created_laundry
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_laundry_user();

-- ─── Clients (Facilities) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS laundry_clients (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name           TEXT NOT NULL,
  contact_name   TEXT,
  contact_email  TEXT,
  contact_phone  TEXT,
  address        TEXT,
  notes          TEXT,
  active         BOOLEAN DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Buildings (within Clients) ─────────────────────────────
CREATE TABLE IF NOT EXISTS laundry_buildings (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id   UUID REFERENCES laundry_clients(id) ON DELETE CASCADE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  active      BOOLEAN DEFAULT true,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Staff → Client Access ───────────────────────────────────
CREATE TABLE IF NOT EXISTS laundry_staff_access (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  client_id   UUID REFERENCES laundry_clients(id) ON DELETE CASCADE NOT NULL,
  UNIQUE (staff_id, client_id)
);

-- ─── Gown Sizes (per client, with fallback global defaults) ──
CREATE TABLE IF NOT EXISTS laundry_sizes (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id   UUID REFERENCES laundry_clients(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  sort_order  INTEGER DEFAULT 0,
  active      BOOLEAN DEFAULT true
  -- client_id NULL means it's a global default size
);

-- Insert global default sizes
INSERT INTO laundry_sizes (client_id, label, sort_order) VALUES
  (NULL, 'XS',  1),
  (NULL, 'M',   2),
  (NULL, 'XL',  3),
  (NULL, '3XL', 4),
  (NULL, '5XL', 5),
  (NULL, '7XL', 6),
  (NULL, '9XL', 7)
ON CONFLICT DO NOTHING;

-- ─── Laundry Logs (one per building per day) ─────────────────
CREATE TABLE IF NOT EXISTS laundry_logs (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id     UUID REFERENCES laundry_clients(id) ON DELETE CASCADE NOT NULL,
  building_id   UUID REFERENCES laundry_buildings(id) ON DELETE CASCADE NOT NULL,
  log_date      DATE NOT NULL,
  submitted_by  UUID REFERENCES auth.users(id),
  notes         TEXT,
  status        TEXT DEFAULT 'submitted' CHECK (status IN ('draft', 'submitted', 'reviewed')),
  total_packed  INTEGER GENERATED ALWAYS AS (0) STORED,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (building_id, log_date)
);

-- Drop the generated column since Postgres can't make it dynamic here
-- We'll compute totals in the app
ALTER TABLE laundry_logs DROP COLUMN IF EXISTS total_packed;
ALTER TABLE laundry_logs ADD COLUMN total_packed INTEGER DEFAULT 0;

-- ─── Log Rows (per size data within each log) ────────────────
CREATE TABLE IF NOT EXISTS laundry_log_rows (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  log_id       UUID REFERENCES laundry_logs(id) ON DELETE CASCADE NOT NULL,
  size_label   TEXT NOT NULL,
  sort_order   INTEGER DEFAULT 0,
  qty_packed   INTEGER DEFAULT 0,
  ink_stain    INTEGER DEFAULT 0,
  large_holes  INTEGER DEFAULT 0,
  to_repair    INTEGER DEFAULT 0
);

-- ─── Row Level Security ──────────────────────────────────────
ALTER TABLE laundry_profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE laundry_clients      ENABLE ROW LEVEL SECURITY;
ALTER TABLE laundry_buildings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE laundry_staff_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE laundry_sizes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE laundry_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE laundry_log_rows     ENABLE ROW LEVEL SECURITY;

-- Helper function: is the current user an admin?
CREATE OR REPLACE FUNCTION is_laundry_admin()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM laundry_profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- Helper function: does current user have access to a client?
CREATE OR REPLACE FUNCTION has_client_access(p_client_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT is_laundry_admin() OR EXISTS (
    SELECT 1 FROM laundry_staff_access
    WHERE staff_id = auth.uid() AND client_id = p_client_id
  );
$$;

-- Profiles: users can read their own; admins can read all
CREATE POLICY "profiles_select" ON laundry_profiles FOR SELECT
  USING (id = auth.uid() OR is_laundry_admin());
CREATE POLICY "profiles_update" ON laundry_profiles FOR UPDATE
  USING (id = auth.uid() OR is_laundry_admin());
CREATE POLICY "profiles_insert" ON laundry_profiles FOR INSERT
  WITH CHECK (true);

-- Clients: admins can manage, staff can read if assigned
CREATE POLICY "clients_select" ON laundry_clients FOR SELECT
  USING (has_client_access(id));
CREATE POLICY "clients_all_admin" ON laundry_clients FOR ALL
  USING (is_laundry_admin());

-- Buildings: same as clients
CREATE POLICY "buildings_select" ON laundry_buildings FOR SELECT
  USING (has_client_access(client_id));
CREATE POLICY "buildings_all_admin" ON laundry_buildings FOR ALL
  USING (is_laundry_admin());

-- Staff access: admins manage, staff see own
CREATE POLICY "staff_access_select" ON laundry_staff_access FOR SELECT
  USING (staff_id = auth.uid() OR is_laundry_admin());
CREATE POLICY "staff_access_all_admin" ON laundry_staff_access FOR ALL
  USING (is_laundry_admin());

-- Sizes: readable by all authenticated users
CREATE POLICY "sizes_select" ON laundry_sizes FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "sizes_all_admin" ON laundry_sizes FOR ALL USING (is_laundry_admin());

-- Logs: staff can insert/select if they have client access; admins can do all
CREATE POLICY "logs_select" ON laundry_logs FOR SELECT
  USING (has_client_access(client_id));
CREATE POLICY "logs_insert" ON laundry_logs FOR INSERT
  WITH CHECK (has_client_access(client_id));
CREATE POLICY "logs_update_own" ON laundry_logs FOR UPDATE
  USING (submitted_by = auth.uid() OR is_laundry_admin());
CREATE POLICY "logs_delete_admin" ON laundry_logs FOR DELETE
  USING (is_laundry_admin());

-- Log rows: follows logs policy
CREATE POLICY "log_rows_select" ON laundry_log_rows FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM laundry_logs l
    WHERE l.id = log_id AND has_client_access(l.client_id)
  ));
CREATE POLICY "log_rows_insert" ON laundry_log_rows FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM laundry_logs l
    WHERE l.id = log_id AND has_client_access(l.client_id)
  ));
CREATE POLICY "log_rows_update" ON laundry_log_rows FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM laundry_logs l
    WHERE l.id = log_id AND (l.submitted_by = auth.uid() OR is_laundry_admin())
  ));
CREATE POLICY "log_rows_delete" ON laundry_log_rows FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM laundry_logs l
    WHERE l.id = log_id AND (l.submitted_by = auth.uid() OR is_laundry_admin())
  ));

-- ─── Seed: Fisher & Paykel Client ────────────────────────────
-- Run separately after creating your first admin user:
/*
INSERT INTO laundry_clients (name, contact_name, notes) VALUES
  ('Fisher & Paykel Healthcare', 'Site Manager', 'Main laundry client');

-- Then grab the client ID and insert buildings:
INSERT INTO laundry_buildings (client_id, name, sort_order) VALUES
  ('<client_id>', 'Paykel',  1),
  ('<client_id>', 'Daniel',  2),
  ('<client_id>', 'Stewart', 3);
*/
