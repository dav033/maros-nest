import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Sse,
  Body,
  Param,
  Query,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  MessageEvent,
  Optional,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { Observable, interval, merge } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { TasksService } from './tasks.service';
import { TaskLabelsService } from './services/task-labels.service';
import { TaskCommentsService } from './services/task-comments.service';
import { TaskEventsBridgeService } from './services/task-events-bridge.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { MoveTaskDto } from './dto/move-task.dto';
import { ReorderSubtaskDto } from './dto/reorder-subtask.dto';
import { SetAssigneeDto } from './dto/set-assignee.dto';
import { ScheduleTaskDto } from './dto/schedule-task.dto';
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
import { BulkSetAssigneeDto } from './dto/bulk-set-assignee.dto';
import { BulkSetStatusDto } from './dto/bulk-set-status.dto';
import { BulkAddLabelsDto } from './dto/bulk-add-labels.dto';
import { BulkDeleteDto } from './dto/bulk-delete.dto';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { toTaskActor } from './services/task-actor';
import type { TaskEntityKind } from './dto/create-task.dto';
import { SetTaskPartiesDto } from './dto/set-parties.dto';
import { TASK_PARTY_KINDS } from '../../../entities/task-party.entity';
import type { TaskPartyKind } from '../../../entities/task-party.entity';
import { ScheduleQueryDto } from './dto/schedule-query.dto';
import { TaskDependenciesService } from './services/task-dependencies.service';

