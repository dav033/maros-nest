import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../../entities/company.entity';
import { CompanyService } from '../../entities/company-service.entity';
import { Contact } from '../../entities/contact.entity';
import { Lead } from '../../entities/lead.entity';
import { Project } from '../../entities/project.entity';
import { CompaniesRepository } from './company-management/repositories/companies.repository';
import { CompanyServicesRepository } from './company-services/repositories/company-services.repository';
import { CompaniesService } from './company-management/services/companies.service';
import { CompanyServicesService } from './company-services/services/company-services.service';
import { CompaniesController } from './company-management/companies.controller';
import { CompanyServicesController } from './company-services/company-services.controller';
import { CompanyMapper } from './company-management/mappers/company.mapper';
import { CompanyServiceMapper } from './company-services/mappers/company-service.mapper';

@Module({
  imports: [
    TypeOrmModule.forFeature([Company, CompanyService, Contact, Lead, Project]),
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
