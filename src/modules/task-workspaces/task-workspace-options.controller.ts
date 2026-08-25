import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TaskWorkspaceOptionsDto } from './dto/task-workspace-options.dto';
import { TaskWorkspaceAssignmentService } from './services/task-workspace-assignment.service';

@Controller('task-workspaces')
@RequirePermissions('tasks:read')
export class TaskWorkspaceOptionsController {
  constructor(private readonly assignment: TaskWorkspaceAssignmentService) {}

  @Get('options')
  getOptions(@Query() _query: TaskWorkspaceOptionsDto) {
    return this.assignment.listOptions();
  }
}
