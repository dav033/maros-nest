import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateLeadDto } from './update-lead.dto';

async function parse(body: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(UpdateLeadDto, body);
  const errors = await validate(dto);
  return errors.map((error) => error.property);
}

describe('UpdateLeadDto sales fields', () => {
  it('accepts a source and lost reason from the closed lists', async () => {
    expect(await parse({ source: 'repeat_client', lostReason: 'no_response' })).toEqual([]);
  });

  it('rejects a source outside the list', async () => {
    expect(await parse({ source: 'linkedin' })).toEqual(['source']);
  });

  it('rejects a lost reason outside the list', async () => {
    expect(await parse({ lostReason: 'they ghosted us' })).toEqual(['lostReason']);
  });

  // Free text is what the closed list exists to prevent: 'Referral' and 'referal' would
  // split one channel into three rows of any report grouping by it.
  it('rejects a source that only differs in case', async () => {
    expect(await parse({ source: 'Referral' })).toEqual(['source']);
  });

  it('accepts null on every sales field, so each one can be cleared', async () => {
    const errors = await parse({
      ownerId: null,
      source: null,
      lostReason: null,
      nextFollowUpAt: null,
    });
    expect(errors).toEqual([]);
  });

  it('accepts a follow-up date and an owner id', async () => {
    expect(await parse({ ownerId: 7, nextFollowUpAt: '2026-04-15' })).toEqual([]);
  });

  it('rejects a follow-up date that is not a date', async () => {
    expect(await parse({ nextFollowUpAt: 'next tuesday' })).toEqual(['nextFollowUpAt']);
  });

  it('rejects a non-integer owner id', async () => {
    expect(await parse({ ownerId: 'me' })).toEqual(['ownerId']);
  });

  it('still accepts a patch that touches none of them', async () => {
    expect(await parse({ name: 'Renamed lead' })).toEqual([]);
  });
});
