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

/** Who a grant is addressed to. Roles let "everyone in Operations" be one row. */
export type NoteShareSubjectType = 'user' | 'role';

/**
 * Ordered least to most capable. `commenter` is modelled from day one but behaves
 * exactly like `viewer` until the comments UI exists — a declared gap beats a phase
 * that keeps growing.
 */
export type NoteShareAccess = 'viewer' | 'commenter' | 'editor';

/**
 * An explicit grant of one note page (and its whole subtree) to one user or role.
 *
 * subject_id is polymorphic, so it carries no foreign key — see db/notes-sharing.sql.
 * NoteSharingMaintenanceCron sweeps rows whose subject was deleted; in the meantime the
 * join finds nothing and access fails closed, which is the safe direction.
 */
@Entity('note_page_shares')
@Index('idx_note_page_shares_subject', ['subjectType', 'subjectId'])
export class NotePageShare {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'note_page_id', type: 'int' })
  notePageId: number;

  @ManyToOne(() => NotePage, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'note_page_id' })
  page: NotePage;

  @Column({ name: 'subject_type', type: 'varchar', length: 10 })
  subjectType: NoteShareSubjectType;

  @Column({ name: 'subject_id', type: 'int' })
  subjectId: number;

  @Column({ type: 'varchar', length: 10 })
  access: NoteShareAccess;

  @Column({ name: 'granted_by_id', type: 'int', nullable: true })
  grantedById?: number | null;

  /**
   * Read-only view of granted_by_id for the share dialog's "granted by" line.
   * `persistence: false` for the same reason as NotePage.lastEditedBy: with both mapped
   * to one FK, a stale loaded relation would win over the column write.
   */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL', persistence: false })
  @JoinColumn({ name: 'granted_by_id' })
  grantedBy?: User | null;

  /** NULL means the grant does not expire. */
  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
