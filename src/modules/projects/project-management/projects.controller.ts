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
import { QboReportQueryDto } from './dto/qbo-report-query.dto';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { QuickbooksProjectImportService } from './services/quickbooks-project-import.service';
import { ImportQuickbooksBatchDto } from './dto/import-quickbooks-batch.dto';
import { ImportQuickbooksProjectDto } from './dto/import-quickbooks-project.dto';
import { LinkQuickbooksJobDto } from './dto/link-quickbooks-job.dto';
import { DeactivateQuickbooksJobDto } from './dto/deactivate-quickbooks-job.dto';
import { QuickbooksJobDeactivationService } from './services/quickbooks-job-deactivation.service';
import { ProjectQboReportService } from './services/project-qbo-report.service';
import { ProjectReceivablesService } from './services/project-receivables.service';

@ApiTags('projects')
@Controller('projects')
// Class-level default; write/delete routes override it below.
@RequirePermissions('projects:read')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly quickbooksProjectImport: QuickbooksProjectImportService,
    private readonly quickbooksJobDeactivation: QuickbooksJobDeactivationService,
    private readonly projectQboReport: ProjectQboReportService,
    private readonly projectReceivables: ProjectReceivablesService,
  ) {}

  @Get('quickbooks-import/jobs')
  @RequirePermissions('finance:read', 'projects:read')
  @ApiOperation({ summary: 'List active QuickBooks jobs with matching CRM records' })
  async getQuickbooksImportJobs() {
    return this.quickbooksProjectImport.listJobs();
  }

  @Post('quickbooks-import/import')
  @RequirePermissions('finance:read', 'projects:write')
  @ApiOperation({ summary: 'Import a QuickBooks job as a CRM project linked by exact job ID' })
  async importQuickbooksJob(@Body() dto: ImportQuickbooksProjectDto) {
    return this.quickbooksProjectImport.importJob(dto);
  }

  @Post('quickbooks-import/import-batch')
  @RequirePermissions('finance:read', 'projects:write')
  @ApiOperation({
    summary:
      'Import many QuickBooks jobs in one transaction — each decision gets its own savepoint, so a rejected one does not discard the rest',
  })
  @ApiResponse({ status: 201, description: 'Returns one result per decision: created, linked, already_imported or rejected with a reason' })
  async importQuickbooksJobsBatch(@Body() dto: ImportQuickbooksBatchDto) {
    return this.quickbooksProjectImport.importBatch(dto);
  }

  // Pide finance:write, no finance:read: esto escribe en la contabilidad, no en
  // el CRM, asi que es mas grave que importar y no puede bastar con poder leer
  // las cifras. Declarada antes de @Get(':id') como el resto de las rutas de
  // quickbooks-import: Nest resuelve por orden de declaracion.
  @Post('quickbooks-import/deactivate-job')
  @RequirePermissions('finance:write', 'projects:write')
  @ApiOperation({
    summary:
      'Deactivate a QuickBooks job (sets Active: false on the Customer). QuickBooks has no delete for a Customer; its transactions and history are kept.',
  })
  @ApiResponse({ status: 201, description: 'Returns the job with active=false, or alreadyInactive=true when nothing was written' })
  @ApiResponse({ status: 400, description: 'Missing confirm: true, or QuickBooks rejected the write (its message is passed through verbatim)' })
  @ApiResponse({ status: 404, description: 'The QuickBooks job could not be read' })
  @ApiResponse({ status: 409, description: 'The job has an open balance, or a CRM project is still linked to it' })
  async deactivateQuickbooksJob(
    @Body() dto: DeactivateQuickbooksJobDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.quickbooksJobDeactivation.deactivateJob(dto, user?.email);
  }

  @Put(':id/qbo-link')
  @RequirePermissions('finance:read', 'projects:write')
  @ApiOperation({
    summary:
      'Link an existing CRM project to a QuickBooks job (sets qboCustomerId). Counterpart of DELETE :id/qbo-link.',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({
    status: 200,
    description:
      'Returns the linked job, the previous one when the link was replaced, and whether the job name carries the project number',
  })
  @ApiResponse({ status: 404, description: 'Project or active QuickBooks job not found' })
  @ApiResponse({ status: 409, description: 'That QuickBooks job already belongs to another project' })
  async linkProjectQboLink(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LinkQuickbooksJobDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.quickbooksProjectImport.linkProject(id, dto.qboCustomerId, user?.email);
  }

  @Delete(':id/qbo-link')
  @RequirePermissions('projects:write')
  @ApiOperation({
    summary:
      'Break the QuickBooks link of a project (clears qboCustomerId + quickbooks). Keeps the project and its lead.',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Returns the previous QuickBooks job id, or unlinked=false when there was nothing to clear' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async unlinkProjectQboLink(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.quickbooksProjectImport.unlinkProject(id, user?.email);
  }

  @Get('all')
  @ApiOperation({ summary: 'Get all projects' })
  @ApiResponse({ status: 200, description: 'Returns all projects with their associated leads' })
  async getProjects(@CurrentUser() user: AuthenticatedUser) {
    return this.projectsService.findAll(user);
  }

  @Get(':id/payments')
  @RequirePermissions('finance:read')
  async getProjectPayments(@Param('id', ParseIntPipe) id: number) {
    return this.projectsService.getProjectPayments(id);
  }

  @Get('picker')
  @ApiOperation({ summary: 'Get lightweight projects for record pickers' })
  @ApiResponse({ status: 200, description: 'Returns project id and linked lead label without QuickBooks enrichment' })
  async getProjectsForPicker() {
    return this.projectsService.findProjectsForPicker();
  }

  @Get('financials')
  @RequirePermissions('finance:read')
  @ApiOperation({
    summary: 'Get QuickBooks financial summary for all projects, keyed by project id',
  })
  @ApiResponse({
    status: 200,
    description:
      'Companion to GET /projects/all — fetch this separately and merge client-side so a slow/degraded QuickBooks never blocks the project list',
  })
  async getProjectsFinancials(@CurrentUser() user: AuthenticatedUser) {
    return this.projectsService.findAllFinancials(user);
  }

  // Declared ahead of @Get(':id') — Nest matches in declaration order and 'receivables'
  // would otherwise be swallowed as an id and rejected by ParseIntPipe.
  @Get('receivables')
  @RequirePermissions('finance:read')
  @ApiOperation({
    summary:
      'Aged receivables: COMPLETED projects whose collection is not closed, aged from billed_at or, failing that, end_date',
  })
  @ApiResponse({
    status: 200,
    description:
      'Returns one row per project plus totals per aging bucket. daysOutstanding and the bucket are null/unknown when neither date exists, and outstandingAmount is null when nothing was billed — none of those are zero',
  })
  async getProjectsReceivables() {
    return this.projectReceivables.getReceivables();
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
  @RequirePermissions('projects:write')
  @ApiOperation({ summary: 'Send the project estimate by email (optionally without attachment)' })
  @ApiParam({ name: 'id', type: Number })
  async sendEstimateEmail(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SendEstimateEmailDto,
  ) {
    return this.projectsService.sendEstimateEmail(id, dto);
  }

  @Patch(':id/estimate')
  @RequirePermissions('projects:write')
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

  @Get(':id/qbo-report')
  @RequirePermissions('finance:read')
  @ApiOperation({
    summary:
      'Get a QuickBooks report scoped to the project customer, returned verbatim (no parsing, no date chunking)',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Returns the raw QuickBooks report payload' })
  @ApiResponse({ status: 409, description: 'Project is not linked to a QuickBooks customer' })
  async getProjectQboReport(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: QboReportQueryDto,
  ) {
    return this.projectQboReport.getProjectReport(id, query);
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
  @RequirePermissions('projects:write')
  @ApiOperation({ summary: 'Create project' })
  @ApiResponse({ status: 201, description: 'Project created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async createProject(@Body() project: CreateProjectDto) {
    return this.projectsService.create(project);
  }

  @Put(':id')
  @RequirePermissions('projects:write')
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
  @RequirePermissions('projects:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete project (also deletes associated lead)' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 204, description: 'Project deleted successfully' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async deleteProject(@Param('id', ParseIntPipe) id: number) {
    await this.projectsService.delete(id);
  }

  @Post(':id/revert-to-lead')
  @RequirePermissions('projects:write')
  @ApiOperation({ summary: 'Revert project back to lead (deletes project, resets lead status)' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Returns the lead id to navigate to' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async revertProjectToLead(@Param('id', ParseIntPipe) id: number) {
    return this.projectsService.revertToLead(id);
  }
}
