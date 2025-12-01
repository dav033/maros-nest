export interface CrudService<D, ID> {
  create(dto: D): Promise<D>;
  findAll(): Promise<D[]>;
  findById(id: ID): Promise<D>;
  update(id: ID, dto: D): Promise<D>;
  delete(id: ID): Promise<void>;
  saveAll(dtos: D[]): Promise<D[]>;
}
