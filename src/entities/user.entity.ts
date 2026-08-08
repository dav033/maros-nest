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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
