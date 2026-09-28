import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';

/**
 * One emailed invitation to sign in with Google.
 *
 * It carries no secret: Google authenticates, so the row only records that the address
 * was expected. `expiresAt` and `revokedAt` are what close the door, and
 * POST /auth/invitations/check is the one place they are read.
 *
 * Revocation is soft (`revokedAt`) so cancelling keeps the record of who invited whom,
 * and only one row per user may be live at a time — enforced by a partial unique index
 * in db/add-user-invitations.sql.
 */
@Entity('user_invitations')
@Index('idx_user_invitations_user', ['userId'])
export class UserInvitation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id', type: 'int' })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE', persistence: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** The address the message actually went to; users.email may change later. */
  @Column({ length: 255 })
  email: string;

  @Column({ name: 'expires_at', type: 'timestamp' })
  expiresAt: Date;

  @Column({ name: 'accepted_at', type: 'timestamp', nullable: true })
  acceptedAt?: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamp', nullable: true })
  revokedAt?: Date | null;

  @Column({ name: 'invited_by_id', type: 'int', nullable: true })
  invitedById?: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
