import { BadRequestException } from '@nestjs/common';
import { google } from 'googleapis';
import { AttachmentSourceService } from './attachment-source.service';
import { DriveFilesService } from './drive-files.service';

jest.mock('googleapis', () => ({ google: { drive: jest.fn() } }));

const READONLY = 'https://www.googleapis.com/auth/drive.readonly';
const FILE_ONLY = 'https://www.googleapis.com/auth/drive.file';
const auth = {
  clientWithScope: jest.fn().mockResolvedValue({}),
  clientWithAnyScope: jest.fn().mockResolvedValue({ client: {}, granted: READONLY }),
};
const MB = 1024 * 1024;

beforeEach(() => {
  jest.clearAllMocks();
  auth.clientWithScope.mockResolvedValue({});
  auth.clientWithAnyScope.mockResolvedValue({ client: {}, granted: READONLY });
});

function mockDriveFiles(handlers: {
  get?: jest.Mock;
  export?: jest.Mock;
  list?: jest.Mock;
  create?: jest.Mock;
}) {
  const files = {
    get: handlers.get ?? jest.fn(),
    export: handlers.export ?? jest.fn(),
    list: handlers.list ?? jest.fn().mockResolvedValue({ data: { files: [] } }),
    create: handlers.create ?? jest.fn().mockResolvedValue({ data: { id: 'n1', name: 'x', webViewLink: 'https://drive/n1' } }),
  };
  (google.drive as jest.Mock).mockReturnValue({ files });
  return files;
}

const buffer = (text: string) => Uint8Array.from(Buffer.from(text)).buffer;

