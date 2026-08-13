import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SearchTasksDto } from './search-tasks.dto';

async function parse(query: Record<string, unknown>): Promise<{ dto: SearchTasksDto; errors: unknown[] }> {
  const dto = plainToInstance(SearchTasksDto, query);
  const errors = await validate(dto);
  return { dto, errors };
}

describe('SearchTasksDto', () => {
  it('normalizes a single status value to a one-element array', async () => {
    const { dto, errors } = await parse({ status: 'todo' });
    expect(errors).toHaveLength(0);
    expect(dto.status).toEqual(['todo']);
  });

  it('accepts several status values as an array (axios-style status[]=a&status[]=b)', async () => {
    const { dto, errors } = await parse({ status: ['todo', 'in_progress'] });
    expect(errors).toHaveLength(0);
    expect(dto.status).toEqual(['todo', 'in_progress']);
  });

  it('rejects an invalid value inside a multi-value status filter', async () => {
    const { errors } = await parse({ status: ['todo', 'not_a_real_status'] });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatchObject({ property: 'status' });
  });

  it('normalizes and coerces a single numeric assigneeUserId', async () => {
    const { dto, errors } = await parse({ assigneeUserId: '7' });
    expect(errors).toHaveLength(0);
    expect(dto.assigneeUserId).toEqual([7]);
  });

  it('accepts several assigneeUserId values', async () => {
    const { dto, errors } = await parse({ assigneeUserId: ['7', '9'] });
    expect(errors).toHaveLength(0);
    expect(dto.assigneeUserId).toEqual([7, 9]);
  });

  it('leaves an omitted filter as undefined, not an empty array', async () => {
    const { dto, errors } = await parse({});
    expect(errors).toHaveLength(0);
    expect(dto.status).toBeUndefined();
    expect(dto.kind).toBeUndefined();
    expect(dto.priority).toBeUndefined();
  });

  it('still validates entityKind as a single value, unaffected by the multi-value change', async () => {
    const { errors } = await parse({ entityKind: 'not_a_kind' });
    expect(errors.length).toBeGreaterThan(0);
  });
});
