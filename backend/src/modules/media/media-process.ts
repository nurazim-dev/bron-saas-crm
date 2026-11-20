import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import ffmpegStatic from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
const run = promisify(execFile);
const ffmpeg = process.env.FFMPEG_PATH ?? (typeof ffmpegStatic === 'string' ? ffmpegStatic : null);
const ffprobePath = process.env.FFPROBE_PATH ?? ffprobe.path;
const badFile = () =>
  new AppError(
    'VALIDATION_ERROR',
    422,
    'Файл не прошёл проверку. Фото: JPEG/PNG/WebP до 8 МБ. Видео: MP4 до 20 МБ, 30 секунд, 1920×1920.',
  );
export async function processMedia(input: Buffer, kind: string, mime: string) {
  if (!input.length || input.length > (kind === 'VIDEO' ? 20 : 8) * 1024 * 1024) throw badFile();
  if (kind !== 'VIDEO') {
    try {
      const image = sharp(input, {
        limitInputPixels: 20_000_000,
        failOn: 'warning',
        animated: false,
      });
      const meta = await image.metadata();
      const accepted: Record<string, string> = {
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
      };
      if (!meta.format || accepted[meta.format] !== mime || (meta.pages ?? 1) !== 1)
        throw badFile();
      const data = await image
        .rotate()
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .timeout({ seconds: 10 })
        .toBuffer();
      const poster = await sharp(data)
        .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 75 })
        .toBuffer();
      return { data, poster, mime: 'image/webp' };
    } catch {
      throw badFile();
    }
  }
  if (mime !== 'video/mp4' || input.subarray(4, 8).toString() !== 'ftyp' || !ffmpeg)
    throw badFile();
  const dir = await mkdtemp(join(tmpdir(), 'zapis-media-'));
  try {
    const source = join(dir, 'source.mp4'),
      output = join(dir, 'safe.mp4'),
      cover = join(dir, 'poster.jpg');
    await writeFile(source, input, { mode: 0o600 });
    const info = await run(
      ffprobePath,
      [
        '-v',
        'error',
        '-protocol_whitelist',
        'file,pipe',
        '-f',
        'mov',
        '-show_streams',
        '-show_format',
        '-of',
        'json',
        source,
      ],
      { timeout: 10000, maxBuffer: 512000 },
    );
    const parsed = z
      .object({
        format: z.object({ duration: z.coerce.number().positive().max(30) }),
        streams: z
          .array(
            z.object({
              codec_type: z.string(),
              width: z.number().optional(),
              height: z.number().optional(),
            }),
          )
          .max(4),
      })
      .parse(JSON.parse(info.stdout) as unknown);
    const video = parsed.streams.filter((s) => s.codec_type === 'video');
    if (
      video.length !== 1 ||
      !video[0]?.width ||
      !video[0].height ||
      video[0].width > 1920 ||
      video[0].height > 1920
    )
      throw badFile();
    await run(
      ffmpeg,
      [
        '-nostdin',
        '-v',
        'error',
        '-max_alloc',
        '67108864',
        '-protocol_whitelist',
        'file,pipe',
        '-f',
        'mov',
        '-i',
        source,
        '-map',
        '0:v:0',
        '-an',
        '-sn',
        '-dn',
        '-map_metadata',
        '-1',
        '-t',
        '30',
        '-threads',
        '1',
        '-filter_threads',
        '1',
        '-vf',
        "scale='min(1280,iw)':-2",
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-preset',
        'fast',
        '-crf',
        '25',
        '-movflags',
        '+faststart',
        output,
      ],
      { timeout: 45000, maxBuffer: 512000 },
    );
    if ((await stat(output)).size > 20 * 1024 * 1024) throw badFile();
    await run(
      ffmpeg,
      ['-nostdin', '-v', 'error', '-i', output, '-frames:v', '1', '-threads', '1', cover],
      { timeout: 10000, maxBuffer: 512000 },
    );
    const poster = await sharp(await readFile(cover))
      .resize(480, 480, { fit: 'inside' })
      .webp()
      .toBuffer();
    return { data: await readFile(output), poster, mime: 'video/mp4' };
  } catch {
    throw badFile();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
