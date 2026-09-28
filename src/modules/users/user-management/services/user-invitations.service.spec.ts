import { UserInvitationsService } from './user-invitations.service';
import { User } from '../../../../entities/user.entity';
import { UserInvitation } from '../../../../entities/user-invitation.entity';

const DAY_MS = 24 * 60 * 60 * 1000;

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 7,
    email: 'client@example.com',
    isActive: true,
    status: 'invited',
    ...overrides,
  } as User;
}

function makeInvitation(overrides: Partial<UserInvitation> = {}): UserInvitation {
  return {
    id: 1,
    userId: 7,
    email: 'client@example.com',
    expiresAt: new Date(Date.now() + DAY_MS),
    acceptedAt: null,
    revokedAt: null,
    ...overrides,
  } as UserInvitation;
}

/** Only the two repositories the admission check reads are wired up. */
function makeService(user: User | null, invitation: UserInvitation | null = null) {
  const usersRepo = { findByEmail: jest.fn().mockResolvedValue(user) };
  const invitationsRepo = {
    findLatestByEmail: jest.fn().mockResolvedValue(invitation),
  };
  const service = new UserInvitationsService(
    undefined as never,
    usersRepo as never,
    undefined as never,
    invitationsRepo as never,
    undefined as never,
  );
  return { service, usersRepo, invitationsRepo };
}

/**
 * POST /auth/invitations/check is the only thing standing between a verified Google
 * account and a session, so every state of an invitation is pinned down here.
 */
describe('UserInvitationsService.checkAccess', () => {
  it('lets in an invited account whose invitation is still live', async () => {
    const { service } = makeService(makeUser(), makeInvitation());

    await expect(service.checkAccess('client@example.com')).resolves.toEqual({
      allowed: true,
      userId: 7,
      status: 'invited',
    });
  });

  it('refuses an expired invitation, and says that is why', async () => {
    const { service } = makeService(
      makeUser(),
      makeInvitation({ expiresAt: new Date(Date.now() - DAY_MS) }),
    );

    await expect(service.checkAccess('client@example.com')).resolves.toEqual({
      allowed: false,
      userId: 7,
      status: 'invited',
      reason: 'expired',
    });
  });

  it('reports a cancelled invitation as revoked, not as a disabled account', async () => {
    // revoke() deactivates the account as well, so the invitation row is the only thing
    // that tells the two apart.
    const { service } = makeService(
      makeUser({ isActive: false, status: 'disabled' }),
      makeInvitation({ revokedAt: new Date() }),
    );

    await expect(service.checkAccess('client@example.com')).resolves.toEqual({
      allowed: false,
      userId: 7,
      status: 'disabled',
      reason: 'revoked',
    });
  });

  it('reports an account somebody turned off as disabled', async () => {
    const { service } = makeService(
      makeUser({ isActive: false, status: 'disabled' }),
      makeInvitation({ acceptedAt: new Date() }),
    );

    await expect(service.checkAccess('client@example.com')).resolves.toEqual({
      allowed: false,
      userId: 7,
      status: 'disabled',
      reason: 'disabled',
    });
  });

  it('lets in a user who already accepted, without reading the invitation again', async () => {
    const { service, invitationsRepo } = makeService(makeUser({ status: 'active' }));

    await expect(service.checkAccess('client@example.com')).resolves.toEqual({
      allowed: true,
      userId: 7,
      status: 'active',
    });
    expect(invitationsRepo.findLatestByEmail).not.toHaveBeenCalled();
  });

  it('refuses an accepted invitation while the account still reads as invited', async () => {
    const { service } = makeService(
      makeUser(),
      makeInvitation({ acceptedAt: new Date() }),
    );

    await expect(service.checkAccess('client@example.com')).resolves.toEqual({
      allowed: false,
      userId: 7,
      status: 'invited',
      reason: 'not_invited',
    });
  });

  it('refuses an unknown address without naming a user', async () => {
    const { service, usersRepo } = makeService(null);

    await expect(service.checkAccess('  Stranger@Example.com ')).resolves.toEqual({
      allowed: false,
      reason: 'not_invited',
    });
    expect(usersRepo.findByEmail).toHaveBeenCalledWith('stranger@example.com');
  });
});
