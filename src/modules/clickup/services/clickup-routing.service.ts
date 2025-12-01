import { Injectable, Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import clickupConfig, { ClickUpRouteConfig } from '../../../config/clickup.config';
import { LeadType } from '../../../common/enums/lead-type.enum';

@Injectable()
export class ClickUpRoutingService {
  constructor(
    @Inject(clickupConfig.KEY)
    private readonly config: ConfigType<typeof clickupConfig>,
  ) {}

  route(leadType: LeadType): ClickUpRouteConfig {
    const typeKey = leadType.toUpperCase() as keyof typeof this.config.routes.map;
    const route = this.config.routes.map[typeKey];
    
    if (!route) {
      // Default to CONSTRUCTION if not found, or throw error
      // Assuming CONSTRUCTION is safe default as per legacy logic often implies
      return this.config.routes.map.CONSTRUCTION;
    }
    return route;
  }

  resolveLeadNumberFieldId(leadType: LeadType): string {
    const route = this.route(leadType);
    return route.fields.leadNumberId;
  }
}
