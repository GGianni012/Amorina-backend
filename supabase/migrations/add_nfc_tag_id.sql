-- Migration: Add NFC tag ID to citizens table
-- Run this in the Supabase SQL Editor

-- Add unique NFC tag ID column
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS nfc_tag_id TEXT UNIQUE;

-- Index for fast lookups by NFC tag
CREATE INDEX IF NOT EXISTS idx_citizens_nfc_tag ON citizens(nfc_tag_id);

-- Add name column if not present (needed for POS display)
-- ALTER TABLE citizens ADD COLUMN IF NOT EXISTS name TEXT;
