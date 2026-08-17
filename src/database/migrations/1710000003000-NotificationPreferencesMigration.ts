import { MigrationInterface, QueryRunner } from 'typeorm';

export class NotificationPreferencesMigration1710000003000 implements MigrationInterface {
  name = 'NotificationPreferencesMigration1710000003000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "notification_preferences" JSONB NOT NULL
      DEFAULT '{"assignment":"email","status":"in_app","blocked":"in_app","comment":"in_app","mention":"in_app","permit":"in_app","digest":"email","digestHour":7}'::jsonb
    `);
    await queryRunner.query(`
      UPDATE "users"
      SET "notification_preferences" = "notification_preferences" || '{"mention":"in_app"}'::jsonb
      WHERE NOT ("notification_preferences" ? 'mention')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "users" DROP COLUMN IF EXISTS "notification_preferences"');
  }
}
