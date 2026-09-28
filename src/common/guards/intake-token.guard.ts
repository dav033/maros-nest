import { sharedSecretGuard } from './shared-secret.guard';

/**
 * Shared-secret auth for machine callers that cannot carry a session cookie
 * (lead intake from external automations / web forms).
 *
 * Routes using this must also be marked @Public() so the session guard lets
 * them through — @Public() alone would leave them wide open.
 */
export const IntakeTokenGuard = sharedSecretGuard('LEAD_INTAKE_TOKEN');
