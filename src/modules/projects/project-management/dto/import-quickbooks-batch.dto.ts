import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ImportQuickbooksProjectDto } from './import-quickbooks-project.dto';

export class ImportQuickbooksBatchDto {
  @ApiProperty({
    type: [ImportQuickbooksProjectDto],
    description: 'One decision per QuickBooks job; each one is applied under its own savepoint',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportQuickbooksProjectDto)
  decisions: ImportQuickbooksProjectDto[];
}
