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
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import {
  PERMISSION_GROUPS,
  PERMISSIONS,
} from '../../../common/auth/permissions';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { UsersService } from './users.service';
import { RolesService } from './services/roles.service';
import { UserMapper } from './mappers/user.mapper';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@ApiTags('users')
@Controller()
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly rolesService: RolesService,
    private readonly mapper: UserMapper,
  ) {}

  // --- Current user: any authenticated caller, no permission required. ---

  @Get('users/me')
  @ApiOperation({ summary: 'Current user with their effective permissions' })
  @ApiResponse({ status: 200, description: 'The authenticated user' })
  getMe(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException();
    return user;
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
