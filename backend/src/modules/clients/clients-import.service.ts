import { randomUUID } from 'node:crypto';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { Prisma } from '../../generated/prisma/client.js';
import { audit, type AuditRequestContext } from '../../lib/audit.js';
import { now } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import { sanitizeText } from '../../lib/phone.js';
import { prisma } from '../../lib/prisma.js';
import type { AuthenticatedActor } from '../../types/express.js';
import type { ImportClientsExecuteInput, ImportClientsPreviewInput } from './clients.schemas.js';

const MAX_IMPORT_ROWS = 500;
const NAME_HEADERS = new Set(['name', 'имя', 'клиент', 'фио', 'client']);
const PHONE_HEADERS = new Set(['phone', 'телефон', 'номер', 'tel', 'mobile']);
const NOTES_HEADERS = new Set(['notes', 'note', 'заметки', 'комментарий', 'comment']);
const TAGS_HEADERS = new Set(['tags', 'tag', 'теги', 'тег']);

export type ImportRowAction = 'CREATE' | 'UPDATE' | 'SKIP' | 'ERROR';

export interface ImportPreviewRowDto {
  rowNumber: number;
  name: string;
  phone: string;
  normalizedPhone: string | null;
  notes: string | null;
  tags: string[];
  action: ImportRowAction;
  reason?: string;
}

export interface ClientImportPreviewDto {
  totalRows: number;
  summary: {
    create: number;
    update: number;
    skip: number;
    error: number;
  };
  newTagsToCreate: string[];
  rows: ImportPreviewRowDto[];
}

function detectDelimiter(headerLine: string): ',' | ';' {
  let commas = 0;
  let semis = 0;
  let inQuotes = false;
  for (let i = 0; i < headerLine.length; i += 1) {
    const ch = headerLine[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes) {
      if (ch === ',') commas += 1;
      else if (ch === ';') semis += 1;
    }
  }
  return semis > commas ? ';' : ',';
}

function parseCsvRecords(rawText: string): string[][] {
  const cleaned = rawText
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (!cleaned) {
    throw new AppError('VALIDATION_ERROR', 400, 'CSV file is empty');
  }

  const firstNewline = cleaned.indexOf('\n');
  const firstLine = firstNewline === -1 ? cleaned : cleaned.slice(0, firstNewline);
  const delimiter = detectDelimiter(firstLine);

  const records: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i] ?? '';
    const next = cleaned[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      if (row.some((v) => v.trim().length > 0)) {
        records.push(row);
      }
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  row.push(cell);
  if (row.some((v) => v.trim().length > 0)) {
    records.push(row);
  }

  return records;
}

function parseTagsCell(raw: string | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[|,;]/)) {
    const tag = sanitizeText(part).slice(0, 40);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(tag);
    }
    if (out.length >= 10) break;
  }
  return out;
}

function tryNormalizePhone(raw: string): string | null {
  const cleaned = sanitizeText(raw);
  if (!cleaned) return null;
  const parsed = parsePhoneNumberFromString(cleaned, 'KG');
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

interface ParsedImportData {
  rows: Array<{
    rowNumber: number;
    name: string;
    phone: string;
    normalizedPhone: string | null;
    notes: string | null;
    tags: string[];
    parseError?: string;
  }>;
}

function parseImportCsv(csvText: string): ParsedImportData {
  const records = parseCsvRecords(csvText);
  if (records.length < 2) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      'CSV must contain a header row and at least one data row',
    );
  }
  const dataRows = records.slice(1);
  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      `Maximum ${MAX_IMPORT_ROWS} rows can be imported at once`,
    );
  }

  const header = (records[0] ?? []).map((h) => sanitizeText(h).toLowerCase());
  const nameIdx = header.findIndex((h) => NAME_HEADERS.has(h));
  const phoneIdx = header.findIndex((h) => PHONE_HEADERS.has(h));
  const notesIdx = header.findIndex((h) => NOTES_HEADERS.has(h));
  const tagsIdx = header.findIndex((h) => TAGS_HEADERS.has(h));

  if (nameIdx === -1 || phoneIdx === -1) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      'CSV header must include Name/Имя and Phone/Телефон columns',
    );
  }

  const seenPhones = new Set<string>();
  const rows: ParsedImportData['rows'] = dataRows.map((record, idx) => {
    const rowNumber = idx + 2;
    const name = sanitizeText(record[nameIdx] ?? '').slice(0, 100);
    const phone = sanitizeText(record[phoneIdx] ?? '').slice(0, 30);
    const rawNotes = notesIdx >= 0 ? sanitizeText(record[notesIdx] ?? '').slice(0, 1000) : '';
    const notes = rawNotes || null;
    const tags = tagsIdx >= 0 ? parseTagsCell(record[tagsIdx]) : [];
    const normalizedPhone = tryNormalizePhone(phone);

    if (name.length < 2) {
      return {
        rowNumber,
        name,
        phone,
        normalizedPhone,
        notes,
        tags,
        parseError: 'Имя короче 2 символов',
      };
    }
    if (!normalizedPhone) {
      return {
        rowNumber,
        name,
        phone,
        normalizedPhone: null,
        notes,
        tags,
        parseError: 'Некорректный номер телефона',
      };
    }
    if (seenPhones.has(normalizedPhone)) {
      return {
        rowNumber,
        name,
        phone,
        normalizedPhone,
        notes,
        tags,
        parseError: 'Дубликат номера внутри файла',
      };
    }
    seenPhones.add(normalizedPhone);
    return { rowNumber, name, phone, normalizedPhone, notes, tags };
  });

  return { rows };
}

