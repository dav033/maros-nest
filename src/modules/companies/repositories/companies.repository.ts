import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Company } from '../../../entities/company.entity';
import { CompanyType } from '../../../common/enums/company-type.enum';

@Injectable()
export class CompaniesRepository {
  constructor(
    @InjectRepository(Company)
    private readonly repo: Repository<Company>,
  ) {}

  async existsByNameIgnoreCase(name: string): Promise<boolean> {
    const count = await this.repo
      .createQueryBuilder('company')
      .where('LOWER(company.name) = LOWER(:name)', { name })
      .getCount();
    return count > 0;
  }

  async findByCustomerTrue(): Promise<Company[]> {
    return this.repo.find({ where: { customer: true } });
  }

  async findByClientTrue(): Promise<Company[]> {
    return this.repo.find({ where: { client: true } });
  }

  async findAll(): Promise<Company[]> {
    return this.repo.find();
  }

  async findByNameContaining(name: string): Promise<Company[]> {
    return this.repo
      .createQueryBuilder('company')
      .where('LOWER(company.name) LIKE LOWER(:name)', { name: `%${name}%` })
      .getMany();
  }

  async findByNameExact(name: string): Promise<Company | null> {
    return this.repo
      .createQueryBuilder('company')
      .where('LOWER(company.name) = LOWER(:name)', { name })
      .getOne();
  }

  async findWithContacts(id: number): Promise<Company | null> {
    return this.repo.findOne({
      where: { id },
      relations: ['contacts'],
    });
  }

  async findByNameWithContacts(name: string): Promise<Company | null> {
    return this.repo
      .createQueryBuilder('company')
      .leftJoinAndSelect('company.contacts', 'contacts')
      .where('LOWER(company.name) LIKE LOWER(:name)', { name: `%${name}%` })
      .getOne();
  }

  async findByType(type: CompanyType): Promise<Company[]> {
    return this.repo.find({ where: { type } });
  }

  async save(company: Company): Promise<Company> {
    return this.repo.save(company);
  }

  async findOne(id: number): Promise<Company | null> {
    return this.repo.findOne({ where: { id } });
  }

  async delete(id: number): Promise<void> {
    await this.repo.delete(id);
  }
}
