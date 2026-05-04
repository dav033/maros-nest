import { Module } from '@nestjs/common';
import { ReportsController } from './restoration-visit/restoration-visit.controller';
import { ReportsService } from './restoration-visit/restoration-visit.service';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [ProjectsModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}

