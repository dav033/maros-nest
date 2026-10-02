import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { NotePage } from './note-page.entity';

export const NOTE_REFERENCE_KINDS = [
  'lead',
  'project',
  'contact',
  'company',
  'task',
  'user',
  'note',
] as const;
export type NoteReferenceKind = (typeof NOTE_REFERENCE_KINDS)[number];

/**
 * How the reference got there, which decides who is allowed to remove it.
 *
 * `inline` is derived from the document: every content save rewrites the page's inline
 * rows from the TipTap doc, so deleting an @mention really drops the reference.
 * `relation` is authored in the note header and survives content edits.
 *
 * See db/notes-references.sql for why one table carries both.
 */
export const NOTE_REFERENCE_ORIGINS = ['inline', 'relation'] as const;
export type NoteReferenceOrigin = (typeof NOTE_REFERENCE_ORIGINS)[number];

/** A typed pointer from one note to one CRM record (or to another note). */
@Entity('note_references')
@Index('idx_note_references_target', ['targetKind', 'targetId'])
export class NoteReference {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'note_page_id', type: 'int' })
  notePageId: number;

  @ManyToOne(() => NotePage, { onDelete: 'CASCADE', persistence: false })
  @JoinColumn({ name: 'note_page_id' })
  page?: NotePage;

  @Column({ name: 'target_kind', type: 'varchar', length: 16 })
  targetKind: NoteReferenceKind;

  /**
   * Intentionally unconstrained: which table it points into depends on targetKind, so
   * no foreign key can cover it. A reference therefore outlives its target, and
   * `labelSnapshot` is what keeps a deleted lead's mention readable.
   */
  @Column({ name: 'target_id', type: 'int' })
  targetId: number;

  @Column({ type: 'varchar', length: 10 })
  origin: NoteReferenceOrigin;

  /**
   * The target's name as it read when the reference was made. Reads prefer the live
   * name and fall back to this, so renaming a lead updates every chip pointing at it
   * while deleting it leaves "Acme Corp (deleted)" rather than a blank pill.
   */
  @Column({ name: 'label_snapshot', type: 'varchar', length: 255, nullable: true })
  labelSnapshot?: string | null;

  @Column({ name: 'created_by_id', type: 'int', nullable: true })
  createdById?: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
