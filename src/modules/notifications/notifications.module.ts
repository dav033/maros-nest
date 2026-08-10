import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from '../../entities/notification.entity';
import { NotificationsRepository } from './repositories/notifications.repository';
import { NotificationMapper } from './mappers/notification.mapper';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Notification])],
  controllers: [NotificationsController],
  providers: [NotificationsRepository, NotificationMapper, NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
