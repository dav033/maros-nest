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

/**
 * El pronostico de coste. Lo que se prueba aqui es la diferencia entre "nadie lo
 * escribio" y "escribieron cero", y que la fecha solo se sella cuando la cifra
 * cambia: una fecha que se refresca en cada guardado del proyecto hace pasar por
 * recien revisado un pronostico de hace tres meses.
 */
describe('ProjectMapper cost forecast', () => {
  const mapper = new ProjectMapper();

  function project(partial: Partial<Project> = {}): Project {
    return Object.assign(new Project(), partial);
  }

  it('writes both figures and stamps when they were written', () => {
    const entity = project();

    mapper.updateEntity(
      { forecastMaterialCost: 120000, forecastSubcontractorCost: 85000.5 } as UpdateProjectDto,
      entity,
    );

    expect(entity.forecastMaterialCost).toBe('120000.00');
    expect(entity.forecastSubcontractorCost).toBe('85000.50');
    expect(entity.forecastUpdatedAt).toBeInstanceOf(Date);
  });

  it('leaves the forecast alone when the update does not mention it', () => {
    const entity = project({
      forecastMaterialCost: '120000.00',
      forecastUpdatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    mapper.updateEntity({ overview: 'otra cosa' } as UpdateProjectDto, entity);

    expect(entity.forecastMaterialCost).toBe('120000.00');
    expect(entity.forecastUpdatedAt).toEqual(new Date('2026-01-01T00:00:00Z'));
  });

  /** `null` borra; 0 es una cifra que alguien escribio. */
  it('clears the forecast with null and keeps an explicit zero', () => {
    const entity = project({ forecastMaterialCost: '120000.00' });

    mapper.updateEntity(
      { forecastMaterialCost: null, forecastSubcontractorCost: 0 } as UpdateProjectDto,
      entity,
    );

    expect(entity.forecastMaterialCost).toBeNull();
    expect(entity.forecastSubcontractorCost).toBe('0.00');
  });

  it('does not restamp when the figure comes back the same', () => {
    const stamped = new Date('2026-01-01T00:00:00Z');
    const entity = project({ forecastMaterialCost: '120000.00', forecastUpdatedAt: stamped });

    // Postgres devuelve numeric como cadena, asi que 120000 y "120000.00" son la
    // misma cifra escrita de dos formas.
    mapper.updateEntity({ forecastMaterialCost: 120000 } as UpdateProjectDto, entity);

    expect(entity.forecastUpdatedAt).toEqual(stamped);
  });

  it('reads the forecast back as a number, and a missing one as null', () => {
    const dto = mapper.toDto(
      project({ id: 77, forecastMaterialCost: '105600.23', forecastSubcontractorCost: null }),
    );

    expect(dto.forecastMaterialCost).toBe(105600.23);
    expect(dto.forecastSubcontractorCost).toBeNull();
  });
});
