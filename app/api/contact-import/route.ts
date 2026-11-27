import {isAuthorized, isSameOrigin} from '@/lib/auth';
import {db} from '@/lib/db';
import {DeskError} from '@/lib/meta';
import {FILE_LIMIT, readContactFile, prepareImport, previewImport, commitImport} from '@/lib/contact-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function reply(body: unknown, status = 200) { return Response.json(body, {status, headers: {'Cache-Control': 'no-store'}}); }

export async function POST(request: Request) {
  if (!isAuthorized(request)) return reply({error: 'Sign in to continue.'}, 401);
  if (!isSameOrigin(request)) return reply({error: 'Use the signed-in dashboard.'}, 403);
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data')) return reply({error: 'Upload a CSV or XLSX file.'}, 415);
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new DeskError('Choose a file.');
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const {value, done} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > FILE_LIMIT + 64_000) { await reader.cancel(); return reply({error: 'Upload at most 5 MB.'}, 413); }
      chunks.push(value);
    }
    const form = await new Response(Buffer.concat(chunks), {headers: {'Content-Type': request.headers.get('content-type')!}}).formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new DeskError('Choose a CSV or XLSX file.');
    const mode = form.get('mode');
    if (mode !== 'inspect' && mode !== 'preview' && mode !== 'commit') throw new DeskError('Choose preview or import.');
    const table = await readContactFile(Buffer.from(await file.arrayBuffer()), file.name, String(form.get('sheet') || ''));
    if (mode === 'inspect') return reply({headers: table.headers, sheets: table.sheets, sheet: table.sheet});
    const prepared = prepareImport(table, {nameColumn: form.get('nameColumn'), phoneColumn: form.get('phoneColumn'), countryCode: form.get('countryCode')});
    if (mode === 'preview') return reply(await previewImport(db, table, prepared));
    let groupIds: unknown;
    try { groupIds = JSON.parse(String(form.get('groupIds') || '[]')); } catch { throw new DeskError('Choose valid groups.'); }
    if (!Array.isArray(groupIds)) throw new DeskError('Choose valid groups.');
    const result = await commitImport(db, prepared.rows, groupIds);
    return reply({...result, invalid: prepared.invalid, duplicates: prepared.duplicates});
  } catch (error) {
    if (error instanceof DeskError) return reply({error: error.message}, error.status);
    return reply({error: 'The import could not be saved. Check the database connection and try again; imports can safely be repeated.'}, 503);
  }
}
