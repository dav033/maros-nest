import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { ImportQuickbooksBatchDto } from './import-quickbooks-batch.dto';
import { ImportQuickbooksProjectDto } from './import-quickbooks-project.dto';

/** La misma configuracion que main.ts instala como pipe global. */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const asBody = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({
  type: 'body',
  metatype,
});

/** Los mensajes que devolveria el endpoint, o un fallo si la entrada pasa. */
async function rejectionMessages(
  payload: object,
  metatype: ArgumentMetadata['metatype'],
): Promise<string> {
  try {
    await pipe.transform(payload, asBody(metatype));
  } catch (error) {
    const response = (error as BadRequestException).getResponse() as {
      message: string[];
    };
    return response.message.join(' | ');
  }
  throw new Error('The ValidationPipe accepted a payload it should have rejected.');
}

describe('ImportQuickbooksProjectDto', () => {
  it('accepts a decision aimed at an existing CRM project', async () => {
    await expect(
      pipe.transform(
        { qboCustomerId: '387', projectNumber: '001R-0625', projectId: 70 },
        asBody(ImportQuickbooksProjectDto),
      ),
    ).resolves.toBeInstanceOf(ImportQuickbooksProjectDto);
  });

  it('rejects a write without the QuickBooks job or the project number', async () => {
    expect(await rejectionMessages({}, ImportQuickbooksProjectDto)).toContain(
      'qboCustomerId',
    );
    expect(
      await rejectionMessages({ qboCustomerId: '387' }, ImportQuickbooksProjectDto),
    ).toContain('projectNumber');
  });

  it('rejects a CRM id that is not an integer', async () => {
    expect(
      await rejectionMessages(
        { qboCustomerId: '387', projectNumber: '001R-0625', leadId: 'fifty' },
        ImportQuickbooksProjectDto,
      ),
    ).toContain('leadId');
  });

  it('rejects unknown properties instead of letting them through', async () => {
    expect(
      await rejectionMessages(
        { qboCustomerId: '387', projectNumber: '001R-0625', qboCustomerid: '388' },
        ImportQuickbooksProjectDto,
      ),
    ).toContain('qboCustomerid');
  });
});

describe('ImportQuickbooksBatchDto', () => {
  it('validates every decision, not just the wrapper', async () => {
    expect(
      await rejectionMessages(
        { decisions: [{ qboCustomerId: '387' }] },
        ImportQuickbooksBatchDto,
      ),
    ).toContain('projectNumber');
  });

  it('turns a well formed batch into decision instances', async () => {
    const value = (await pipe.transform(
      { decisions: [{ qboCustomerId: '387', projectNumber: '001R-0625' }] },
      asBody(ImportQuickbooksBatchDto),
    )) as ImportQuickbooksBatchDto;

    expect(value.decisions[0]).toBeInstanceOf(ImportQuickbooksProjectDto);
  });
});
