import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../entities/user.entity';
import { Role } from '../../entities/role.entity';
import { RolePermission } from '../../entities/role-permission.entity';
import { UsersRepository } from './user-management/repositories/users.repository';
import { RolesRepository } from './user-management/repositories/roles.repository';
import { UsersService } from './user-management/users.service';
import { RolesService } from './user-management/services/roles.service';
import { UsersController } from './user-management/users.controller';
import { UserMapper } from './user-management/mappers/user.mapper';

/**
 * Global because the app-wide SessionAuthGuard depends on UsersService to
 * resolve every request's identity; without this it would have to be imported
 * into every feature module.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([User, Role, RolePermission])],
  controllers: [UsersController],
  providers: [
    UsersRepository,
    RolesRepository,
    UsersService,
    RolesService,
    UserMapper,
  ],
  exports: [UsersService, RolesService, UsersRepository, RolesRepository],
})
export class UsersModule {}