async function classifyImportRows(
  companyId: string,
  input: ImportClientsPreviewInput,
): Promise<{
  preview: ClientImportPreviewDto;
  existingByPhone: Map<
    string,
    { id: string; name: string; notes: string | null; anonymizedAt: Date | null }
  >;
  existingTagsLower: Map<string, { id: string; name: string }>;
}> {
  const parsed = parseImportCsv(input.csvText);
  const validPhones = parsed.rows
    .map((r) => r.normalizedPhone)
    .filter((p): p is string => Boolean(p));

  const [existingClients, existingTags] = await Promise.all([
    validPhones.length > 0
      ? prisma.client.findMany({
          where: { companyId, phone: { in: validPhones }, mergedAt: null },
          select: { id: true, name: true, phone: true, notes: true, anonymizedAt: true },
        })
      : Promise.resolve([]),
    prisma.clientTag.findMany({
      where: { companyId },
      select: { id: true, name: true },
    }),
  ]);

  const existingByPhone = new Map(existingClients.map((c) => [c.phone, c]));
  const existingTagsLower = new Map(existingTags.map((t) => [t.name.toLowerCase(), t]));
  const newTagsMap = new Map<string, string>();

  const rows: ImportPreviewRowDto[] = parsed.rows.map((r) => {
    if (r.parseError || !r.normalizedPhone) {
      return {
        rowNumber: r.rowNumber,
        name: r.name,
        phone: r.phone,
        normalizedPhone: r.normalizedPhone,
        notes: r.notes,
        tags: r.tags,
        action: 'ERROR',
        reason: r.parseError ?? 'Ошибка строки',
      };
    }

    const existing = existingByPhone.get(r.normalizedPhone);
    if (existing?.anonymizedAt) {
      return {
        rowNumber: r.rowNumber,
        name: r.name,
        phone: r.phone,
        normalizedPhone: r.normalizedPhone,
        notes: r.notes,
        tags: r.tags,
        action: 'SKIP',
        reason: 'Клиент обезличен',
      };
    }

    const willWrite = !existing || input.duplicateStrategy !== 'SKIP';
    if (willWrite) {
      for (const tagName of r.tags) {
        const lower = tagName.toLowerCase();
        if (!existingTagsLower.has(lower) && !newTagsMap.has(lower)) {
          newTagsMap.set(lower, tagName);
        }
      }
    }

    if (!existing) {
      return {
        rowNumber: r.rowNumber,
        name: r.name,
        phone: r.phone,
        normalizedPhone: r.normalizedPhone,
        notes: r.notes,
        tags: r.tags,
        action: 'CREATE',
      };
    }

    if (input.duplicateStrategy === 'SKIP') {
      return {
        rowNumber: r.rowNumber,
        name: r.name,
        phone: r.phone,
        normalizedPhone: r.normalizedPhone,
        notes: r.notes,
        tags: r.tags,
        action: 'SKIP',
        reason: 'Телефон уже есть в базе',
      };
    }

    return {
      rowNumber: r.rowNumber,
      name: r.name,
      phone: r.phone,
      normalizedPhone: r.normalizedPhone,
      notes: r.notes,
      tags: r.tags,
      action: 'UPDATE',
      reason:
        input.duplicateStrategy === 'MERGE_TAGS'
          ? 'Добавить теги и заполнить пустые заметки'
          : 'Заполнить пустые заметки',
    };
  });

  const summary = {
    create: rows.filter((r) => r.action === 'CREATE').length,
    update: rows.filter((r) => r.action === 'UPDATE').length,
    skip: rows.filter((r) => r.action === 'SKIP').length,
    error: rows.filter((r) => r.action === 'ERROR').length,
  };

  return {
    preview: {
      totalRows: rows.length,
      summary,
      newTagsToCreate: Array.from(newTagsMap.values()),
      rows,
    },
    existingByPhone,
    existingTagsLower,
  };
}

