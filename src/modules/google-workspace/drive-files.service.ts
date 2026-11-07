import { Injectable } from '@nestjs/common';
import { drive_v3, google } from 'googleapis';
import { Readable } from 'node:stream';
import { DRIVE_FILE_SCOPE } from '../google-calendar/google-scopes';
import { GoogleWorkspaceAuthService } from './google-workspace-auth.service';
import {
  DRIVE_ROOT_FOLDER,
  driveQueryLiteral,
  MAX_FOLDER_DEPTH,
  safeName,
} from './workspace-input';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FILE_FIELDS = 'id,name,webViewLink,mimeType,size';

export interface DriveUploadInput {
  /** Folders under the Maros root, e.g. ['Receipts', '064P-0826']. */
  folderPath: string[];
  name: string;
  mimeType: string;
  content: Buffer;
  /**
   * Stable identity of what is being stored (`invoice_scan:<uuid>`). A second
   * call with the same key in the same folder returns the file already there
   * instead of uploading a duplicate.
   */
  key?: string;
}

export interface DriveUploadResult {
  id: string;
  name: string;
  url: string | null;
  mimeType: string | null;
  folder: string;
  alreadyExisted: boolean;
}

/**
 * Files in the person's Drive, kept under a `Maros` folder this app creates.
 * With the `drive.file` scope Google only shows the app what the app made, so
 * lookups here can never see (or touch) anything else in that Drive.
 */
@Injectable()
export class DriveFilesService {
  constructor(private readonly auth: GoogleWorkspaceAuthService) {}

  async upload(userId: number, input: DriveUploadInput): Promise<DriveUploadResult> {
    if (input.folderPath.length > MAX_FOLDER_DEPTH) {
      throw new Error(`La carpeta admite como máximo ${MAX_FOLDER_DEPTH} niveles.`);
    }
    const client = await this.auth.clientWithScope(userId, DRIVE_FILE_SCOPE);
    const drive = google.drive({ version: 'v3', auth: client });

    const segments = [DRIVE_ROOT_FOLDER, ...input.folderPath.map((part) => safeName(part))];
    const folderId = await this.ensureFolderPath(drive, segments);
    const folder = segments.join('/');
    const name = safeName(input.name);

    if (input.key) {
      const existing = await this.findByKey(drive, folderId, input.key);
      if (existing) return this.toResult(existing, folder, true);
    }

    const { data } = await drive.files.create({
      requestBody: {
        name,
        parents: [folderId],
        ...(input.key ? { appProperties: { maros_key: input.key } } : {}),
      },
      media: { mimeType: input.mimeType, body: Readable.from(input.content) },
      fields: FILE_FIELDS,
    });
    return this.toResult(data, folder, false);
  }

  private async ensureFolderPath(drive: drive_v3.Drive, segments: string[]): Promise<string> {
    let parent = 'root';
    for (const segment of segments) {
      parent = await this.ensureFolder(drive, parent, segment);
    }
    return parent;
  }

  private async ensureFolder(drive: drive_v3.Drive, parent: string, name: string): Promise<string> {
    const q = [
      `name = ${driveQueryLiteral(name)}`,
      `mimeType = '${FOLDER_MIME}'`,
      `${driveQueryLiteral(parent)} in parents`,
      'trashed = false',
    ].join(' and ');
    const found = await drive.files.list({ q, fields: 'files(id)', pageSize: 1, spaces: 'drive' });
    const existing = found.data.files?.[0]?.id;
    if (existing) return existing;

    const created = await drive.files.create({
      requestBody: { name, mimeType: FOLDER_MIME, parents: [parent] },
      fields: 'id',
    });
    if (!created.data.id) throw new Error(`Google Drive no devolvió el id de la carpeta "${name}".`);
    return created.data.id;
  }

  private async findByKey(
    drive: drive_v3.Drive,
    folderId: string,
    key: string,
  ): Promise<drive_v3.Schema$File | null> {
    const q = [
      `appProperties has { key='maros_key' and value=${driveQueryLiteral(key)} }`,
      `${driveQueryLiteral(folderId)} in parents`,
      'trashed = false',
    ].join(' and ');
    const found = await drive.files.list({ q, fields: `files(${FILE_FIELDS})`, pageSize: 1, spaces: 'drive' });
    return found.data.files?.[0] ?? null;
  }

  private toResult(file: drive_v3.Schema$File, folder: string, alreadyExisted: boolean): DriveUploadResult {
    if (!file.id) throw new Error('Google Drive no devolvió el id del archivo.');
    return {
      id: file.id,
      name: file.name ?? '',
      url: file.webViewLink ?? null,
      mimeType: file.mimeType ?? null,
      folder,
      alreadyExisted,
    };
  }
}
