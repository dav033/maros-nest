import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { TaskTemplatesService } from './services/task-templates.service';
import { CreateTaskTemplateDto } from './dto/task-template.dto';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { toTaskActor } from './services/task-actor';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';

@Controller('task-templates')
@RequirePermissions('tasks:read')
export class TaskTemplatesController {
  constructor(private readonly service: TaskTemplatesService) {}

  @Get()
  list() { return this.service.list(); }

  @Post()
  @RequirePermissions('tasks:write')
  create(@Body() dto: CreateTaskTemplateDto) { return this.service.create(dto); }

  @Post(':id/apply')
  @RequirePermissions('tasks:write')
  apply(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { leadId: number; startDate?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.apply(id, body.leadId, body.startDate, toTaskActor(user));
  }
}