export async function previewClientImport(
  actor: AuthenticatedActor,
  input: ImportClientsPreviewInput,
): Promise<ClientImportPreviewDto> {
  const { preview } = await classifyImportRows(actor.companyId, input);
  return preview;
}

export async function executeClientImport(
  actor: AuthenticatedActor,
  input: ImportClientsExecuteInput,
  auditCtx?: AuditRequestContext,
) {
  const currentTime = now();

  return prisma.$transaction(async (tx) => {
    const parsed = parseImportCsv(input.csvText);
    const validPhones = parsed.rows
      .map((r) => r.normalizedPhone)
      .filter((p): p is string => Boolean(p));

    const [existingClients, existingTags] = await Promise.all([
      validPhones.length > 0
        ? tx.client.findMany({
            where: { companyId: actor.companyId, phone: { in: validPhones }, mergedAt: null },
            select: { id: true, name: true, phone: true, notes: true, anonymizedAt: true },
          })
        : Promise.resolve([]),
      tx.clientTag.findMany({
        where: { companyId: actor.companyId },
        select: { id: true, name: true },
      }),
    ]);

    const existingByPhone = new Map(existingClients.map((c) => [c.phone, c]));
    const tagsMap = new Map(existingTags.map((t) => [t.name.toLowerCase(), t.id]));

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const errors: Array<{ rowNumber: number; phone: string; reason: string }> = [];

    const ensureTagIds = async (tagNames: string[]): Promise<string[]> => {
      const ids: string[] = [];
      for (const rawName of tagNames) {
        const key = rawName.toLowerCase();
        const found = tagsMap.get(key);
        if (found) {
          ids.push(found);
          continue;
        }
        const createdTag = await tx.clientTag.create({
          data: {
            companyId: actor.companyId,
            name: rawName,
            color: '#0f766e',
            createdAt: currentTime,
            updatedAt: currentTime,
          },
        });
        tagsMap.set(key, createdTag.id);
        ids.push(createdTag.id);
      }
      return ids;
    };

    for (const row of parsed.rows) {
      if (row.parseError || !row.normalizedPhone) {
        errors.push({
          rowNumber: row.rowNumber,
          phone: row.phone,
          reason: row.parseError ?? 'Ошибка строки',
        });
        continue;
      }

      const existing = existingByPhone.get(row.normalizedPhone);
      if (existing?.anonymizedAt) {
        skippedCount += 1;
        continue;
      }

      if (!existing) {
        const newId = randomUUID();
        const tagIds = await ensureTagIds(row.tags);
        await tx.client.create({
          data: {
            id: newId,
            companyId: actor.companyId,
            name: row.name,
            phone: row.normalizedPhone,
            notes: row.notes,
            createdAt: currentTime,
            updatedAt: currentTime,
          },
        });
        if (tagIds.length > 0) {
          await tx.clientTagAssignment.createMany({
            data: tagIds.map((tagId) => ({
              companyId: actor.companyId,
              clientId: newId,
              tagId,
              createdAt: currentTime,
            })),
            skipDuplicates: true,
          });
        }
        createdCount += 1;
        continue;
      }

      if (input.duplicateStrategy === 'SKIP') {
        skippedCount += 1;
        continue;
      }

      let changed = false;
      if (!existing.notes && row.notes) {
        await tx.client.update({
          where: { id: existing.id },
          data: { notes: row.notes, updatedAt: currentTime },
        });
        changed = true;
      }

      if (input.duplicateStrategy === 'MERGE_TAGS' && row.tags.length > 0) {
        const tagIds = await ensureTagIds(row.tags);
        if (tagIds.length > 0) {
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO "ClientTagAssignment" ("clientId", "tagId", "companyId", "createdAt")
            SELECT ${existing.id}::uuid, x."tagId", ${actor.companyId}::uuid, ${currentTime}
            FROM unnest(${tagIds}::uuid[]) AS x("tagId")
            ON CONFLICT ("clientId", "tagId") DO NOTHING
          `);
          changed = true;
        }
      }

      if (changed) {
        updatedCount += 1;
      } else {
        skippedCount += 1;
      }
    }

    await audit(tx, {
      actorType: 'USER',
      actorId: actor.userId,
      companyId: actor.companyId,
      action: 'client.import',
      entityType: 'Client',
      metadata: {
        duplicateStrategy: input.duplicateStrategy,
        totalRows: parsed.rows.length,
        created: createdCount,
        updated: updatedCount,
        skipped: skippedCount,
        errorCount: errors.length,
      },
      context: auditCtx,
    });

    return {
      totalRows: parsed.rows.length,
      created: createdCount,
      updated: updatedCount,
      skipped: skippedCount,
      errorCount: errors.length,
      errors,
    };
  });
}
