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

/**
 * A published, read-only URL for one note page.
 *
 * The token itself is never stored: `tokenHash` holds its SHA-256 and the raw value is
 * returned exactly once, when the link is created or rotated. A leaked database backup
 * therefore hands nobody a working link.
 *
 * Revocation is soft (`revokedAt`) so the record of who published what — and the view
 * audit hanging off it — survives unpublishing.
 */
@Entity('note_page_links')
@Index('idx_note_page_links_page', ['notePageId'])
export class NotePageLink {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'note_page_id', type: 'int' })
  notePageId: number;

  @ManyToOne(() => NotePage, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'note_page_id' })
  page: NotePage;

  @Column({ name: 'token_hash', type: 'char', length: 64 })
  tokenHash: string;

  /** First characters of the token, so the UI can tell two links apart safely. */
  @Column({ name: 'token_hint', type: 'varchar', length: 8 })
  tokenHint: string;

  /** scrypt digest; NULL means the link opens without a password. */
  @Column({ name: 'password_hash', type: 'text', nullable: true })
  passwordHash?: string | null;

  /** Publishing a folder is an explicit act over everything inside it. */
  @Column({ name: 'include_children', type: 'boolean', default: false })
  includeChildren: boolean;

  /** Off by default: a published quote has no business ranking in Google. */
  @Column({ name: 'allow_indexing', type: 'boolean', default: false })
  allowIndexing: boolean;

  @Column({ name: 'show_author', type: 'boolean', default: true })
  showAuthor: boolean;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt?: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamp', nullable: true })
  revokedAt?: Date | null;

  @Column({ name: 'view_count', type: 'int', default: 0 })
  viewCount: number;

  @Column({ name: 'last_viewed_at', type: 'timestamp', nullable: true })
  lastViewedAt?: Date | null;

  @Column({ name: 'created_by_id', type: 'int', nullable: true })
  createdById?: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL', persistence: false })
  @JoinColumn({ name: 'created_by_id' })
  createdBy?: User | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
