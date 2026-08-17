import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Task } from './task.entity';

export const TASK_PARTY_KINDS = ['company', 'contact'] as const;
export type TaskPartyKind = (typeof TASK_PARTY_KINDS)[number];

@Entity('task_parties')
@Index('idx_task_parties_party', ['partyKind', 'partyId'])
export class TaskParty {
  @PrimaryColumn({ name: 'task_id', type: 'int' })
  taskId: number;

  @PrimaryColumn({ name: 'party_kind', type: 'varchar', length: 16 })
  partyKind: TaskPartyKind;

  @PrimaryColumn({ name: 'party_id', type: 'int' })
  partyId: number;

  @Column({ type: 'varchar', length: 40, default: 'related' })
  role: string;

  @ManyToOne(() => Task, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Task;
}
