import { ForbiddenException, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TaskCommentsRepository } from '../repositories/task-comments.repository';
import { TasksRepository } from '../repositories/tasks.repository';
import { TaskWatchersRepository } from '../repositories/task-watchers.repository';
import { TaskActivityService } from './task-activity.service';
import { CreateCommentDto } from '../dto/create-comment.dto';
import { UpdateCommentDto } from '../dto/update-comment.dto';
import { TaskComment } from '../../../../entities/task-comment.entity';
import type { TaskActor } from './task-actor';
import { TaskNotFoundException, TaskCommentNotFoundException } from '../../../../common/exceptions';
import { extractPlainTextFromTipTapDoc } from '../../../../common/utils/tiptap-text.util';

@Injectable()
export class TaskCommentsService {
  constructor(
    private readonly taskCommentsRepository: TaskCommentsRepository,
    private readonly tasksRepository: TasksRepository,
    private readonly taskWatchersRepository: TaskWatchersRepository,
    private readonly taskActivity: TaskActivityService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private toDto(comment: TaskComment): any {
    return {
      id: comment.id,
      taskId: comment.taskId,
      body: comment.body ?? {},
      author: comment.author
        ? {
            id: comment.author.id,
            name: comment.author.name ?? null,
            email: comment.author.email,
            picture: comment.author.picture ?? null,
          }
        : null,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
    };
  }

  async list(taskId: number): Promise<any[]> {
    const comments = await this.taskCommentsRepository.findByTask(taskId);
    return comments.map((comment) => this.toDto(comment));
  }

  async create(taskId: number, dto: CreateCommentDto, actor: TaskActor): Promise<any> {
    const task = await this.tasksRepository.findByIdActive(taskId);
    if (!task) throw new TaskNotFoundException(taskId);

    const comment = new TaskComment();
    comment.taskId = taskId;
    comment.authorId = actor.id;
    comment.body = dto.body;
    comment.bodyText = extractPlainTextFromTipTapDoc(dto.body);

    const saved = await this.taskCommentsRepository.save(comment);

    // Commenting makes you a watcher — see PLAN-TAREAS.md section 3.
    await this.taskWatchersRepository.addMany(taskId, [actor.id]);
    await this.taskActivity.logCommented(taskId, actor.id, saved.id);
    this.eventEmitter.emit('task.commented', {
      taskId,
      commentId: saved.id,
      actorId: actor.id,
    });

    const fresh = await this.taskCommentsRepository.findByIdActive(saved.id);
    return this.toDto(fresh as TaskComment);
  }

  async update(
    taskId: number,
    commentId: number,
    dto: UpdateCommentDto,
    actor: TaskActor,
  ): Promise<any> {
    const comment = await this.getOwned(taskId, commentId, actor);

    if (dto.body !== undefined) {
      comment.body = dto.body;
      comment.bodyText = extractPlainTextFromTipTapDoc(dto.body);
    }

    const saved = await this.taskCommentsRepository.save(comment);
    return this.toDto(saved);
  }

  async delete(taskId: number, commentId: number, actor: TaskActor): Promise<void> {
    await this.getOwned(taskId, commentId, actor);
    await this.taskCommentsRepository.softDelete(commentId);
  }

  /** Loads a comment scoped to its task, enforcing author-or-tasks:delete. */
  private async getOwned(
    taskId: number,
    commentId: number,
    actor: TaskActor,
  ): Promise<TaskComment> {
    const comment = await this.taskCommentsRepository.findByIdActive(commentId);
    if (!comment || comment.taskId !== taskId) {
      throw new TaskCommentNotFoundException(commentId);
    }
    if (comment.authorId !== actor.id && !actor.canDelete) {
      throw new ForbiddenException(
        'Only the comment author, or someone with tasks:delete, can change this comment',
      );
    }
    return comment;
  }
}
