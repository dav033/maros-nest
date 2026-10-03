-- Cross-reference from a CRM company to the QuickBooks *customer* it is.
--
-- TypeORM runs with synchronize: false, so these statements are applied by hand against
-- Supabase (SQL editor or psql). Safe to re-run: everything is idempotent.
--
-- WHY. `companies` could already point at a QuickBooks **vendor** (qbo_vendor_*), and the
-- counterparty creation added for the document-scan screen writes that link when it
-- creates a supplier. The other half had nowhere to go: creating a *Customer* produced a
-- company with no id at all, because putting a customer id in qbo_vendor_id would make it
-- surface in the vendor map (get_qbo_vendor_crm_map) as a vendor that does not exist.
--
-- So incoming money had no cross-reference. These three columns are that half.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS qbo_customer_id   VARCHAR(64);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS qbo_customer_name VARCHAR(255);

-- Provenance, mirroring qbo_vendor_matched_at: a link made by hand and a link made by a
-- deliberate creation are both worth being able to date later.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS qbo_customer_matched_at TIMESTAMPTZ;

-- Deliberately NOT mirrored from the vendor side:
--   * qbo_vendor_match_confidence — there is no fuzzy customer matcher. Confidence exists
--     because match_crm_companies_to_qbo_vendors ranks guesses; every customer link so far
--     is an exact, deliberate act, and a column that could only ever hold 1 is noise.
--   * qbo_vendor_last_synced_at — nothing syncs customers back from QuickBooks yet.
-- Both are one ALTER away if either of those ever exists.

-- Partial, exactly like idx_companies_qbo_vendor_id: the only question asked of this column
-- is "which company is QuickBooks customer X", and the rows without a link are most of the
-- table (112 companies, none linked at the time of writing).
CREATE INDEX IF NOT EXISTS idx_companies_qbo_customer_id
  ON companies (qbo_customer_id)
  WHERE qbo_customer_id IS NOT NULL;

COMMENT ON COLUMN companies.qbo_customer_id IS
  'QuickBooks Customer Id this company is. Separate from qbo_vendor_id: the same company can be both a customer and a supplier, and the vendor map must not see customer ids.';

-- --------------------------------------------------------------------------
-- Backfill
--
-- None. Nothing in the database records which QuickBooks customer a company is — the
-- vendor side is itself unlinked on all 112 rows — so any match would be this migration
-- guessing by name, which is the kind of invented cross-reference that then gets reported
-- on as fact. Links appear as counterparties are created or matched deliberately.
-- --------------------------------------------------------------------------
