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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { TasksService } from './tasks.service';
import { TaskLabelsService } from './services/task-labels.service';
import { TaskCommentsService } from './services/task-comments.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { MoveTaskDto } from './dto/move-task.dto';
import { SetAssigneeDto } from './dto/set-assignee.dto';
import { SetLabelsDto } from './dto/set-labels.dto';
import { SetEntityDto } from './dto/set-entity.dto';
import { SearchTasksDto } from './dto/search-tasks.dto';
import { CreateLabelDto } from './dto/create-label.dto';
import { UpdateLabelDto } from './dto/update-label.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { AddAttachmentsDto } from './dto/add-attachments.dto';
import { RemoveAttachmentDto } from './dto/remove-attachment.dto';
import { ReorderAttachmentsDto } from './dto/reorder-attachments.dto';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { toTaskActor } from './services/task-actor';

@ApiTags('tasks')
@Controller('tasks')
// Class-level default; write/delete routes override it below.
@RequirePermissions('tasks:read')
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly taskLabelsService: TaskLabelsService,
    private readonly taskCommentsService: TaskCommentsService,
  ) {}

  // --- Static routes first: they must never be shadowed by ':id'. ---

  @Get()
  @ApiOperation({ summary: 'List tasks, filtered — see SearchTasksDto' })
  @ApiResponse({ status: 200, description: 'Returns matching tasks (top-level only unless includeSubtasks)' })
  async listTasks(@Query() query: SearchTasksDto) {
    return this.tasksService.findAll(query);
  }

  @Get('board')
  @ApiOperation({ summary: 'Top-level tasks grouped by status, for the kanban board' })
  @ApiResponse({ status: 200, description: 'One array per status (cancelled excluded)' })
  async getBoard() {
    return this.tasksService.getBoard();
  }

  @Get('mine')
  @ApiOperation({ summary: 'My open tasks, bucketed by due date' })
  @ApiResponse({
    status: 200,
    description: 'overdue / today / thisWeek / later / noDueDate, in America/New_York',
  })
  async getMine(@CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.getMine(toTaskActor(user));
  }

  @Get('by-entity')
  @ApiOperation({ summary: 'Tasks linked to a CRM entity' })
  @ApiQuery({ name: 'entityKind', enum: ['lead', 'project', 'contact', 'company'] })
  @ApiQuery({ name: 'entityId', type: Number })
  async getTasksByEntity(
    @Query('entityKind') entityKind: string,
    @Query('entityId', ParseIntPipe) entityId: number,
  ) {
    return this.tasksService.getByEntity(entityKind, entityId);
  }

  @Get('labels')
  @ApiOperation({ summary: 'Get all task labels' })
  async listLabels() {
    return this.taskLabelsService.listLabels();
  }

  @Post('labels')
  @RequirePermissions('tasks:write')
  @ApiOperation({ summary: 'Create a task label' })
  @ApiResponse({ status: 201, description: 'Label created successfully' })
  @ApiResponse({ status: 409, description: 'A label with this name already exists' })
  async createLabel(@Body() dto: CreateLabelDto) {
    return this.taskLabelsService.createLabel(dto);
  }

  @Patch('labels/:labelId')
  @RequirePermissions('tasks:write')
  @ApiOperation({ summary: 'Update a task label' })
  @ApiParam({ name: 'labelId', type: Number })
  @ApiResponse({ status: 404, description: 'Label not found' })
  async updateLabel(
    @Param('labelId', ParseIntPipe) labelId: number,
    @Body() dto: UpdateLabelDto,
  ) {
    return this.taskLabelsService.updateLabel(labelId, dto);
  }

  @Delete('labels/:labelId')
  @RequirePermissions('tasks:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a task label' })
  @ApiParam({ name: 'labelId', type: Number })
  @ApiResponse({ status: 404, description: 'Label not found' })
  async deleteLabel(@Param('labelId', ParseIntPipe) labelId: number) {
    await this.taskLabelsService.deleteLabel(labelId);
  }

  @Post()
  @RequirePermissions('tasks:write')
  @ApiOperation({ summary: 'Create a task (or a subtask, with parentId)' })
  @ApiResponse({ status: 201, description: 'Task created successfully' })
  @ApiResponse({ status: 422, description: 'parentId points at a task that is itself a subtask' })
  async createTask(
    @Body() dto: CreateTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.create(dto, toTaskActor(user));
  }

  // --- ':id' routes below this point. ---

  @Get(':id')
  @ApiOperation({ summary: 'Get a task by id, including subtasks and activity' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async getTaskById(@Param('id', ParseIntPipe) id: number) {
    return this.tasksService.getById(id);
  }

  @Patch(':id')
  @RequirePermissions('tasks:write')
  @ApiOperation({ summary: "Update a task's own fields (not status — see /move)" })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 404, description: 'Task not found' })
  @ApiResponse({ status: 409, description: 'expectedUpdatedAt no longer matches — someone else edited it first' })
  async updateTask(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.update(id, dto, toTaskActor(user));
  }

  @Patch(':id/move')
  @RequirePermissions('tasks:write')
  @ApiOperation({ summary: 'Change status and/or reorder within a board column' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Task moved; may carry openSubtasksWarning' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  @ApiResponse({ status: 422, description: 'Moving to blocked with no reason available' })
  async moveTask(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MoveTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.move(id, dto, toTaskActor(user));
  }

  @Patch(':id/assignee')
  @RequirePermissions('tasks:write')
  @ApiOperation({ summary: 'Assign or unassign a task' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async setAssignee(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetAssigneeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.setAssignee(id, dto, toTaskActor(user));
  }

  @Put(':id/labels')
  @RequirePermissions('tasks:write')
  @ApiOperation({ summary: 'Set the complete label list for a task' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async setLabels(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetLabelsDto,
  ) {
    return this.tasksService.setLabels(id, dto);
  }

  @Put(':id/entity')
  @RequirePermissions('tasks:write')
  @ApiOperation({ summary: 'Link the task to a CRM entity, or clear the link' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async setEntityLink(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetEntityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.setEntityLink(id, dto, toTaskActor(user));
  }

  // --- Attachments: additive, never a full-list replace — see TasksService docblock. ---

  @Post(':id/attachments')
  @RequirePermissions('tasks:write')
  @ApiOperation({ summary: 'Add S3 attachment keys to the task (already-present keys are ignored)' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async addAttachments(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddAttachmentsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.addAttachments(id, dto.keys, toTaskActor(user));
  }

  @Post(':id/attachments/remove')
  @RequirePermissions('tasks:write')
  @ApiOperation({ summary: 'Remove one attachment by key' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async removeAttachment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RemoveAttachmentDto,
  ) {
    return this.tasksService.removeAttachment(id, dto.key);
  }

  @Put(':id/attachments/order')
  @RequirePermissions('tasks:write')
  @ApiOperation({ summary: 'Reorder attachments, reconciled against the server\'s current set' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async reorderAttachments(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReorderAttachmentsDto,
  ) {
    return this.tasksService.reorderAttachments(id, dto.keys);
  }

  @Delete(':id')
  @RequirePermissions('tasks:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a task and its direct subtasks' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async deleteTask(@Param('id', ParseIntPipe) id: number) {
    await this.tasksService.delete(id);
  }

  // --- Comments ---

  @Get(':id/comments')
  @ApiOperation({ summary: 'List a task’s comments, oldest first' })
  @ApiParam({ name: 'id', type: Number })
  async listComments(@Param('id', ParseIntPipe) id: number) {
    return this.taskCommentsService.list(id);
  }

  @Post(':id/comments')
  @RequirePermissions('tasks:write')
  @ApiOperation({ summary: 'Add a comment. The author becomes a watcher.' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 201, description: 'Comment created successfully' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async createComment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.taskCommentsService.create(id, dto, toTaskActor(user));
  }

  @Patch(':id/comments/:commentId')
  @RequirePermissions('tasks:write')
  @ApiOperation({ summary: 'Edit a comment — the author, or someone with tasks:delete' })
  @ApiParam({ name: 'id', type: Number })
  @ApiParam({ name: 'commentId', type: Number })
  @ApiResponse({ status: 403, description: 'Not the author, and no tasks:delete' })
  @ApiResponse({ status: 404, description: 'Comment not found on this task' })
  async updateComment(
    @Param('id', ParseIntPipe) id: number,
    @Param('commentId', ParseIntPipe) commentId: number,
    @Body() dto: UpdateCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.taskCommentsService.update(id, commentId, dto, toTaskActor(user));
  }

  @Delete(':id/comments/:commentId')
  @RequirePermissions('tasks:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a comment — the author, or someone with tasks:delete' })
  @ApiParam({ name: 'id', type: Number })
  @ApiParam({ name: 'commentId', type: Number })
  @ApiResponse({ status: 403, description: 'Not the author, and no tasks:delete' })
  @ApiResponse({ status: 404, description: 'Comment not found on this task' })
  async deleteComment(
    @Param('id', ParseIntPipe) id: number,
    @Param('commentId', ParseIntPipe) commentId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.taskCommentsService.delete(id, commentId, toTaskActor(user));
  }
}
