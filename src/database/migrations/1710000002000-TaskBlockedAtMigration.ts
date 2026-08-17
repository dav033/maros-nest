import { MigrationInterface, QueryRunner } from 'typeorm';

export class TaskBlockedAtMigration1710000002000 implements MigrationInterface {
  name = 'TaskBlockedAtMigration1710000002000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "blocked_at" TIMESTAMP NULL`);
    await queryRunner.query(`
      UPDATE "tasks"
      SET "blocked_at" = COALESCE("updated_at", "created_at")
      WHERE "status" = 'blocked' AND "blocked_at" IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "blocked_at"`);
  }
}
