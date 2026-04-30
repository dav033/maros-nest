import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('qbo_connections')
export class QboConnection {
  @PrimaryColumn({ name: 'realm_id', type: 'varchar', length: 50 })
  realmId: string;

  /** Stored AES-256-GCM encrypted. Use TokenCryptoService to read/write. */
  @Column({ name: 'access_token', type: 'text' })
  accessToken: string;

  /** Stored AES-256-GCM encrypted. Rotates on every refresh — always overwrite. */
  @Column({ name: 'refresh_token', type: 'text' })
  refreshToken: string;

  @Index('idx_qbo_connections_expires_at')
  @Column({ name: 'expires_at', type: 'timestamp' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}
