-- ============================================================
--  MIGRATION: User settings (macro targets + supplement stack)
--  Run this in Supabase SQL Editor
-- ============================================================

-- Add settings column to profiles table
-- Stores macro targets and custom supplement stack as JSONB
alter table public.profiles
  add column if not exists settings jsonb not null default '{}'::jsonb;

-- Update existing profiles with default settings
update public.profiles
set settings = '{
  "goals": {
    "calories": 3600,
    "protein": 200,
    "carbs": 400,
    "fats": 100,
    "water": 128
  },
  "supplements": [
    "Creatine", "Whey", "Pre-WO", "Multivitamin",
    "Fish Oil", "Vitamin D", "Magnesium", "BCAAs", "Caffeine", "Electrolytes"
  ]
}'::jsonb
where settings = '{}'::jsonb;

-- ============================================================
--  DONE. User settings now stored per-user in profiles.
-- ============================================================
