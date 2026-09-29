import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type ProjectQboLinkAction = 'link' | 'unlink';

/**
 * Bitacora de vinculos proyecto <-> job de QuickBooks. Ver
 * db/add-project-qbo-link-events.sql: no hay clave foranea a proyectos a
 * proposito, la fila sobrevive al proyecto que la origino.
 */
@Entity('project_qbo_link_events')
@Index('idx_project_qbo_link_events_project_id', ['projectId', 'createdAt'])
export class ProjectQboLinkEvent {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'project_id', type: 'bigint' })
  projectId: number;

  @Column({ type: 'varchar', length: 20 })
  action: ProjectQboLinkAction;

  @Column({
    name: 'previous_qbo_customer_id',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  previousQboCustomerId?: string | null;

  @Column({
    name: 'new_qbo_customer_id',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  newQboCustomerId?: string | null;

  @Column({ name: 'project_number', type: 'varchar', length: 50, nullable: true })
  projectNumber?: string | null;

  @Column({
    name: 'job_display_name',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  jobDisplayName?: string | null;

  @Column({ name: 'actor_email', type: 'varchar', length: 255, nullable: true })
  actorEmail?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;
}
