import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ProjectTypesService } from './services/project-types.service';

@ApiTags('project-types')
@Controller('project-type')
export class ProjectTypeController {
  constructor(private readonly projectTypesService: ProjectTypesService) {}

  @Get('all')
  @ApiOperation({ summary: 'Get all project types' })
  @ApiResponse({ status: 200, description: 'Returns all project types' })
  async getAllProjectTypes() {
    return this.projectTypesService.findAll();
  }
}

// Second controller for plural route (for compatibility)
@ApiTags('project-types')
@Controller('project-types')
export class ProjectTypesController {
  constructor(private readonly projectTypesService: ProjectTypesService) {}

  @Get('all')
  @ApiOperation({ summary: 'Get all project types (plural route)' })
  @ApiResponse({ status: 200, description: 'Returns all project types' })
  async getAllProjectTypesPlural() {
    return this.projectTypesService.findAll();
  }
}
