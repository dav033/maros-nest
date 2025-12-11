import { MigrationInterface, QueryRunner } from "typeorm";

export class RemoveLeadTypeColumn1765392744919 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Eliminar la columna lead_type de la tabla leads
        await queryRunner.query(`
            ALTER TABLE "leads" 
            DROP COLUMN IF EXISTS "lead_type"
        `);
        
        // Eliminar el tipo enum si ya no se usa (opcional, puede que se use en otros lugares)
        // await queryRunner.query(`DROP TYPE IF EXISTS "leads_lead_type_enum"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Recrear el tipo enum si fue eliminado
        await queryRunner.query(`
            DO $$ BEGIN
                CREATE TYPE "leads_lead_type_enum" AS ENUM('CONSTRUCTION', 'PLUMBING', 'ROOFING');
            EXCEPTION
                WHEN duplicate_object THEN null;
            END $$;
        `);
        
        // Recrear la columna lead_type
        await queryRunner.query(`
            ALTER TABLE "leads" 
            ADD COLUMN "lead_type" "leads_lead_type_enum"
        `);
    }

}
