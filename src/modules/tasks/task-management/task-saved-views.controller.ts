import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CreateTaskSavedViewDto } from './dto/task-saved-view.dto';
import { TaskSavedViewsService } from './services/task-saved-views.service';

@Controller('task-saved-views')
@RequirePermissions('tasks:read')
export class TaskSavedViewsController {
  constructor(private readonly service: TaskSavedViewsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) { return this.service.list(user.id); }

  @Post()
  @RequirePermissions('tasks:write')
  create(@Body() dto: CreateTaskSavedViewDto, @CurrentUser() user: AuthenticatedUser) { return this.service.create(user.id, dto); }

  @Delete(':id')
  @RequirePermissions('tasks:write')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) { return this.service.remove(user.id, id); }
}
