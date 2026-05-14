import { Injectable } from '@nestjs/common';
import { CreateLeadDto } from '../dto/create-lead.dto';
import { LeadType } from '../../../../common/enums/lead-type.enum';
import { LeadStatus } from '../../../../common/enums/lead-status.enum';
import { LeadNumberValidationResponseDto } from '../dto/lead-number-validation-response.dto';
import { LeadsRepository } from '../repositories/leads.repository';
import { ValidationException } from '../../../../common/exceptions';

@Injectable()
export class LeadNumberingService {
  constructor(private readonly leadsRepository: LeadsRepository) {}

  async applyDefaults(
    leadDto: CreateLeadDto,
    leadTypeForGeneration?: LeadType,
  ): Promise<void> {
    leadDto.status = leadDto.status || LeadStatus.NEW_LEAD;

    if (!leadDto.leadNumber || leadDto.leadNumber.trim() === '') {
      const typeToUse = leadTypeForGeneration || LeadType.CONSTRUCTION;
      leadDto.leadNumber = await this.generateLeadNumber(typeToUse);
    } else {
      const exists = await this.leadsRepository.existsByLeadNumber(
        leadDto.leadNumber,
      );
      if (exists) {
        throw ValidationException.format(
          'Lead number already exists: %s',
          leadDto.leadNumber,
        );
      }
    }

    if (
      (!leadDto.name || leadDto.name.trim() === '') &&
      leadDto.leadNumber &&
      leadDto.location
    ) {
      leadDto.name = `${leadDto.leadNumber}-${leadDto.location}`;
    }
  }

  async validateLeadNumber(
    leadNumber: string,
  ): Promise<LeadNumberValidationResponseDto> {
    if (!leadNumber || leadNumber.trim() === '') {
      return {
        valid: false,
        reason: 'Lead number is required',
      };
    }

    const trimmedLeadNumber = leadNumber.trim();
    const exactExists =
      await this.leadsRepository.existsByLeadNumber(trimmedLeadNumber);

    if (exactExists) {
      return {
        valid: false,
        reason: 'Lead number already exists',
      };
    }

    const numericPrefix = this.extractNumericPrefix(trimmedLeadNumber);
    if (!numericPrefix) {
      return {
        valid: false,
        reason: 'Invalid lead number format',
      };
    }

    const prefixInUse = await this.isNumericPrefixInUse(numericPrefix);
    if (prefixInUse) {
      return {
        valid: false,
        reason: `Lead number prefix ${numericPrefix} is already in use`,
      };
    }

    return {
      valid: true,
      reason: 'OK',
    };
  }

  private async generateLeadNumber(type: LeadType): Promise<string> {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = String(now.getFullYear()).slice(-2);
    const mmyy = `${month}${year}`;

    const allLeadNumbers =
      await this.leadsRepository.findAllLeadNumbersByType(type);

    const max = allLeadNumbers
      .map((s) => {
        if (!s) return -1;
        if (type === LeadType.ROOFING && /^\d{3}R-\d{4}$/.test(s)) {
          return parseInt(s.substring(0, 3), 10);
        }
        if (type === LeadType.PLUMBING && /^\d{3}P-\d{4}$/.test(s)) {
          return parseInt(s.substring(0, 3), 10);
        }
        if (type === LeadType.CONSTRUCTION && /^\d{3}-\d{4}$/.test(s)) {
          return parseInt(s.substring(0, 3), 10);
        }
        return -1;
      })
      .filter((i) => i >= 0)
      .reduce((prev, curr) => Math.max(prev, curr), 0);

    const next = max + 1;
    const base = String(next).padStart(3, '0');

    if (type === LeadType.ROOFING) {
      return `${base}R-${mmyy}`;
    }
    if (type === LeadType.PLUMBING) {
      return `${base}P-${mmyy}`;
    }
    return `${base}-${mmyy}`;
  }

  private extractNumericPrefix(leadNumber: string): string | null {
    if (
      /^\d{3}R-\d{4}$/.test(leadNumber) ||
      /^\d{3}P-\d{4}$/.test(leadNumber) ||
      /^\d{3}-\d{4}$/.test(leadNumber)
    ) {
      return leadNumber.substring(0, 3);
    }
    return null;
  }

  private async isNumericPrefixInUse(numericPrefix: string): Promise<boolean> {
    for (const type of Object.values(LeadType)) {
      const allNumbers = await this.leadsRepository.findAllLeadNumbersByType(
        type as LeadType,
      );
      const prefixExists = allNumbers.some((s) => {
        const existingPrefix = this.extractNumericPrefix(s);
        return numericPrefix === existingPrefix;
      });

      if (prefixExists) {
        return true;
      }
    }
    return false;
  }
}
