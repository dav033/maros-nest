import { MigrationInterface, QueryRunner } from "typeorm";

export class AddNotesToProjects1735689600000 implements MigrationInterface {
    name = 'AddNotesToProjects1735689600000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Agregar la columna notes a la tabla projects
        await queryRunner.query(`
            ALTER TABLE "projects" 
            ADD COLUMN IF NOT EXISTS "notes" jsonb
        `);
        
        // Actualizar registros existentes para que tengan un array vacío por defecto
        await queryRunner.query(`
            UPDATE "projects" 
            SET "notes" = '[]'::jsonb 
            WHERE "notes" IS NULL
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Eliminar la columna notes de la tabla projects
        await queryRunner.query(`
            ALTER TABLE "projects" 
            DROP COLUMN IF EXISTS "notes"
        `);
    }
}

