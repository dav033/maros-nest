-- Migration: Add phone, email, and submiz columns to companies table
-- Created: 2025-01-12
-- Description: Adds three new optional string fields to the companies table

-- Add phone column
ALTER TABLE "companies" 
ADD COLUMN IF NOT EXISTS "phone" VARCHAR(255);

-- Add email column
ALTER TABLE "companies" 
ADD COLUMN IF NOT EXISTS "email" VARCHAR(255);

-- Add submiz column
ALTER TABLE "companies" 
ADD COLUMN IF NOT EXISTS "submiz" VARCHAR(255);

-- Rollback script (if needed):
-- ALTER TABLE "companies" DROP COLUMN IF EXISTS "phone";
-- ALTER TABLE "companies" DROP COLUMN IF EXISTS "email";
-- ALTER TABLE "companies" DROP COLUMN IF EXISTS "submiz";

