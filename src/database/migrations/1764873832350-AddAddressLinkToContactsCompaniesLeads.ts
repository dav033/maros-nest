import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAddressLinkToContactsCompaniesLeads1764873832350 implements MigrationInterface {
    name = 'AddAddressLinkToContactsCompaniesLeads1764873832350'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "companies" ADD "address_link" character varying(500)`);
        await queryRunner.query(`ALTER TABLE "contacts" ADD "address_link" character varying(500)`);
        await queryRunner.query(`ALTER TABLE "leads" ADD "address_link" character varying(500)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "leads" DROP COLUMN "address_link"`);
        await queryRunner.query(`ALTER TABLE "contacts" DROP COLUMN "address_link"`);
        await queryRunner.query(`ALTER TABLE "companies" DROP COLUMN "address_link"`);
    }
}
