import { Injectable, Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { CreateLeadDto } from '../dto/create-lead.dto';
import { ClickUpTaskRequestDto } from '../../clickup/dto/clickup-task-request.dto';
import { CustomFieldsBuilder } from '../services/custom-fields-builder.service';
import { ContactInfoFormatter } from '../../contacts/services/contact-info-formatter.service';
import clickupConfig from '../../../config/clickup.config';
import { LeadType } from '../../../common/enums/lead-type.enum';

@Injectable()
export class LeadToClickUpMapper {
  constructor(
    private readonly customFieldsBuilder: CustomFieldsBuilder,
    private readonly contactInfoFormatter: ContactInfoFormatter,
    @Inject(clickupConfig.KEY)
    private readonly config: ConfigType<typeof clickupConfig>,
  ) {}

  async toClickUpTask(dto: CreateLeadDto): Promise<ClickUpTaskRequestDto> {
    const customFields = await this.customFieldsBuilder.build(dto);
    const description = await this.buildDescription(dto);
    const tags = this.buildTags(dto.leadType);
    const startDate = this.convertDateStringToTimestamp(dto.startDate);

    return {
      name: `Lead: ${dto.name} (${dto.leadNumber})`,
      description: description,
      tags: tags,
      priority: this.config.defaultPriority,
      status: undefined, // Default status
      custom_fields: customFields,
      start_date: startDate || undefined,
      assignees: [],
      due_date: undefined,
      time_estimate: undefined,
    };
  }

  private async buildDescription(dto: CreateLeadDto): Promise<string> {
    // Format date: YYYY-MM-DD -> DD/MM/YYYY
    let fecha = dto.startDate;
    if (dto.startDate) {
        try {
            const [year, month, day] = dto.startDate.split('-');
            fecha = `${day}/${month}/${year}`;
        } catch (e) {}
    }

    const contacto = dto.contactId 
        ? await this.contactInfoFormatter.formatFor(dto.contactId) 
        : '';

    const lines = [
      '**New Lead Created**',
      '',
      '**Details:**',
      `- **Lead Number:** ${dto.leadNumber}`,
      `- **Name:** ${dto.name}`,
    ];

    if (dto.location) {
      lines.push(`- **Location:** ${dto.location}`);
    }

    if (dto.startDate) {
      lines.push(`- **Start Date:** ${fecha}`);
    }

    if (dto.leadType) {
      lines.push(`- **Type:** ${dto.leadType}`);
    }

    if (contacto) {
        lines.push(contacto);
    }

    lines.push('');
    lines.push('*Task created automatically from Supabase*');

    return lines.join('\n');
  }

  private buildTags(leadType?: LeadType): string[] {
    return [
      'lead',
      (leadType || 'construction').toLowerCase(),
      'automated',
    ];
  }

  private convertDateStringToTimestamp(dateString?: string): number | null {
    if (!dateString || dateString.trim() === '') {
      return null;
    }

    try {
      const date = new Date(dateString);
      return date.getTime();
    } catch (e) {
      return null;
    }
  }
}
