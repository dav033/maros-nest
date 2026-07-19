import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Server } from 'node:http';
import request from 'supertest';
import { LeadStatus } from '../../../common/enums/lead-status.enum';
import { LeadType } from '../../../common/enums/lead-type.enum';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

describe('LeadsController validation', () => {
  let app: INestApplication;
  let server: Server;
  let leadsService: { updateLead: jest.Mock; getLeadsByType: jest.Mock };

  beforeEach(async () => {
    leadsService = {
      updateLead: jest.fn().mockResolvedValue({ id: 1 }),
      getLeadsByType: jest.fn().mockResolvedValue([]),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [LeadsController],
      providers: [{ provide: LeadsService, useValue: leadsService }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects an invalid nested status', async () => {
    await request(server)
      .put('/leads/1')
      .send({ lead: { status: 'INVALID' } })
      .expect(400);

    expect(leadsService.updateLead).not.toHaveBeenCalled();
  });

  it('rejects unknown nested properties', async () => {
    await request(server)
      .put('/leads/1')
      .send({ lead: { status: LeadStatus.WON, unexpected: true } })
      .expect(400);

    expect(leadsService.updateLead).not.toHaveBeenCalled();
  });

  it('rejects an array instead of a lead object', async () => {
    await request(server)
      .put('/leads/1')
      .send({ lead: [{ status: LeadStatus.WON }] })
      .expect(400);

    expect(leadsService.updateLead).not.toHaveBeenCalled();
  });

  it('accepts a valid WON update', async () => {
    await request(server)
      .put('/leads/1')
      .send({ lead: { status: LeadStatus.WON } })
      .expect(200);

    expect(leadsService.updateLead).toHaveBeenCalledWith(1, {
      status: LeadStatus.WON,
    });
  });

  it('rejects a missing lead type instead of returning every type', async () => {
    await request(server).get('/leads/type').expect(400);

    expect(leadsService.getLeadsByType).not.toHaveBeenCalled();
  });

  it('rejects an invalid lead type', async () => {
    await request(server).get('/leads/type?type=INVALID').expect(400);

    expect(leadsService.getLeadsByType).not.toHaveBeenCalled();
  });

  it('accepts a valid lead type', async () => {
    await request(server)
      .get(`/leads/type?type=${LeadType.CONSTRUCTION}`)
      .expect(200);

    expect(leadsService.getLeadsByType).toHaveBeenCalledWith(
      LeadType.CONSTRUCTION,
      { includeQbo: true },
    );
  });
});
