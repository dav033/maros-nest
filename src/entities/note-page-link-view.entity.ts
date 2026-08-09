import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { NotePageLink } from './note-page-link.entity';

/**
 * One row per public read of a share link.
 *
 * `ipHash` is sha256(ip + NOTE_SHARE_IP_SALT): enough to count unique visitors, never
 * enough to recover an address. Rows are purged after 90 days by
 * NoteSharingMaintenanceCron — an audit trail nobody prunes turns into a liability.
 */
@Entity('note_page_link_views')
@Index('idx_note_page_link_views_link', ['linkId', 'viewedAt'])
export class NotePageLinkView {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'link_id', type: 'int' })
  linkId: number;

  @ManyToOne(() => NotePageLink, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'link_id' })
  link: NotePageLink;

  @CreateDateColumn({ name: 'viewed_at' })
  viewedAt: Date;

  @Column({ name: 'ip_hash', type: 'char', length: 64, nullable: true })
  ipHash?: string | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 255, nullable: true })
  userAgent?: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  referer?: string | null;
}
