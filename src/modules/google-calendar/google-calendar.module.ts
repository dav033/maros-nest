import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Lead } from '../../entities/lead.entity';
import { Task } from '../../entities/task.entity';
import { QuickbooksModule } from '../quickbooks/quickbooks.module';
import { GoogleCalendarConnection } from './entities/google-calendar-connection.entity';
import { GoogleCalendarMeeting } from './entities/google-calendar-meeting.entity';
import { GoogleCalendarController } from './google-calendar.controller';
import { GoogleCalendarService } from './google-calendar.service';

@Module({
  imports: [
    QuickbooksModule,
    TypeOrmModule.forFeature([
      GoogleCalendarConnection,
      GoogleCalendarMeeting,
      Lead,
      Task,
    ]),
  ],
  controllers: [GoogleCalendarController],
  providers: [GoogleCalendarService],
})
export class GoogleCalendarModule {}
