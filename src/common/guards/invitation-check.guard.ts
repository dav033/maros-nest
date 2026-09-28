import { sharedSecretGuard } from './shared-secret.guard';

/**
 * Shared-secret auth for the Next.js Google callback, which asks whether an address may
 * sign in *before* it has a session to authenticate with.
 *
 * Its own secret, not the lead-intake one: the two callers are unrelated, and a leaked
 * intake token must not also let anyone enumerate who has access.
 *
 * Routes using this must also be marked @Public() so the session guard lets them
 * through — @Public() alone would leave them wide open.
 */
export const InvitationCheckGuard = sharedSecretGuard('AUTH_INVITATION_CHECK_TOKEN');
