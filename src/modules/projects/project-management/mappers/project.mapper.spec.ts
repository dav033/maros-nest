import { ProjectProgressStatus } from '../../../../common/enums/project-progress-status.enum';
import { Project } from '../../../../entities/project.entity';
import type { UpdateProjectDto } from '../dto/update-project.dto';
import { ProjectMapper } from './project.mapper';

/**
 * Covers the end_date seal at its real call site. The arithmetic lives in
 * project-billing.util.spec.ts; what is proven here is that the mapper hands it the
 * *previous* status, which is the whole difference between stamping a transition and
 * resetting the aging clock on every edit.
 */
describe('ProjectMapper end_date sealing', () => {
  const mapper = new ProjectMapper();

  function project(partial: Partial<Project>): Project {
    return Object.assign(new Project(), partial);
  }

  it('seals end_date when the project moves to COMPLETED', () => {
    const entity = project({ projectProgressStatus: ProjectProgressStatus.IN_PROGRESS });

    mapper.updateEntity(
      { projectProgressStatus: ProjectProgressStatus.COMPLETED } as UpdateProjectDto,
      entity,
    );

    expect(entity.endDate).toBeInstanceOf(Date);
  });

  it('leaves an existing end_date alone — a hand-entered date is the real one', () => {
    const realCompletion = new Date(2025, 2, 14);
    const entity = project({
      projectProgressStatus: ProjectProgressStatus.IN_PROGRESS,
      endDate: realCompletion,
    });

    mapper.updateEntity(
      { projectProgressStatus: ProjectProgressStatus.COMPLETED } as UpdateProjectDto,
      entity,
    );

    expect(entity.endDate).toBe(realCompletion);
  });

  it('does not stamp an already-COMPLETED project on an unrelated edit', () => {
    const entity = project({
      projectProgressStatus: ProjectProgressStatus.COMPLETED,
      endDate: null,
    });

    mapper.updateEntity({ overview: 'added a note' } as UpdateProjectDto, entity);

    expect(entity.endDate).toBeNull();
    expect(entity.overview).toBe('added a note');
  });

  it('leaves end_date empty when the project moves to any other status', () => {
    const entity = project({ projectProgressStatus: ProjectProgressStatus.IN_PROGRESS });

    mapper.updateEntity(
      { projectProgressStatus: ProjectProgressStatus.POSTPONED } as UpdateProjectDto,
      entity,
    );

    expect(entity.endDate).toBeUndefined();
  });

  it('seals a project created straight into COMPLETED', () => {
    const entity = mapper.toEntity({
      leadId: 1,
      projectProgressStatus: ProjectProgressStatus.COMPLETED,
    });

    expect(entity.endDate).toBeInstanceOf(Date);
  });

  it('creates a non-completed project without an end date', () => {
    const entity = mapper.toEntity({
      leadId: 1,
      projectProgressStatus: ProjectProgressStatus.IN_PROGRESS,
    });

    expect(entity.endDate).toBeUndefined();
  });
});
