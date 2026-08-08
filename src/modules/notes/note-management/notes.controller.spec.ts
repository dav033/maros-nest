import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Server } from 'node:http';
import request from 'supertest';
import type { NextFunction, Response } from 'express';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';
import { NoteTagsService } from './services/note-tags.service';
import type { RequestWithUser } from '../../../common/auth/authenticated-user';

const TEST_USER_ID = 7;

/** Stands in for SessionAuthGuard, which isn't part of this isolated module. */
function stubCurrentUser(req: RequestWithUser, _res: Response, next: NextFunction) {
  req.user = {
    id: TEST_USER_ID,
    email: 'test@marosconstruction.com',
    name: 'Test User',
    picture: null,
    role: { id: 1, name: 'admin' },
    permissions: [],
  };
  next();
}

describe('NotesController route ordering and validation', () => {
  let app: INestApplication;
  let server: Server;
  let notesService: Record<string, jest.Mock>;
  let noteTagsService: Record<string, jest.Mock>;

  beforeEach(async () => {
    notesService = {
      getAllNotes: jest.fn().mockResolvedValue([]),
      getTrash: jest.fn().mockResolvedValue([{ id: 1, title: 'Trashed' }]),
      getFavorites: jest.fn().mockResolvedValue([]),
      searchNotes: jest.fn().mockResolvedValue([]),
      getNoteById: jest.fn().mockResolvedValue({ id: 42 }),
      updateNoteContent: jest.fn().mockResolvedValue({ id: 1 }),
      createNote: jest.fn().mockResolvedValue({ id: 1 }),
    };
    noteTagsService = {
      listTags: jest.fn().mockResolvedValue([{ id: 1, name: 'Urgent', color: 'red' }]),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [NotesController],
      providers: [
        { provide: NotesService, useValue: notesService },
        { provide: NoteTagsService, useValue: noteTagsService },
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
    expect(notesService.searchNotes).toHaveBeenCalledWith('permit', 20, TEST_USER_ID);
  });

  it('GET /notes/:id falls through to getNoteById for a numeric id', async () => {
    const res = await request(server).get('/notes/42').expect(200);
    expect(notesService.getNoteById).toHaveBeenCalledWith(42, TEST_USER_ID);
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

    expect(notesService.updateNoteContent).toHaveBeenCalledWith(1, { content: doc }, TEST_USER_ID);
  });

  it('rejects unknown top-level properties on create', async () => {
    await request(server)
      .post('/notes')
      .send({ title: 'Doc', unexpected: true })
      .expect(400);
    expect(notesService.createNote).not.toHaveBeenCalled();
  });
});
