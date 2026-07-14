import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { ProjectsService } from './services/projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { SendEstimateEmailDto } from './dto/send-estimate-email.dto';
import { UpdateEstimateDto } from './dto/update-estimate.dto';

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get('all')
  @ApiOperation({ summary: 'Get all projects' })
  @ApiResponse({ status: 200, description: 'Returns all projects with their associated leads' })
  async getProjects() {
    return this.projectsService.findAll();
  }

  @Get('by-lead-number')
  @ApiOperation({ summary: 'Get project by lead number' })
  @ApiQuery({ name: 'leadNumber', type: String, required: true })
  @ApiResponse({ status: 200, description: 'Returns the project' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async getProjectByLeadNumber(@Query('leadNumber') leadNumber: string) {
    if (!leadNumber) {
      throw new BadRequestException('leadNumber query parameter is required');
    }
    return this.projectsService.findByLeadNumber(leadNumber);
  }

  @Get(':id/details')
  @ApiOperation({ summary: 'Get project details with lead and contact information' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Returns the project with all related data' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async getProjectDetails(@Param('id', ParseIntPipe) id: number) {
    return this.projectsService.getProjectDetails(id);
  }

  @Get(':id/estimate-file')
  @ApiOperation({ summary: 'Find the estimate attachment for a project (searches the linked lead + project attachments)' })
  @ApiParam({ name: 'id', type: Number })
  async getEstimateFile(@Param('id', ParseIntPipe) id: number) {
    return this.projectsService.findEstimateFile(id);
  }

  @Post(':id/send-estimate-email')
  @ApiOperation({ summary: 'Send the project estimate by email (optionally without attachment)' })
  @ApiParam({ name: 'id', type: Number })
  async sendEstimateEmail(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SendEstimateEmailDto,
  ) {
    return this.projectsService.sendEstimateEmail(id, dto);
  }

  @Patch(':id/estimate')
  @ApiOperation({
    summary:
      'Update the project estimate total and sync it to QuickBooks (edits the most recent estimate or creates one)',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Estimate updated and synced to QuickBooks' })
  async updateEstimate(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEstimateDto,
  ) {
    return this.projectsService.updateProjectEstimate(id, dto.amount);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get project by ID' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Returns the project' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async getProjectById(@Param('id', ParseIntPipe) id: number) {
    return this.projectsService.findById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create project' })
  @ApiResponse({ status: 201, description: 'Project created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async createProject(@Body() project: CreateProjectDto) {
    return this.projectsService.create(project);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update project' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Project updated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async updateProject(
    @Param('id', ParseIntPipe) id: number,
    @Body() project: UpdateProjectDto,
  ) {
    const projectData: UpdateProjectDto & { id?: number } = { ...project };

    if (projectData.id !== undefined && projectData.id !== id) {
      throw new BadRequestException('ID mismatch');
    }

    delete projectData.id;

    return this.projectsService.update(id, projectData);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete project (also deletes associated lead)' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 204, description: 'Project deleted successfully' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async deleteProject(@Param('id', ParseIntPipe) id: number) {
    await this.projectsService.delete(id);
  }

  @Post(':id/revert-to-lead')
  @ApiOperation({ summary: 'Revert project back to lead (deletes project, resets lead status)' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Returns the lead id to navigate to' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async revertProjectToLead(@Param('id', ParseIntPipe) id: number) {
    return this.projectsService.revertToLead(id);
  }
}
