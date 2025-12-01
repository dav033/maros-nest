import { Repository, ObjectLiteral } from 'typeorm';
import { ResourceNotFoundException } from '../exceptions';
import { CrudService } from '../interfaces/crud-service.interface';

export abstract class BaseService<D, ID, E extends ObjectLiteral> implements CrudService<D, ID> {
  constructor(
    protected readonly repository: Repository<E>,
    protected readonly mapper: any, // GenericMapper<D, E>
  ) {}

  async create(dto: D): Promise<D> {
    const entity = this.mapper.toEntity(dto);
    const saved = await this.repository.save(entity);
    return this.mapper.toDto(saved);
  }

  async findAll(): Promise<D[]> {
    const entities = await this.repository.find();
    return entities.map((entity) => this.mapper.toDto(entity));
  }

  async findById(id: ID): Promise<D> {
    const entity = await this.repository.findOne({ where: { id } as any });
    if (!entity) {
      throw new ResourceNotFoundException(`Entity not found with id ${id}`);
    }
    return this.mapper.toDto(entity);
  }

  async update(id: ID, dto: D): Promise<D> {
    const entity = await this.repository.findOne({ where: { id } as any });
    if (!entity) {
      throw new ResourceNotFoundException(`Entity not found with id ${id}`);
    }
    this.mapper.updateEntity(dto, entity);
    const saved = await this.repository.save(entity);
    return this.mapper.toDto(saved);
  }

  async delete(id: ID): Promise<void> {
    await this.repository.delete(id as any);
  }

  async saveAll(dtos: D[]): Promise<D[]> {
    const entities = dtos.map((dto) => this.mapper.toEntity(dto));
    const savedEntities = await this.repository.save(entities);
    return savedEntities.map((entity) => this.mapper.toDto(entity));
  }
}
