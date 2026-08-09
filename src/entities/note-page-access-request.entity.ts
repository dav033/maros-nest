import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { NotePage } from './note-page.entity';
import { User } from './user.entity';

export type NoteAccessRequestStatus = 'pending' | 'granted' | 'denied';

/**
 * "I can see this note exists but can't edit it — let me in."
 *
 * Only reachable for notes the requester can already read, so it never doubles as a way
 * to probe for notes they cannot see: a note they have no access to answers 404 long
 * before this table is consulted.
 */
@Entity('note_page_access_requests')
@Index('idx_note_access_requests_page', ['notePageId', 'status'])
export class NotePageAccessRequest {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'note_page_id', type: 'int' })
  notePageId: number;

  @ManyToOne(() => NotePage, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'note_page_id' })
  page: NotePage;

  @Column({ name: 'user_id', type: 'int' })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE', persistence: false })
  @JoinColumn({ name: 'user_id' })
  user?: User | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  message?: string | null;

  @Column({ type: 'varchar', length: 10, default: 'pending' })
  status: NoteAccessRequestStatus;

  @Column({ name: 'resolved_by_id', type: 'int', nullable: true })
  resolvedById?: number | null;

  @Column({ name: 'resolved_at', type: 'timestamp', nullable: true })
  resolvedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
