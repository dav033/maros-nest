import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('google_calendar_connections')
export class GoogleCalendarConnection {
  @PrimaryColumn({ name: 'user_id', type: 'int' })
  userId: number;

  @Column({ name: 'google_email', length: 255 })
  googleEmail: string;

  @Column({ name: 'access_token', type: 'text' })
  accessToken: string;

  @Column({ name: 'refresh_token', type: 'text' })
  refreshToken: string;

  @Column({ name: 'expires_at', type: 'timestamp' })
  expiresAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}
