import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Role } from './role.entity';

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

  @Column({ name: 'last_login_at', type: 'timestamp', nullable: true })
  lastLoginAt?: Date | null;

  @Column({ name: 'notification_preferences', type: 'jsonb', default: DEFAULT_NOTIFICATION_PREFERENCES })
  notificationPreferences: NotificationPreferences = { ...DEFAULT_NOTIFICATION_PREFERENCES };

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
