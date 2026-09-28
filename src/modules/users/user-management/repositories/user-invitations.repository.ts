import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { UserInvitation } from '../../../../entities/user-invitation.entity';

/**
 * An invitation is *pending* while it has been neither accepted nor revoked. At most
 * one row per user can be in that state — a partial unique index enforces it — so this
 * is written once here and reused rather than repeated at each call site.
 */
export const PENDING_INVITATION = {
  acceptedAt: IsNull(),
  revokedAt: IsNull(),
} as const;

@Injectable()
export class UserInvitationsRepository {
  constructor(
    @InjectRepository(UserInvitation)
    private readonly repo: Repository<UserInvitation>,
  ) {}

  async findPendingByUserId(userId: number): Promise<UserInvitation | null> {
    return this.repo.findOne({ where: { userId, ...PENDING_INVITATION } });
  }

  async markAccepted(id: number, at: Date): Promise<void> {
    await this.repo.update(id, { acceptedAt: at });
  }
}
