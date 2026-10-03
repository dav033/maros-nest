import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Role } from './role.entity';
import { UserInvitation } from './user-invitation.entity';
import { LeadType } from '../common/enums/lead-type.enum';

/** 'external' is someone outside the company, invited to see their own work. */
export type UserType = 'internal' | 'external';

/** Lifecycle, not access: `isActive` is the flag the session guard enforces. */
export type UserStatus = 'invited' | 'active' | 'disabled';

export type NotificationChannel = 'in_app' | 'email' | 'none';
export type NotificationPreferences = {
  assignment: NotificationChannel;
  status: NotificationChannel;
  blocked: NotificationChannel;
  comment: NotificationChannel;
  mention: NotificationChannel;
  permit: NotificationChannel;
  digest: NotificationChannel;
  digestHour: number;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  assignment: 'email',
  status: 'in_app',
  blocked: 'in_app',
  comment: 'in_app',
  mention: 'in_app',
  permit: 'in_app',
  digest: 'email',
  digestHour: 7,
};

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  /** Always stored lowercased — see UsersService.normalizeEmail. */
  @Column({ length: 255, unique: true })
  email: string;

  @Column({ length: 255, nullable: true })
  name?: string;

  @Column({ length: 500, nullable: true })
  picture?: string;

  @ManyToOne(() => Role, (role) => role.users, { nullable: true })
  @JoinColumn({ name: 'role_id' })
  role: Role | null;

  /**
   * Deactivating takes effect on the user's very next request: the session
   * guard resolves the user from the database rather than trusting the JWT,
   * so there is no window where a revoked account keeps working.
   */
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'user_type', type: 'text', default: 'internal' })
  userType: UserType;

  /**
   * 'invited' until the person completes their first Google sign-in, which is where
   * resolveForRequest() flips it. Revoking access is still `isActive`, not this.
   */
  @Column({ name: 'status', type: 'text', default: 'active' })
  status: UserStatus;

  /**
   * Which company/contact this account belongs to, for external users.
   *
   * Persisted and exposed, NOT yet enforced: filtering projects and leads by these is
   * a follow-up. Setting one today scopes nothing on its own.
   */
  @Column({ name: 'scoped_company_id', type: 'int', nullable: true })
  scopedCompanyId?: number | null;

  @Column({ name: 'scoped_contact_id', type: 'int', nullable: true })
  scopedContactId?: number | null;

  /**
   * Los tipos de lead que este usuario puede ver. `null` es todos, que es el
   * valor por defecto.
   *
   * A diferencia de `scopedCompanyId` y `scopedContactId`, este si filtra: se
   * aplica en los caminos de lectura de leads y de proyectos (ver
   * request-scope.ts y applyLeadTypeScope). Un array vacio no se guarda — lo
   * rechaza un CHECK en la base —, porque "restringido a ningun tipo" es una
   * pantalla vacia indistinguible de un fallo.
   */
  @Column({ name: 'scoped_lead_types', type: 'text', array: true, nullable: true })
  scopedLeadTypes?: LeadType[] | null;

  @Column({ name: 'invited_by_id', type: 'int', nullable: true })
  invitedById?: number | null;

  @OneToMany(() => UserInvitation, (invitation) => invitation.user)
  invitations?: UserInvitation[];

  @Column({ name: 'last_login_at', type: 'timestamp', nullable: true })
  lastLoginAt?: Date | null;

  @Column({ name: 'notification_preferences', type: 'jsonb', default: DEFAULT_NOTIFICATION_PREFERENCES })
  notificationPreferences: NotificationPreferences = { ...DEFAULT_NOTIFICATION_PREFERENCES };

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