describe('DriveFilesService.download', () => {
  const service = () => new DriveFilesService(auth as never);

  it('downloads a regular file as the acting person', async () => {
    const get = jest
      .fn()
      .mockResolvedValueOnce({ data: { id: 'f', name: 'waiver.pdf', mimeType: 'application/pdf', size: '4' } })
      .mockResolvedValueOnce({ data: buffer('%PDF') });
    mockDriveFiles({ get });

    const file = await service().download(7, 'file-id-123456', 5 * MB);

    expect(auth.clientWithAnyScope).toHaveBeenCalledWith(7, [READONLY, FILE_ONLY]);
    expect(file).toMatchObject({ fileName: 'waiver.pdf', contentType: 'application/pdf' });
    expect(file.content.toString()).toBe('%PDF');
    expect(get.mock.calls[1][0]).toMatchObject({ fileId: 'file-id-123456', alt: 'media' });
  });

  it('exports Google Docs to PDF and names the result .pdf', async () => {
    const exportPdf = jest.fn().mockResolvedValue({ data: buffer('%PDF-doc') });
    mockDriveFiles({
      get: jest.fn().mockResolvedValue({ data: { id: 'f', name: 'Credit form', mimeType: 'application/vnd.google-apps.document' } }),
      export: exportPdf,
    });

    const file = await service().download(7, 'doc-id-1234567', 5 * MB);

    expect(exportPdf.mock.calls[0][0]).toMatchObject({ mimeType: 'application/pdf' });
    expect(file).toMatchObject({ fileName: 'Credit form.pdf', contentType: 'application/pdf' });
  });

  it('with only drive.file, a 404 explains that Maros sees just its own files and how to widen it', async () => {
    auth.clientWithAnyScope.mockResolvedValue({ client: {}, granted: FILE_ONLY });
    mockDriveFiles({ get: jest.fn().mockRejectedValue({ code: 404 }) });

    await expect(service().download(7, 'someone-elses-file', 5 * MB)).rejects.toThrow(/solo accede a los que él mismo guardó.*Reconecta Google/s);
  });

  it('with drive.readonly, a 404 simply means the file does not exist or is not shared', async () => {
    mockDriveFiles({ get: jest.fn().mockRejectedValue({ code: 404 }) });

    await expect(service().download(7, 'missing-file-id', 5 * MB)).rejects.toThrow(/No existe ese archivo de Drive/);
  });

  it.each([
    ['a trashed file', { id: 'f', name: 'a.pdf', mimeType: 'application/pdf', size: '1', trashed: true }, /papelera/],
    ['a folder', { id: 'f', name: 'dir', mimeType: 'application/vnd.google-apps.folder' }, /carpeta/],
    ['a file over the limit', { id: 'f', name: 'big.pdf', mimeType: 'application/pdf', size: String(6 * MB) }, /supera el máximo/],
  ])('refuses %s without downloading it', async (_label, meta, message) => {
    const get = jest.fn().mockResolvedValue({ data: meta });
    mockDriveFiles({ get });

    await expect(service().download(7, 'file-id-123456', 5 * MB)).rejects.toThrow(message);
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('DriveFilesService.upload avoidOverwrite', () => {
  const input = { folderPath: ['Receipts', '064P-0826'], name: '064P-HomeDepot-1250.00.pdf', mimeType: 'application/pdf', content: Buffer.from('x') };
  const nameOf = (q: string) => /name = '((?:[^'\\]|\\.)*)'/.exec(q)?.[1];

  /** Folders always exist; the listed file names are "already in the folder". */
  function withExisting(taken: string[]) {
    const list = jest.fn(({ q }: { q: string }) => {
      if (q.includes("mimeType = 'application/vnd.google-apps.folder'")) return Promise.resolve({ data: { files: [{ id: 'folder' }] } });
      const name = nameOf(q);
      return Promise.resolve({ data: { files: name && taken.includes(name) ? [{ id: 'dup' }] : [] } });
    });
    const create = jest.fn().mockResolvedValue({ data: { id: 'new', name: 'x', webViewLink: 'u' } });
    mockDriveFiles({ list, create });
    return create;
  }

  it('keeps the requested name when it is free', async () => {
    const create = withExisting([]);

    const result = await new DriveFilesService(auth as never).upload(7, { ...input, avoidOverwrite: true });

    expect(create.mock.calls[0][0].requestBody.name).toBe('064P-HomeDepot-1250.00.pdf');
    expect(result.renamed).toBe(false);
  });

  it('numbers a taken name instead of overwriting or duplicating it', async () => {
    const create = withExisting(['064P-HomeDepot-1250.00.pdf', '064P-HomeDepot-1250.00-2.pdf']);

    const result = await new DriveFilesService(auth as never).upload(7, { ...input, avoidOverwrite: true });

    expect(create.mock.calls[0][0].requestBody.name).toBe('064P-HomeDepot-1250.00-3.pdf');
    expect(result.renamed).toBe(true);
  });

  it('does not rename when avoidOverwrite is off', async () => {
    const create = withExisting(['064P-HomeDepot-1250.00.pdf']);

    await new DriveFilesService(auth as never).upload(7, input);

    expect(create.mock.calls[0][0].requestBody.name).toBe('064P-HomeDepot-1250.00.pdf');
  });
});

describe('AttachmentSourceService with Drive files', () => {
  function sources(download: jest.Mock) {
    return new AttachmentSourceService({} as never, {} as never, { download } as never);
  }

  it('attaches a Drive file as the acting person', async () => {
    const download = jest.fn().mockResolvedValue({ content: Buffer.from('%PDF'), fileName: 'Waiver 1.pdf', contentType: 'application/pdf' });

    const files = await sources(download).resolveAll(7, [{ kind: 'drive_file', fileId: 'abcdefghij12345' }]);

    expect(download).toHaveBeenCalledWith(7, 'abcdefghij12345', 5 * MB);
    expect(files).toEqual([{ fileName: 'Waiver 1.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF') }]);
  });

  it('refuses when the attachments add up to more than Gmail allows', async () => {
    const big = Buffer.alloc(5 * MB);
    const download = jest.fn().mockResolvedValue({ content: big, fileName: 'a.pdf', contentType: 'application/pdf' });
    const specs = Array.from({ length: 5 }, (_, i) => ({ kind: 'drive_file' as const, fileId: `abcdefghij${i}2345` }));

    await expect(sources(download).resolveAll(7, specs)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses more than ten attachments before downloading anything', async () => {
    const download = jest.fn();
    const specs = Array.from({ length: 11 }, (_, i) => ({ kind: 'drive_file' as const, fileId: `abcdefghij${i}2345` }));

    await expect(sources(download).resolveAll(7, specs)).rejects.toBeInstanceOf(BadRequestException);
    expect(download).not.toHaveBeenCalled();
  });
});

describe('DriveFilesService.search', () => {
  const service = () => new DriveFilesService(auth as never);

  it('builds an escaped, read-only query and reports whole-Drive visibility', async () => {
    const list = jest.fn().mockResolvedValue({
      data: { files: [{ id: 'a1', name: 'Waiver 064P.pdf', mimeType: 'application/pdf', size: '2048', modifiedTime: '2026-11-01T10:00:00Z', webViewLink: 'https://drive/a1' }] },
    });
    mockDriveFiles({ list });

    const result = await service().search(7, {
      nameContains: "O'Brien waiver",
      mimeType: 'application/pdf',
      folderId: 'folderid123456',
      modifiedAfter: '2026-11-01',
      limit: 20,
    });

    const call = list.mock.calls[0][0];
    expect(call.q).toContain("name contains 'O\\'Brien waiver'");
    expect(call.q).toContain("mimeType = 'application/pdf'");
    expect(call.q).toContain("'folderid123456' in parents");
    expect(call.q).toContain("modifiedTime > '2026-11-01'");
    expect(call.q).toContain('trashed = false');
    expect(call).toMatchObject({ pageSize: 20, orderBy: 'modifiedTime desc' });
    expect(result).toEqual({
      visibility: 'all',
      files: [{ id: 'a1', name: 'Waiver 064P.pdf', mimeType: 'application/pdf', sizeBytes: 2048, modifiedTime: '2026-11-01T10:00:00Z', url: 'https://drive/a1' }],
    });
  });

  it('says so when the connection only sees the files Maros saved', async () => {
    auth.clientWithAnyScope.mockResolvedValue({ client: {}, granted: FILE_ONLY });
    mockDriveFiles({ list: jest.fn().mockResolvedValue({ data: { files: [] } }) });

    expect((await service().search(7, { limit: 5 })).visibility).toBe('app_files_only');
  });

  it('cannot be turned into a different query by quotes in the name', async () => {
    const list = jest.fn().mockResolvedValue({ data: { files: [] } });
    mockDriveFiles({ list });

    await service().search(7, { nameContains: "x' or trashed = true or name contains '", limit: 5 });

    expect(list.mock.calls[0][0].q).toContain("name contains 'x\\' or trashed = true or name contains \\''");
  });
});
