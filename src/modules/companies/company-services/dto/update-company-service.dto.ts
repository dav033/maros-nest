import { PartialType } from '@nestjs/swagger';
import { CreateCompanyServiceDto } from './create-company-service.dto';

export class UpdateCompanyServiceDto extends PartialType(CreateCompanyServiceDto) {}
