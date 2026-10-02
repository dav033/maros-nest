/**
 * The closed vocabularies of the sales funnel.
 *
 * Their own module because both CreateLeadDto and UpdateLeadDto need them, and having the
 * update DTO (which extends the create one) own them would make the import circular.
 */

/**
 * Where the lead came from. A closed list and not free text, because the only question
 * worth asking of this column is "which channel pays for itself", and that is a GROUP BY —
 * free text turns it into manual tidying of 'Referral', 'referal' and 'Juan told them'.
 *
 * `repeat_client` is separated from `referral` on purpose: both arrive through a happy
 * customer, but one costs nothing to win and the other needs a pitch, so averaging them
 * hides the cheapest revenue in the business. `other` exists so nobody is tempted to pick
 * a wrong neighbour; a run of it is the signal to add a value here.
 */
export const LEAD_SOURCES = [
  'referral',
  'repeat_client',
  'website',
  'google',
  'social',
  'walk_in',
  'partner',
  'other',
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

/**
 * Why a deal died, in the buckets a decision can be made from: `price` and `timeline` are
 * things the company controls, `competitor` and `client_cancelled` are not, and
 * `not_qualified` means it should never have been in the pipeline at all.
 *
 * `no_response` is the honest label for a lead that simply went quiet, and it is what the
 * 27 leads sitting at a NULL status for up to 17 months should be closed out with — they
 * are not open deals, they are losses nobody recorded.
 */
export const LEAD_LOST_REASONS = [
  'price',
  'timeline',
  'scope',
  'no_response',
  'competitor',
  'client_cancelled',
  'not_qualified',
  'other',
] as const;
export type LeadLostReason = (typeof LEAD_LOST_REASONS)[number];
