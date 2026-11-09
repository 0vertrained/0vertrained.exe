-- Oura Ring Integration Migration
-- Creates tables and RLS policies for Oura token storage and data syncing.

-- oura_tokens table
-- Stores OAuth access/refresh tokens per user. One row per user.
CREATE TABLE IF NOT EXISTS oura_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

-- RLS Policies for oura_tokens
ALTER TABLE oura_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own tokens" ON oura_tokens
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own tokens" ON oura_tokens
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tokens" ON oura_tokens
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own tokens" ON oura_tokens
  FOR DELETE USING (auth.uid() = user_id);

-- Oura tokens are server-held only. Browser clients must use /api/oura/status
-- and /api/oura/disconnect rather than selecting refresh/access tokens directly.
REVOKE ALL ON oura_tokens FROM anon, authenticated;
GRANT ALL ON oura_tokens TO service_role;

-- oura_data table
-- Stores normalized Oura data: sleep, readiness, activity, heartrate, spo2.
-- One row per user+date+data_type combination.
CREATE TABLE IF NOT EXISTS oura_data (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  data_type TEXT NOT NULL CHECK (data_type IN ('sleep', 'readiness', 'activity', 'heartrate', 'spo2')),
  payload JSONB NOT NULL,
  synced_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, date, data_type)
);

-- RLS Policies for oura_data
ALTER TABLE oura_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own data" ON oura_data
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own data" ON oura_data
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own data" ON oura_data
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own data" ON oura_data
  FOR DELETE USING (auth.uid() = user_id);

-- Grant authenticated users access and server-side service role access
GRANT ALL ON oura_data TO authenticated;
GRANT ALL ON oura_data TO service_role;

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_oura_tokens_user_id ON oura_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_oura_data_user_id ON oura_data(user_id);
CREATE INDEX IF NOT EXISTS idx_oura_data_date ON oura_data(date DESC);
CREATE INDEX IF NOT EXISTS idx_oura_data_user_date_type ON oura_data(user_id, date DESC, data_type);
