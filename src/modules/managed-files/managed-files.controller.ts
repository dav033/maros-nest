import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CompleteManagedFileDto, CreateUploadIntentDto } from './dto/managed-file.dto';
import { ManagedFilesService } from './managed-files.service';

@Controller('managed-files')
@RequirePermissions('tasks:read')
export class ManagedFilesController {
  constructor(private readonly service: ManagedFilesService) {}

  @Post('intents')
  @RequirePermissions('tasks:write')
  createIntent(@Body() dto: CreateUploadIntentDto, @CurrentUser() actor: AuthenticatedUser) { return this.service.createIntent(dto, actor); }

  @Post(':id/complete')
  @RequirePermissions('tasks:write')
  complete(@Param('id', ParseIntPipe) id: number, @Body() dto: CompleteManagedFileDto) { return this.service.complete(id, dto); }

  @Post(':id/retry')
  @RequirePermissions('tasks:write')
  retry(@Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthenticatedUser) { return this.service.retry(id, actor); }

  @Get(':id/url')
  getUrl(@Param('id', ParseIntPipe) id: number) { return this.service.getDownloadUrl(id); }

  @Delete(':id')
  @RequirePermissions('tasks:write')
  remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove(id); }
}
