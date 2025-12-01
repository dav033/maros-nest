import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CompanyService } from '../../../entities/company-service.entity';

@Injectable()
export class CompanyServicesRepository {
  constructor(
    @InjectRepository(CompanyService)
    private readonly repo: Repository<CompanyService>,
  ) {}

  async existsByNameIgnoreCase(name: string): Promise<boolean> {
    const count = await this.repo
      .createQueryBuilder('companyService')
      .where('LOWER(companyService.name) = LOWER(:name)', { name })
      .getCount();
    return count > 0;
  }

  async findAll(): Promise<CompanyService[]> {
    return this.repo.find();
  }

  async save(companyService: CompanyService): Promise<CompanyService> {
    return this.repo.save(companyService);
  }

  async findOne(id: number): Promise<CompanyService | null> {
    return this.repo.findOne({ where: { id } });
  }

  async delete(id: number): Promise<void> {
    await this.repo.delete(id);
  }
}
