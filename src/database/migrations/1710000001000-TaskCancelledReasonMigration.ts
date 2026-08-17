import { MigrationInterface, QueryRunner } from 'typeorm';

export class TaskCancelledReasonMigration1710000001000 implements MigrationInterface {
  name = 'TaskCancelledReasonMigration1710000001000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS cancelled_reason TEXT');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE tasks DROP COLUMN IF EXISTS cancelled_reason');
  }
}
