import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AllowExternal } from '../../../common/decorators/allow-external.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import {
  PERMISSION_GROUPS,
  PERMISSIONS,
} from '../../../common/auth/permissions';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { UsersService } from './users.service';
import { RolesService } from './services/roles.service';
import { UserInvitationsService } from './services/user-invitations.service';
import { UserMapper } from './mappers/user.mapper';
import { UpdateUserDto } from './dto/update-user.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';

@ApiTags('users')
@Controller()
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly rolesService: RolesService,
    private readonly invitationsService: UserInvitationsService,
    private readonly mapper: UserMapper,
  ) {}

  // --- Current user: any authenticated caller, no permission required. ---

  @Get('users/me')
  @AllowExternal()
  @ApiOperation({ summary: 'Current user with their effective permissions' })
  @ApiResponse({ status: 200, description: 'The authenticated user' })
  getMe(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException();
    return user;
  }

  @Get('users/me/notification-preferences')
  @AllowExternal()
  @ApiOperation({ summary: 'Get my notification delivery preferences' })
  async getNotificationPreferences(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException();
    return this.usersService.getNotificationPreferences(user.id);
  }

  @Put('users/me/notification-preferences')
  @AllowExternal()
  @ApiOperation({ summary: 'Update my notification delivery preferences' })
  async updateNotificationPreferences(
    @Body() dto: UpdateNotificationPreferencesDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    if (!user) throw new UnauthorizedException();
    return this.usersService.updateNotificationPreferences(user.id, dto);
  }

  /**
   * Deliberately has no @RequirePermissions: a signed-in session is the whole check.
   *
   * Sharing a note means naming a colleague, and `users:read` is admin-only, so without
   * this a member could never fill in the "share with" field. It answers id, name,
   * email and picture for active users and nothing else — no role, no permissions, no
   * status — which is the same information already visible on the byline of any note
   * they have opened. Widening `users:read` to make sharing work would have handed over
   * far more.
   *
   * Lo que sí queda fuera es un usuario externo: no tiene colegas dentro de Maros a
   * quien nombrar, y sin @AllowExternal PermissionsGuard le responde 403. Antes de eso
   * un invitado de fuera se llevaba el nombre y el correo de todo el personal.
   */
  @Get('users/directory')
  @ApiOperation({ summary: 'Active colleagues, for people pickers' })
  @ApiResponse({ status: 200, description: 'id, name, email and picture only' })
  async findUserDirectory(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException();
    return this.usersService.findDirectory();
  }

  // --- User administration ---

  @Get('users')
  @RequirePermissions('users:read')
  @ApiOperation({ summary: 'List all users' })
  async findAllUsers() {
    const users = await this.usersService.findAll();
    return users.map((user) => this.mapper.toUserDto(user));
  }

  @Patch('users/:id')
  @RequirePermissions('users:write')
  @ApiOperation({ summary: "Change a user's role or active status" })
  @ApiResponse({ status: 200, description: 'The updated user' })
  @ApiResponse({
    status: 422,
    description: 'Self-modification, or removing the last active admin',
  })
  async updateUser(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthenticatedUser | undefined,
  ) {
    if (!actor) throw new UnauthorizedException();
    const user = await this.usersService.update(id, dto, actor.id);
    return this.mapper.toUserDto(user);
  }

  // --- Invitations ---

  @Post('users/invite')
  @RequirePermissions('users:write')
  @ApiOperation({ summary: 'Create an account and email its invitation' })
  @ApiResponse({ status: 201, description: 'The user and its invitation' })
  @ApiResponse({
    status: 409,
    description: 'USER_ALREADY_EXISTS — that email already has an account',
  })
  async inviteUser(
    @Body() dto: InviteUserDto,
    @CurrentUser() actor: AuthenticatedUser | undefined,
  ) {
    if (!actor) throw new UnauthorizedException();
    const { user, invitation } = await this.invitationsService.invite(dto, actor);
    return { user: this.mapper.toUserDto(user), invitation };
  }

  @Post('users/:id/invite/resend')
  @RequirePermissions('users:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a fresh invitation, invalidating the previous one' })
  @ApiResponse({ status: 422, description: 'The user has no pending invitation' })
  async resendInvitation(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() actor: AuthenticatedUser | undefined,
  ) {
    if (!actor) throw new UnauthorizedException();
    return { invitation: await this.invitationsService.resend(id, actor) };
  }

  @Delete('users/:id/invite')
  @RequirePermissions('users:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Cancel an invitation, which also deactivates the account',
  })
  async cancelInvitation(@Param('id', ParseIntPipe) id: number) {
    await this.invitationsService.revoke(id);
  }

  // --- Roles ---

  @Get('permissions')
  @RequirePermissions('users:read')
  @ApiOperation({ summary: 'Permission catalog, grouped for the role editor' })
  getPermissions() {
    return { permissions: PERMISSIONS, groups: PERMISSION_GROUPS };
  }

  @Get('roles')
  @RequirePermissions('users:read')
  @ApiOperation({ summary: 'List all roles with their permissions' })
  async findAllRoles() {
    const roles = await this.rolesService.findAll();
    return roles.map((role) => this.mapper.toRoleDto(role));
  }

  @Post('roles')
  @RequirePermissions('users:write')
  @ApiOperation({ summary: 'Create a role' })
  async createRole(@Body() dto: CreateRoleDto) {
    const role = await this.rolesService.create(dto);
    return this.mapper.toRoleDto(role);
  }

  @Patch('roles/:id')
  @RequirePermissions('users:write')
  @ApiOperation({ summary: 'Rename a role or change its permissions' })
  async updateRole(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRoleDto,
  ) {
    const role = await this.rolesService.update(id, dto);
    return this.mapper.toRoleDto(role);
  }

  @Delete('roles/:id')
  @RequirePermissions('users:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a role (only if custom and unassigned)' })
  async deleteRole(@Param('id', ParseIntPipe) id: number) {
    await this.rolesService.delete(id);
  }
}
