import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type GoogleCalendarEntityKind = 'lead' | 'task';

@Entity('google_calendar_meetings')
@Index('idx_google_calendar_meetings_entity', ['entityKind', 'entityId', 'startsAt'])
export class GoogleCalendarMeeting {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id', type: 'int' })
  userId: number;

  @Column({ name: 'entity_kind', type: 'varchar', length: 8, nullable: true })
  entityKind: GoogleCalendarEntityKind | null;

  @Column({ name: 'entity_id', type: 'int', nullable: true })
  entityId: number | null;

  @Column({ name: 'google_event_id', type: 'varchar', length: 255 })
  googleEventId: string;

  @Column({ name: 'title', type: 'varchar', length: 255 })
  title: string;

  @Column({ name: 'meet_url', type: 'text', nullable: true })
  meetUrl: string | null;

  @Column({ name: 'calendar_url', type: 'text', nullable: true })
  calendarUrl: string | null;

  @Column({ name: 'starts_at', type: 'timestamptz' })
  startsAt: Date;

  @Column({ name: 'ends_at', type: 'timestamptz' })
  endsAt: Date;

  @Column({ name: 'attendees', type: 'jsonb', default: [] })
  attendees: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;
}
