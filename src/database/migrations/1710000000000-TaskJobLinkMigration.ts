import { MigrationInterface, QueryRunner } from 'typeorm';

/** Canonicalizes legacy project-linked tasks to their lead job without duplicating rows. */
export class TaskJobLinkMigration1710000000000 implements MigrationInterface {
  name = 'TaskJobLinkMigration1710000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Keep the exact legacy links so a rollback never has to guess which project
    // belonged to a lead that later acquired multiple projects.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS task_job_link_migration_backup (
        task_id INTEGER PRIMARY KEY,
        entity_kind VARCHAR(20) NOT NULL,
        entity_id INTEGER NOT NULL
      )
    `);
    await queryRunner.query(`
      INSERT INTO task_job_link_migration_backup (task_id, entity_kind, entity_id)
      SELECT task.id, task.entity_kind, task.entity_id
      FROM tasks task
      JOIN projects project ON task.entity_kind = 'project' AND task.entity_id = project.id
      WHERE project.lead_id IS NOT NULL
      ON CONFLICT (task_id) DO NOTHING
    `);
    await queryRunner.query(`
      UPDATE tasks task
      SET entity_kind = 'lead', entity_id = project.lead_id
      FROM projects project
      WHERE task.entity_kind = 'project'
        AND task.entity_id = project.id
        AND project.lead_id IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE tasks task
      SET entity_kind = backup.entity_kind, entity_id = backup.entity_id
      FROM task_job_link_migration_backup backup
      WHERE task.id = backup.task_id
    `);
    await queryRunner.query('DROP TABLE IF EXISTS task_job_link_migration_backup');
  }
}
