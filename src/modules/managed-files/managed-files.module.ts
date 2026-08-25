import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskFile } from '../../entities/task-file.entity';
import { Task } from '../../entities/task.entity';
import { TaskWorkspace } from '../../entities/task-workspace.entity';
import { S3Module } from '../s3/s3.module';
import { ManagedFilesController } from './managed-files.controller';
import { ManagedFilesService } from './managed-files.service';

@Module({
  imports: [TypeOrmModule.forFeature([TaskFile, Task, TaskWorkspace]), S3Module],
  controllers: [ManagedFilesController],
  providers: [ManagedFilesService],
  exports: [ManagedFilesService],
})
export class ManagedFilesModule {}
