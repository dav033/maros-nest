import { MigrationInterface, QueryRunner } from 'typeorm';

export class NullableGoogleCalendarMeetingEntity1790000000000 implements MigrationInterface {
  name = 'NullableGoogleCalendarMeetingEntity1790000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE google_calendar_meetings ALTER COLUMN entity_kind DROP NOT NULL',
    );
    await queryRunner.query(
      'ALTER TABLE google_calendar_meetings ALTER COLUMN entity_id DROP NOT NULL',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE google_calendar_meetings ALTER COLUMN entity_kind SET NOT NULL',
    );
    await queryRunner.query(
      'ALTER TABLE google_calendar_meetings ALTER COLUMN entity_id SET NOT NULL',
    );
  }
}
