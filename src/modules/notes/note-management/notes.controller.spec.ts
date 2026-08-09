import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Server } from 'node:http';
import request from 'supertest';
import type { NextFunction, Response } from 'express';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';
import { NoteTagsService } from './services/note-tags.service';
import { NoteSharingService } from '../note-sharing/note-sharing.service';
import type { RequestWithUser } from '../../../common/auth/authenticated-user';

const TEST_USER_ID = 7;

/**
 * Stands in for SessionAuthGuard, which isn't part of this isolated module. The
 * permissions matter: the controller turns the user into a NoteActor, and `canWrite`
 * is read straight off this list.
 */
function stubCurrentUser(req: RequestWithUser, _res: Response, next: NextFunction) {
  req.user = {
    id: TEST_USER_ID,
    email: 'test@marosconstruction.com',
    name: 'Test User',
    picture: null,
    role: { id: 1, name: 'admin' },
    permissions: ['notes:read', 'notes:write', 'notes:delete'],
  };
  next();
}

describe('NotesController route ordering and validation', () => {
  let app: INestApplication;
  let server: Server;
  let notesService: Record<string, jest.Mock>;
  let noteTagsService: Record<string, jest.Mock>;
  let sharingService: Record<string, jest.Mock>;

  beforeEach(async () => {
    notesService = {
      getAllNotes: jest.fn().mockResolvedValue([]),
      getTrash: jest.fn().mockResolvedValue([{ id: 1, title: 'Trashed' }]),
      getFavorites: jest.fn().mockResolvedValue([]),
      searchNotes: jest.fn().mockResolvedValue([]),
      getNoteById: jest.fn().mockResolvedValue({ id: 42 }),
      updateNoteContent: jest.fn().mockResolvedValue({ id: 1 }),
      createNote: jest.fn().mockResolvedValue({ id: 1 }),
      setEntityLink: jest.fn().mockResolvedValue({ id: 1 }),
      getSharedWithMe: jest.fn().mockResolvedValue([{ id: 3, title: 'Shared' }]),
    };
    sharingService = {
      listAllActiveLinks: jest.fn().mockResolvedValue([]),
      getAccessPanel: jest.fn().mockResolvedValue({ pageId: 42, myAccess: 'owner' }),
    };
    noteTagsService = {
      listTags: jest.fn().mockResolvedValue([{ id: 1, name: 'Urgent', color: 'red' }]),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [NotesController],
      providers: [
        { provide: NotesService, useValue: notesService },
        { provide: NoteTagsService, useValue: noteTagsService },
        { provide: NoteSharingService, useValue: sharingService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(stubCurrentUser);
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

  it('GET /notes/trash hits the trash handler, not getNoteById', async () => {
    const res = await request(server).get('/notes/trash').expect(200);

    expect(notesService.getTrash).toHaveBeenCalledTimes(1);
    expect(notesService.getNoteById).not.toHaveBeenCalled();
    expect(res.body).toEqual([{ id: 1, title: 'Trashed' }]);
  });

  it('GET /notes/shared-with-me hits its own handler, not getNoteById', async () => {
    // Every static segment added under /notes is one more chance to be swallowed by
    // ':id'. That is what this whole suite exists to catch.
    const res = await request(server).get('/notes/shared-with-me').expect(200);

    expect(notesService.getSharedWithMe).toHaveBeenCalledTimes(1);
    expect(notesService.getNoteById).not.toHaveBeenCalled();
    expect(res.body).toEqual([{ id: 3, title: 'Shared' }]);
  });

  it('GET /notes/links lists workspace share links, not a note called "links"', async () => {
    await request(server).get('/notes/links').expect(200);

    expect(sharingService.listAllActiveLinks).toHaveBeenCalledTimes(1);
    expect(notesService.getNoteById).not.toHaveBeenCalled();
  });

  it('GET /notes/:id/access reaches the sharing service', async () => {
    await request(server).get('/notes/42/access').expect(200);

    expect(sharingService.getAccessPanel).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ id: TEST_USER_ID }),
    );
  });

  it('GET /notes/favorites hits the favorites handler, not getNoteById', async () => {
    await request(server).get('/notes/favorites').expect(200);
    expect(notesService.getFavorites).toHaveBeenCalledTimes(1);
    expect(notesService.getNoteById).not.toHaveBeenCalled();
  });

  it('GET /notes/tags hits the tags handler, not getNoteById', async () => {
    const res = await request(server).get('/notes/tags').expect(200);
    expect(noteTagsService.listTags).toHaveBeenCalledTimes(1);
    expect(notesService.getNoteById).not.toHaveBeenCalled();
    expect(res.body).toEqual([{ id: 1, name: 'Urgent', color: 'red' }]);
  });

  it('GET /notes/search requires a non-empty q', async () => {
    await request(server).get('/notes/search').expect(400);
    expect(notesService.searchNotes).not.toHaveBeenCalled();
  });

  it('GET /notes/search calls through with a valid query', async () => {
    await request(server).get('/notes/search?q=permit').expect(200);
    expect(notesService.searchNotes).toHaveBeenCalledWith('permit', 20, expect.objectContaining({ id: TEST_USER_ID }));
  });

  it('GET /notes/:id falls through to getNoteById for a numeric id', async () => {
    const res = await request(server).get('/notes/42').expect(200);
    expect(notesService.getNoteById).toHaveBeenCalledWith(42, expect.objectContaining({ id: TEST_USER_ID }));
    expect(res.body).toEqual({ id: 42 });
  });

  it('rejects non-object content on the autosave endpoint', async () => {
    await request(server)
      .patch('/notes/1/content')
      .send({ content: 'not-an-object' })
      .expect(400);
    expect(notesService.updateNoteContent).not.toHaveBeenCalled();
  });

  it('accepts an arbitrary nested TipTap doc unmodified on the autosave endpoint', async () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }],
    };

    await request(server).patch('/notes/1/content').send({ content: doc }).expect(200);

    expect(notesService.updateNoteContent).toHaveBeenCalledWith(1, { content: doc }, expect.objectContaining({ id: TEST_USER_ID }));
  });

  it('rejects unknown top-level properties on create', async () => {
    await request(server)
      .post('/notes')
      .send({ title: 'Doc', unexpected: true })
      .expect(400);
    expect(notesService.createNote).not.toHaveBeenCalled();
  });

  it('links a note to a CRM entity', async () => {
    await request(server)
      .patch('/notes/1/entity')
      .send({ entityKind: 'lead', entityId: 42 })
      .expect(200);

    expect(notesService.setEntityLink).toHaveBeenCalledWith(
      1,
      { entityKind: 'lead', entityId: 42 },
      expect.objectContaining({ id: TEST_USER_ID }),
    );
  });

  it('accepts an explicit null pair as "unlink"', async () => {
    await request(server)
      .patch('/notes/1/entity')
      .send({ entityKind: null, entityId: null })
      .expect(200);

    expect(notesService.setEntityLink).toHaveBeenCalledWith(
      1,
      { entityKind: null, entityId: null },
      expect.objectContaining({ id: TEST_USER_ID }),
    );
  });

  it('rejects an entity kind outside the CRM set', async () => {
    await request(server)
      .patch('/notes/1/entity')
      .send({ entityKind: 'invoice', entityId: 42 })
      .expect(400);
    expect(notesService.setEntityLink).not.toHaveBeenCalled();
  });
});
