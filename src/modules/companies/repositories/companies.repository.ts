import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Company } from '../../../entities/company.entity';

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
