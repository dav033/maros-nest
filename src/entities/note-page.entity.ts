import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  ManyToMany,
  JoinColumn,
  JoinTable,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { NoteTag } from './note-tag.entity';
import { User } from './user.entity';

export type NotePageKind = 'page' | 'folder';

@Entity('note_pages')
@Index('idx_note_pages_parent', ['parent'])
@Index('idx_note_pages_entity', ['entityKind', 'entityId'])
export class NotePage {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => NotePage, (page) => page.children, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'parent_id' })
  parent: NotePage | null;

  @OneToMany(() => NotePage, (page) => page.parent)
  children: NotePage[];

  /** Folders group pages and carry no document of their own. */
  @Column({ type: 'varchar', length: 10, default: 'page' })
  kind: NotePageKind;

  @Column({ length: 255, default: 'Untitled' })
  title: string;

  @Column({ length: 50, nullable: true })
  icon?: string;

  @Column({ type: 'jsonb', default: {} })
  content: Record<string, unknown>;

  @Column({ name: 'content_text', type: 'text', nullable: true })
  contentText?: string;

  @Column({ type: 'int', default: 0 })
  position: number;

  @Column({ name: 'is_favorite', type: 'boolean', default: false })
  isFavorite: boolean;

  // Nullable rather than optional: unlinking a note has to write a real NULL, and
  // TypeORM reads `undefined` on save as "leave this column alone". `type` has to be
  // explicit — a `string | null` property reflects as Object, which TypeORM rejects.
  @Column({ name: 'entity_kind', type: 'varchar', length: 20, nullable: true })
  entityKind?: string | null;

  @Column({ name: 'entity_id', type: 'int', nullable: true })
  entityId?: number | null;

  /**
   * Set on notes created after this column existed; NULL on everything older.
   * Only meaningful for privacy when entityKind is also null — see note-access.util.ts.
   */
  @Column({ name: 'owner_id', type: 'int', nullable: true })
  ownerId?: number | null;

  @Column({ name: 'created_by_id', type: 'int', nullable: true })
  createdById?: number | null;

  /**
   * Stamped by title/icon and content writes only. Marking a favorite or reordering
   * the tree is not "editing the note", so those leave it alone.
   */
  @Column({ name: 'last_edited_by_id', type: 'int', nullable: true })
  lastEditedById?: number | null;

  /**
   * Read-only view of last_edited_by_id, joined in for the editor's name.
   * `persistence: false` keeps writes going exclusively through the column above —
   * with both mapped to the same FK, a stale loaded relation would otherwise win
   * and undo the stamp.
   */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL', persistence: false })
  @JoinColumn({ name: 'last_edited_by_id' })
  lastEditedBy?: User | null;

  @Column({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt?: Date | null;

  @Column({ name: 'trashed_root_id', type: 'int', nullable: true })
  trashedRootId?: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToMany(() => NoteTag, (tag) => tag.pages)
  @JoinTable({
    name: 'note_page_tags',
    joinColumn: { name: 'note_page_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'note_tag_id', referencedColumnName: 'id' },
  })
  tags: NoteTag[];
}
