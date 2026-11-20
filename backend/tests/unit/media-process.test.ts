import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { processMedia } from '../../src/modules/media/media-process.js';
const require = createRequire(import.meta.url);
it('re-encodes real MP4 with a stripped WebP poster; rejects corrupt video', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zapis-video-test-'));
  try {
    const source = join(directory, 'test.mp4');
    const binary = require('ffmpeg-static') as string;
    execFileSync(binary, [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=green:s=128x128:d=1',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-metadata',
      'comment=private',
      source,
    ]);
    const result = await processMedia(await readFile(source), 'VIDEO', 'video/mp4');
    expect(result.mime).toBe('video/mp4');
    expect(result.data.includes(Buffer.from('private'))).toBe(false);
    expect((await sharp(result.poster).metadata()).format).toBe('webp');
    await expect(
      processMedia(Buffer.from('0000ftypcorrupt'), 'VIDEO', 'video/mp4'),
    ).rejects.toMatchObject({ httpStatus: 422 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
