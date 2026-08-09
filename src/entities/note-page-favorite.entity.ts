import {
  Entity,
  PrimaryColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { NotePage } from './note-page.entity';
import { User } from './user.entity';

/**
 * Favorites are per user. note_pages.is_favorite used to be a single shared flag, so
 * one person starring a note starred it for the whole team — see
 * db/notes-workspace-upgrade.sql for the migration that split it out.
 */
@Entity('note_page_favorites')
@Index('idx_note_page_favorites_user', ['userId'])
export class NotePageFavorite {
  @PrimaryColumn({ name: 'note_page_id', type: 'int' })
  notePageId: number;

  @PrimaryColumn({ name: 'user_id', type: 'int' })
  userId: number;

  @ManyToOne(() => NotePage, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'note_page_id' })
  page: NotePage;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
