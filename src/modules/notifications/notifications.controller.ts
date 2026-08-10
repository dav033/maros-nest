import { Controller, Get, Post, Param, Query, ParseIntPipe, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';

/**
 * Every route here operates on the caller's own notifications — a valid session is the
 * whole check, same as GET /users/me. There is no `tasks:read`-style gate: whether you
 * get notified about a task is a property of being a watcher, resolved when the
 * notification was created, not of a permission checked when you read it back.
 */
@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List my notifications, most recent first' })
  async list(
    @Query() query: ListNotificationsDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    if (!user) throw new UnauthorizedException();
    return this.notificationsService.list(user.id, query.unreadOnly ?? false, query.limit);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'How many unread notifications I have — for the bell badge' })
  async unreadCount(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException();
    return { count: await this.notificationsService.unreadCount(user.id) };
  }

  @Post(':id/read')
  @ApiOperation({ summary: 'Mark one notification read' })
  async markRead(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    if (!user) throw new UnauthorizedException();
    await this.notificationsService.markRead(id, user.id);
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark all of my notifications read' })
  async markAllRead(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException();
    await this.notificationsService.markAllRead(user.id);
  }
}
