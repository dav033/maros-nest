-- Migration: Add in_review column to leads table
-- Description: Adds a boolean column 'in_review' with default value false to the leads table

ALTER TABLE leads
ADD COLUMN IF NOT EXISTS in_review BOOLEAN NOT NULL DEFAULT false;

-- Add comment to the column for documentation
COMMENT ON COLUMN leads.in_review IS 'Indicates whether the lead is currently under review';