@ApiTags('tasks')
@Controller('tasks')
// Class-level default; write/delete routes override it below.
@RequirePermissions('tasks:read')
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly taskLabelsService: TaskLabelsService,
    private readonly taskCommentsService: TaskCommentsService,
    private readonly taskEventsBridge: TaskEventsBridgeService,
    @Optional() private readonly taskDependencies?: TaskDependenciesService,
  ) {}

  // --- Static routes first: they must never be shadowed by ':id'. ---

  @Get()
  @ApiOperation({ summary: 'List tasks, filtered — see SearchTasksDto' })
  @ApiResponse({
    status: 200,
    description:
      '{ items, totalCount, nextCursor } — top-level tasks only unless includeSubtasks; ' +
      'nextCursor is an opaque keyset cursor for the next page',
  })
  async listTasks(@Query() query: SearchTasksDto) {
    return this.tasksService.findAll(query);
  }

  @Get('archived')
  async listArchivedTasks() {
    return this.tasksService.findArchived();
  }

  @Get('board')
  @ApiOperation({ summary: 'Top-level tasks grouped by status, for the kanban board' })
  @ApiResponse({
    status: 200,
    description:
      "{ columns, doneTotalCount } — one array per status (cancelled excluded), done windowed " +
      'to the last 30 days/50 tasks; doneTotalCount is the true count behind that window',
  })
  async getBoard(@Query() query: SearchTasksDto) {
    return this.tasksService.getBoard(query);
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
    @Query('entityKind') entityKind: TaskEntityKind,
    @Query('entityId', ParseIntPipe) entityId: number,
  ) {
    return this.tasksService.getByEntity(entityKind, entityId);
  }

  @Get('labels')
  @ApiOperation({ summary: 'Get all task labels' })
  async listLabels() {
    return this.taskLabelsService.listLabels();
  }

  @Get('schedule')
  @ApiOperation({ summary: 'Tasks scheduled across a date range' })
  async getSchedule(@Query() query: ScheduleQueryDto) {
    return this.tasksService.getSchedule(query);
  }

  @Get(':id/dependencies')
  async listDependencies(@Param('id', ParseIntPipe) id: number) {
    return this.taskDependencies ? this.taskDependencies.list(id) : [];
  }

  @Put(':id/dependencies')
  @RequirePermissions('tasks:write')
  async setDependencies(@Param('id', ParseIntPipe) id: number, @Body() body: { dependsOnTaskIds: number[] }) {
    return this.taskDependencies ? this.taskDependencies.replace(id, body.dependsOnTaskIds ?? []) : [];
  }

  @Post(':id/timer/start')
  @RequirePermissions('tasks:write')
  async startTimer(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.startTimer(id, toTaskActor(user));
  }

  @Post(':id/timer/stop')
  @RequirePermissions('tasks:write')
  async stopTimer(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.stopTimer(id, toTaskActor(user));
  }

  @Get('by-party')
  @ApiOperation({ summary: 'Tasks associated with a company or contact party' })
  async getTasksByParty(
    @Query('partyKind') partyKind: TaskPartyKind,
    @Query('partyId', ParseIntPipe) partyId: number,
  ) {
    if (!TASK_PARTY_KINDS.includes(partyKind)) return [];
    return this.tasksService.getByParty(partyKind, partyId);
  }

  /**
   * The live-board transport: one `task.changed` message per mutation, filtered so a
   * client never receives its own change back (its own mutation's onSuccess already
   * has the fresh result — see useTaskMutations on the frontend). Deliberately not a
   * per-field diff — see TaskEventsBridgeService — so the receiving client just
   * refetches whatever query group the changed task belongs to.
   *
   * A 20s heartbeat comment keeps the connection alive through reverse proxies that
   * would otherwise time out an idle keep-alive HTTP connection; EventSource's own
   * auto-reconnect (with the browser's default backoff) is the recovery path if the
   * connection drops anyway, so there's no reconnection logic to write here or on
   * the client.
   */
  @Sse('events/stream')
  @ApiOperation({ summary: 'Live task.changed events — the board/list/mine views\' real-time transport' })
  streamEvents(@CurrentUser() user: AuthenticatedUser): Observable<MessageEvent> {
    const changes$ = this.taskEventsBridge.changes$.pipe(
      filter((event) => event.actorId !== user.id),
      map((event) => ({ type: 'task.changed', data: event }) satisfies MessageEvent),
    );
    const heartbeat$ = interval(20_000).pipe(
      map(() => ({ type: 'heartbeat', data: {} }) satisfies MessageEvent),
    );
    return merge(changes$, heartbeat$);
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

  // --- Bulk actions: the list's multi-select toolbar. Each runs every task
  // sequentially and reports per-task success/failure — see TasksService.runBulk. ---

  @Post('bulk/assignee')
  @RequirePermissions('tasks:write')
  @ApiOperation({ summary: 'Assign or unassign every listed task' })
  async bulkSetAssignee(
    @Body() dto: BulkSetAssigneeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.bulkSetAssignee(dto.taskIds, dto.userId, toTaskActor(user));
  }

  @Post('bulk/status')
  @RequirePermissions('tasks:write')
  @ApiOperation({ summary: 'Move every listed task to the same status' })
  @ApiResponse({ status: 422, description: 'status is "blocked" and blockedReason was omitted for a task with none on file — that task fails individually, the rest still run' })
  async bulkSetStatus(
    @Body() dto: BulkSetStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.bulkSetStatus(dto.taskIds, dto.status, dto.blockedReason, toTaskActor(user));
  }

  @Post('bulk/labels')
  @RequirePermissions('tasks:write')
  @ApiOperation({ summary: 'Add these labels to every listed task, on top of whatever each already has' })
  async bulkAddLabels(
    @Body() dto: BulkAddLabelsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.bulkAddLabels(dto.taskIds, dto.labelIds, toTaskActor(user));
  }

  @Post('bulk/delete')
  @RequirePermissions('tasks:delete')
  @ApiOperation({ summary: 'Soft-delete every listed task' })
  async bulkDelete(
    @Body() dto: BulkDeleteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.bulkDelete(dto.taskIds, toTaskActor(user));
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

  @Patch(':id/schedule')
  @RequirePermissions('tasks:write')
  @ApiOperation({ summary: 'Atomically reschedule and optionally reassign a task' })
  async scheduleTask(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ScheduleTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.schedule(id, dto, toTaskActor(user));
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

  @Patch(':id/reorder')
  @RequirePermissions('tasks:write')
  @ApiOperation({ summary: "Reorder a subtask among its parent's other children" })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: "The parent task's refreshed detail" })
  @ApiResponse({ status: 404, description: 'Task not found' })
  @ApiResponse({ status: 422, description: 'Task is top-level, so it has no parent to reorder within' })
  async reorderSubtask(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReorderSubtaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.reorderSubtask(id, dto, toTaskActor(user));
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
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.setLabels(id, dto, toTaskActor(user));
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

  @Get(':id/parties')
  @ApiOperation({ summary: 'List the companies and contacts involved in a task' })
  async listParties(@Param('id', ParseIntPipe) id: number) {
    return this.tasksService.listParties(id);
  }

  @Put(':id/parties')
  @RequirePermissions('tasks:write')
  @ApiOperation({ summary: 'Replace the companies and contacts involved in a task' })
  async setParties(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetTaskPartiesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.setParties(id, dto, toTaskActor(user));
  }

  @Get(':id/watchers')
  async listWatchers(@Param('id', ParseIntPipe) id: number) {
    return this.tasksService.listWatchers(id);
  }

  @Post(':id/watchers/:userId')
  @RequirePermissions('tasks:write')
  async addWatcher(
    @Param('id', ParseIntPipe) id: number,
    @Param('userId', ParseIntPipe) userId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.addWatcher(id, userId, toTaskActor(user));
  }

  @Delete(':id/watchers/:userId')
  @RequirePermissions('tasks:write')
  async removeWatcher(
    @Param('id', ParseIntPipe) id: number,
    @Param('userId', ParseIntPipe) userId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.removeWatcher(id, userId, toTaskActor(user));
  }

  @Post(':id/archive')
  @RequirePermissions('tasks:write')
  async archiveTask(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    await this.tasksService.archive(id, toTaskActor(user));
  }

  @Post(':id/restore')
  @RequirePermissions('tasks:write')
  async restoreTask(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.restore(id, toTaskActor(user));
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
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.removeAttachment(id, dto.key, toTaskActor(user));
  }

  @Put(':id/attachments/order')
  @RequirePermissions('tasks:write')
  @ApiOperation({ summary: 'Reorder attachments, reconciled against the server\'s current set' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async reorderAttachments(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReorderAttachmentsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.reorderAttachments(id, dto.keys, toTaskActor(user));
  }

  @Delete(':id')
  @RequirePermissions('tasks:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a task and its direct subtasks' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async deleteTask(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.tasksService.delete(id, toTaskActor(user));
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
