import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPhoneEmailSubmizToCompanies1765501290306 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Agregar las columnas phone, email y submiz a la tabla companies
        await queryRunner.query(`
            ALTER TABLE "companies" 
            ADD COLUMN IF NOT EXISTS "phone" VARCHAR(255)
        `);
        
        await queryRunner.query(`
            ALTER TABLE "companies" 
            ADD COLUMN IF NOT EXISTS "email" VARCHAR(255)
        `);
        
        await queryRunner.query(`
            ALTER TABLE "companies" 
            ADD COLUMN IF NOT EXISTS "submiz" VARCHAR(255)
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Eliminar las columnas phone, email y submiz de la tabla companies
        await queryRunner.query(`
            ALTER TABLE "companies" 
            DROP COLUMN IF EXISTS "phone"
        `);
        
        await queryRunner.query(`
            ALTER TABLE "companies" 
            DROP COLUMN IF EXISTS "email"
        `);
        
        await queryRunner.query(`
            ALTER TABLE "companies" 
            DROP COLUMN IF EXISTS "submiz"
        `);
    }

}





























