import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ProjectsService } from './services/projects.service';

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get('with-leads')
  @ApiOperation({ summary: 'Get all projects with lead information' })
  @ApiResponse({ status: 200, description: 'Returns all projects with their associated leads' })
  async getAllWithLeads() {
    return this.projectsService.getProjectsWithLead();
  }
}
