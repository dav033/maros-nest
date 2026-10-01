import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../entities/user.entity';
import { Role } from '../../entities/role.entity';
import { RolePermission } from '../../entities/role-permission.entity';
import { UserInvitation } from '../../entities/user-invitation.entity';
import { MailModule } from '../mail/mail.module';
import { UsersRepository } from './user-management/repositories/users.repository';
import { RolesRepository } from './user-management/repositories/roles.repository';
import { UserInvitationsRepository } from './user-management/repositories/user-invitations.repository';
import { UsersService } from './user-management/users.service';
import { RolesService } from './user-management/services/roles.service';
import { UserInvitationsService } from './user-management/services/user-invitations.service';
import { UserInvitationNotificationsService } from './user-management/services/user-invitation-notifications.service';
import { UsersController } from './user-management/users.controller';
import { AuthInvitationsController } from './user-management/auth-invitations.controller';
import { UserMapper } from './user-management/mappers/user.mapper';

/**
 * Global because the app-wide SessionAuthGuard depends on UsersService to
 * resolve every request's identity; without this it would have to be imported
 * into every feature module.
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([User, Role, RolePermission, UserInvitation]),
    MailModule,
  ],
  controllers: [UsersController, AuthInvitationsController],
  providers: [
    UsersRepository,
    RolesRepository,
    UserInvitationsRepository,
    UsersService,
    RolesService,
    UserInvitationsService,
    UserInvitationNotificationsService,
    UserMapper,
  ],
  exports: [
    UsersService,
    RolesService,
    UserInvitationsService,
    UsersRepository,
    RolesRepository,
  ],
})
export class UsersModule {}
