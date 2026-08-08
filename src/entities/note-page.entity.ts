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

  @Column({ name: 'entity_kind', length: 20, nullable: true })
  entityKind?: string;

  @Column({ name: 'entity_id', type: 'int', nullable: true })
  entityId?: number;

  /**
   * Set on notes created after this column existed; NULL on everything older.
   * Only meaningful for privacy when entityKind is also null — see note-access.util.ts.
   */
  @Column({ name: 'owner_id', type: 'int', nullable: true })
  ownerId?: number | null;

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
