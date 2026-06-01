import {
  Controller,
  Get,
  Header,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Express } from 'express';
import { ValidationException } from '../../common/exceptions';
import { S3Service } from './services/s3.service';

@ApiExcludeController()
@Controller('s3')
export class S3UploadController {
  constructor(private readonly s3Service: S3Service) {}

  @Get('upload')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getUploadPage(): string {
    const rules = this.s3Service.getUploadRules();
    const maxMb = (rules.maxUploadBytes / (1024 * 1024)).toFixed(2);

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>S3 Upload Test</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 24px; color: #1f2937; }
      .card { max-width: 680px; padding: 20px; border: 1px solid #d1d5db; border-radius: 10px; }
      h1 { margin-top: 0; font-size: 22px; }
      p { margin: 6px 0; }
      input[type="file"] { margin: 12px 0; }
      button { background: #1d4ed8; color: #fff; border: none; padding: 10px 16px; border-radius: 8px; cursor: pointer; }
      button:disabled { opacity: 0.6; cursor: wait; }
      pre { background: #0f172a; color: #e2e8f0; padding: 14px; border-radius: 8px; overflow: auto; }
      .muted { color: #6b7280; font-size: 13px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>S3 Upload Test</h1>
      <p>Base prefix: <code>${rules.basePrefix}</code></p>
      <p>Max upload size: <code>${maxMb} MB</code></p>
      <p class="muted">This uploads directly through the backend server using current S3 credentials.</p>

      <form id="upload-form">
        <input id="file-input" type="file" name="file" required />
        <br />
        <button id="submit-btn" type="submit">Upload</button>
      </form>

      <h3>Result</h3>
      <pre id="result">No upload yet.</pre>
    </div>

    <script>
      const form = document.getElementById('upload-form');
      const fileInput = document.getElementById('file-input');
      const submitBtn = document.getElementById('submit-btn');
      const result = document.getElementById('result');

      form.addEventListener('submit', async (event) => {
        event.preventDefault();

        if (!fileInput.files || fileInput.files.length === 0) {
          result.textContent = 'Please choose a file first.';
          return;
        }

        const formData = new FormData();
        formData.append('file', fileInput.files[0]);

        submitBtn.disabled = true;
        result.textContent = 'Uploading...';

        try {
          const response = await fetch(window.location.pathname, {
            method: 'POST',
            body: formData,
          });

          const payload = await response.json();
          result.textContent = JSON.stringify(payload, null, 2);
        } catch (error) {
          result.textContent = String(error);
        } finally {
          submitBtn.disabled = false;
        }
      });
    </script>
  </body>
</html>`;
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new ValidationException('file is required', 'file');
    }

    return this.s3Service.uploadFileFromServer({
      buffer: file.buffer,
      fileName: file.originalname || 'upload.bin',
      contentType: file.mimetype || 'application/octet-stream',
      sizeBytes: file.size,
    });
  }
}
