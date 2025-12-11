import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOverviewToProject1765406485708 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Agregar la columna overview a la tabla projects
        await queryRunner.query(`
            ALTER TABLE "projects" 
            ADD COLUMN IF NOT EXISTS "overview" TEXT
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Eliminar la columna overview de la tabla projects
        await queryRunner.query(`
            ALTER TABLE "projects" 
            DROP COLUMN IF EXISTS "overview"
        `);
    }

}
