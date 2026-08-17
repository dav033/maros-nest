import { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds the task templates, dependencies, saved views and party links used by the task workspace. */
export class TaskBusinessPrimitivesMigration1710000004000 implements MigrationInterface {
  name = 'TaskBusinessPrimitivesMigration1710000004000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS task_templates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        project_type VARCHAR(80),
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS task_template_items (
        id SERIAL PRIMARY KEY,
        template_id INT NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        kind VARCHAR(24) NOT NULL DEFAULT 'general',
        priority VARCHAR(10) NOT NULL DEFAULT 'normal',
        offset_days INT NOT NULL DEFAULT 0,
        position INT NOT NULL DEFAULT 0
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_task_templates_project_type ON task_templates(project_type)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_task_template_items_template ON task_template_items(template_id, position)');

    await queryRunner.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_rule VARCHAR(120)');
    await queryRunner.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_until DATE');
    await queryRunner.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimated_hours NUMERIC(8,2)');
    await queryRunner.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS actual_hours NUMERIC(8,2) NOT NULL DEFAULT 0');
    await queryRunner.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS started_at TIMESTAMP');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_tasks_schedule ON tasks(start_date, due_date)');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS task_dependencies (
        task_id INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        depends_on_task_id INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        PRIMARY KEY (task_id, depends_on_task_id),
        CONSTRAINT task_dependencies_no_self CHECK (task_id <> depends_on_task_id)
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_task_dependencies_blocker ON task_dependencies(depends_on_task_id)');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS task_saved_views (
        id SERIAL PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        owner_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        shared BOOLEAN NOT NULL DEFAULT FALSE,
        state JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_task_saved_views_owner ON task_saved_views(owner_id, name)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_task_saved_views_shared ON task_saved_views(shared, name)');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS task_parties (
        task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        party_kind VARCHAR(16) NOT NULL CHECK (party_kind IN ('company', 'contact')),
        party_id INTEGER NOT NULL,
        role VARCHAR(40) NOT NULL DEFAULT 'related',
        PRIMARY KEY (task_id, party_kind, party_id)
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_task_parties_party ON task_parties(party_kind, party_id)');

    await queryRunner.query(`
      INSERT INTO task_templates (name, project_type)
      SELECT seed.name, seed.project_type
      FROM (VALUES
        ('Techo nuevo', 'Roofing'),
        ('Remodelación de baño', 'Construction'),
        ('Cerca', 'Fence'),
        ('Reclamo de restauración', 'Restoration')
      ) AS seed(name, project_type)
      WHERE NOT EXISTS (
        SELECT 1 FROM task_templates existing WHERE existing.name = seed.name
      )
    `);
    await queryRunner.query(`
      INSERT INTO task_template_items (template_id, title, kind, priority, offset_days, position)
      SELECT t.id, item.title, item.kind, item.priority, item.offset_days, item.position
      FROM task_templates t
      JOIN (VALUES
        ('Techo nuevo', 'Visita de sitio', 'site_visit', 'high', 0, 0),
        ('Techo nuevo', 'Permiso de obra', 'permit', 'normal', 2, 1),
        ('Techo nuevo', 'Ordenar materiales', 'material_order', 'normal', 4, 2),
        ('Remodelación de baño', 'Inspección inicial', 'inspection', 'high', 0, 0),
        ('Remodelación de baño', 'Ordenar materiales', 'material_order', 'normal', 3, 1),
        ('Cerca', 'Medir perímetro', 'site_visit', 'high', 0, 0),
        ('Cerca', 'Enviar presupuesto', 'estimate', 'normal', 2, 1),
        ('Reclamo de restauración', 'Inspección de daños', 'inspection', 'urgent', 0, 0),
        ('Reclamo de restauración', 'Seguimiento con aseguradora', 'follow_up', 'normal', 3, 1)
      ) AS item(template_name, title, kind, priority, offset_days, position)
        ON item.template_name = t.name
      WHERE NOT EXISTS (
        SELECT 1 FROM task_template_items existing WHERE existing.template_id = t.id
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS task_parties');
    await queryRunner.query('DROP TABLE IF EXISTS task_saved_views');
    await queryRunner.query('DROP TABLE IF EXISTS task_dependencies');
    await queryRunner.query('DROP TABLE IF EXISTS task_template_items');
    await queryRunner.query('DROP TABLE IF EXISTS task_templates');
  }
}
