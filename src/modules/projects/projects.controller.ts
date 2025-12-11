import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { ProjectsService } from './services/projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

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
    // Validate that if project.id is provided, it matches the path parameter
    if ((project as any).id !== undefined && (project as any).id !== id) {
      throw new BadRequestException('ID mismatch');
    }
    
    // Remove id from DTO to prevent updates
    const { id: _, ...projectData } = project as any;
    
    return this.projectsService.update(id, projectData);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete project' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 204, description: 'Project deleted successfully' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async deleteProject(@Param('id', ParseIntPipe) id: number) {
    await this.projectsService.delete(id);
  }
}
