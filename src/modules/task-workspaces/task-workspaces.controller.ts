import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { AddTaskWorkspaceLinksDto, CreateTaskWorkspaceDto, MoveWorkspaceTaskDto, SearchTaskWorkspacesDto, UpdateTaskWorkspaceDto } from './dto/task-workspace.dto';
import { TaskWorkspacesService } from './services/task-workspaces.service';

@Controller('task-workspaces')
@RequirePermissions('tasks:read')
export class TaskWorkspacesController {
  constructor(private readonly service: TaskWorkspacesService) {}

  @Get()
  list(@Query() query: SearchTaskWorkspacesDto) { return this.service.list(query); }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) { return this.service.get(id); }

  @Post()
  @RequirePermissions('tasks:write')
  create(@Body() dto: CreateTaskWorkspaceDto, @CurrentUser() actor: AuthenticatedUser) { return this.service.create(dto, actor); }

  @Patch(':id')
  @RequirePermissions('tasks:write')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTaskWorkspaceDto) { return this.service.update(id, dto); }

  @Post(':id/archive')
  @RequirePermissions('tasks:write')
  archive(@Param('id', ParseIntPipe) id: number) { return this.service.archive(id); }

  @Post(':id/restore')
  @RequirePermissions('tasks:write')
  restore(@Param('id', ParseIntPipe) id: number) { return this.service.restore(id); }

  @Post(':id/links')
  @RequirePermissions('tasks:write')
  addLinks(@Param('id', ParseIntPipe) id: number, @Body() dto: AddTaskWorkspaceLinksDto, @CurrentUser() actor: AuthenticatedUser) { return this.service.addLinks(id, dto, actor); }

  @Delete(':id/links/:kind/:entityId')
  @RequirePermissions('tasks:write')
  removeLink(@Param('id', ParseIntPipe) id: number, @Param('kind') kind: string, @Param('entityId', ParseIntPipe) entityId: number) { return this.service.removeLink(id, kind, entityId); }

  @Post(':id/tasks/:taskId/move')
  @RequirePermissions('tasks:write')
  moveTask(@Param('id', ParseIntPipe) id: number, @Param('taskId', ParseIntPipe) taskId: number, @Body() dto: MoveWorkspaceTaskDto) { return this.service.moveTask(id, taskId, dto.folderId); }
}
