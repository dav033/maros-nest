import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateTaskWorkspaceFolderDto, UpdateTaskWorkspaceFolderDto } from './dto/task-workspace.dto';
import { TaskWorkspaceFoldersService } from './services/task-workspace-folders.service';

@Controller('task-workspaces/:workspaceId/folders')
@RequirePermissions('tasks:read')
export class TaskWorkspaceFoldersController {
  constructor(private readonly service: TaskWorkspaceFoldersService) {}

  @Get()
  list(@Param('workspaceId', ParseIntPipe) workspaceId: number) { return this.service.list(workspaceId); }

  @Post()
  @RequirePermissions('tasks:write')
  create(@Param('workspaceId', ParseIntPipe) workspaceId: number, @Body() dto: CreateTaskWorkspaceFolderDto) { return this.service.create(workspaceId, dto); }

  @Patch(':folderId')
  @RequirePermissions('tasks:write')
  update(@Param('workspaceId', ParseIntPipe) workspaceId: number, @Param('folderId', ParseIntPipe) folderId: number, @Body() dto: UpdateTaskWorkspaceFolderDto) { return this.service.update(workspaceId, folderId, dto); }

  @Delete(':folderId')
  @RequirePermissions('tasks:write')
  remove(@Param('workspaceId', ParseIntPipe) workspaceId: number, @Param('folderId', ParseIntPipe) folderId: number, @Body() body: { destinationFolderId?: number | null }) { return this.service.remove(workspaceId, folderId, body?.destinationFolderId); }
}
