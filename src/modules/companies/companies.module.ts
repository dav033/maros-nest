import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../../entities/company.entity';
import { CompanyService } from '../../entities/company-service.entity';
import { Contact } from '../../entities/contact.entity';
import { CompaniesRepository } from './repositories/companies.repository';
import { CompanyServicesRepository } from './repositories/company-services.repository';
import { CompaniesService } from './services/companies.service';
import { CompanyServicesService } from './services/company-services.service';
import { CompaniesController } from './companies.controller';
import { CompanyServicesController } from './company-services.controller';
import { CompanyMapper } from './mappers/company.mapper';
import { CompanyServiceMapper } from './mappers/company-service.mapper';

@Module({
  imports: [
    TypeOrmModule.forFeature([Company, CompanyService, Contact]),
  ],
  controllers: [CompaniesController, CompanyServicesController],
  providers: [
    CompaniesRepository, 
    CompanyServicesRepository,
    CompaniesService,
    CompanyServicesService,
    CompanyMapper,
    CompanyServiceMapper,
  ],
  exports: [CompaniesService, CompanyServicesService],
})
export class CompaniesModule {}
