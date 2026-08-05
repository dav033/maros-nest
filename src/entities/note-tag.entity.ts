import { Entity, PrimaryGeneratedColumn, Column, ManyToMany } from 'typeorm';
import { NotePage } from './note-page.entity';

@Entity('note_tags')
export class NoteTag {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 50, unique: true })
  name: string;

  @Column({ length: 20, default: 'neutral' })
  color: string;

  @ManyToMany(() => NotePage, (page) => page.tags)
  pages: NotePage[];
}
