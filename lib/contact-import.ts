import ExcelJS from 'exceljs';
import {parse} from 'csv-parse/sync';
import {unzipSync} from 'fflate';
import {DeskError} from './meta';
import type {PrismaClient} from '@prisma/client';

export const IMPORT_LIMIT = 5000;
export const FILE_LIMIT = 5_000_000;
type Cell = string | {error: string};
export type ImportTable = {headers: string[]; rows: {row: number; cells: Cell[]}[]; sheets: string[]; sheet: string};
export type ImportRow = {row: number; name: string; phone: string};
export type ImportPreview = {headers: string[]; sheets: string[]; sheet: string; nameColumn: number; phoneColumn: number;
  total: number; valid: number; duplicates: number; invalid: number; existing: number; newContacts: number;
  rows: (ImportRow & {existing: boolean})[]; errors: {row: number; message: string}[]};

export function normalizePhone(value: string, countryCode = '') {
  let phone = value.trim().replace(/^'/, '').replace(/[\s().-]/g, '');
  if (phone.startsWith('00')) phone = '+' + phone.slice(2);
  if (!/^\+?\d+$/.test(phone)) throw new DeskError('Use a phone number with a country code, without letters or scientific notation.');
  if (!phone.startsWith('+')) {
    if (countryCode) {
      if (!/^[1-9]\d{0,3}$/.test(countryCode)) throw new DeskError('Enter a valid default country code, without +.');
      // Indian local numbers are exactly 10 digits; other local formats need an explicit +country code.
      if (countryCode === '91' && /^[6-9]\d{9}$/.test(phone)) phone = '+91' + phone;
      else if (phone.startsWith(countryCode)) phone = '+' + phone;
      else phone = '+' + countryCode + phone.replace(/^0/, '');
    } else phone = '+' + phone;
  }
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) throw new DeskError('Use 7-15 digits including the country code.');
  return phone;
}

function excelCell(cell: ExcelJS.Cell): Cell {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isSafeInteger(value) ? String(value) : {error: 'Phone numbers must be whole numbers or text.'};
  if (typeof value === 'object' && 'richText' in value) return value.richText.map(part => part.text).join('');
  if (typeof value === 'object' && 'hyperlink' in value) return value.text;
  return {error: 'Formulas, dates and error cells are not supported. Paste their values as text.'};
}

export async function readContactFile(bytes: Buffer, filename: string, requestedSheet = ''): Promise<ImportTable> {
  if (!bytes.length || bytes.length > FILE_LIMIT) throw new DeskError('Choose a non-empty CSV or XLSX file up to 5 MB.', 413);
  let data: Cell[][];
  let sheet = '', sheets: string[] = [];
  if (/\.csv$/i.test(filename)) {
    try {
      const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
      data = parse(text, {bom: true, skip_empty_lines: true, relax_column_count: true, max_record_size: 16_000, to: IMPORT_LIMIT + 2}) as string[][];
    } catch { throw new DeskError('Cannot read this CSV. Save it as UTF-8 CSV with a header row and correctly quoted fields.'); }
  } else if (/\.xlsx$/i.test(filename)) {
    try {
      let expanded = 0, entries = 0;
      unzipSync(bytes, {filter(entry) {
        expanded += entry.originalSize;
        if (++entries > 1000 || expanded > 32_000_000 || entry.originalSize > 20_000_000) throw new Error('Workbook too large');
        return false;
      }});
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
      sheets = workbook.worksheets.map(ws => ws.name);
      const ws = requestedSheet ? workbook.getWorksheet(requestedSheet) : workbook.worksheets[0];
      if (!ws) throw new DeskError('Choose an existing worksheet.');
      sheet = ws.name;
      if (ws.rowCount > IMPORT_LIMIT + 1 || ws.columnCount > 50) throw new DeskError('Use at most 5,000 rows and 50 columns, with headers in the first row.');
      data = [];
      for (let row = 1; row <= ws.rowCount; row++) {
        data.push(Array.from({length: ws.columnCount}, (_, index) => excelCell(ws.getRow(row).getCell(index + 1))));
      }
    } catch (error) {
      if (error instanceof DeskError) throw error;
      throw new DeskError('Cannot read this XLSX file. Use a normal, unencrypted Excel workbook under 5 MB (expanded contents under 32 MB).');
    }
  } else throw new DeskError('Choose a .csv or .xlsx file. Older .xls files must be saved as .xlsx first.');
  if (data.length > IMPORT_LIMIT + 1) throw new DeskError('Import up to 5,000 contacts at a time.');
  const first = data[0];
  if (!first?.length || first.length > 50 || first.some(cell => typeof cell !== 'string')) throw new DeskError('Use a text header row with at most 50 columns.');
  const headers = first.map((cell, i) => String(cell).trim() || 'Column ' + (i + 1));
  const rows = data.slice(1).map((cells, index) => ({row: index + 2, cells})).filter(row => row.cells.some(cell => typeof cell !== 'string' || cell.trim()));
  if (!rows.length) throw new DeskError('The file has headers but no contact rows.');
  return {headers, rows, sheets, sheet};
}

export function prepareImport(table: ImportTable, input: {nameColumn?: unknown; phoneColumn?: unknown; countryCode?: unknown}) {
  const normalized = table.headers.map(header => header.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const column = (raw: unknown, aliases: string[]) => raw === undefined || raw === '' || raw === null
    ? normalized.findIndex(header => aliases.includes(header)) : Number(raw);
  const nameColumn = column(input.nameColumn, ['name', 'fullname', 'customername', 'contactname']);
  const phoneColumn = column(input.phoneColumn, ['phone', 'phonenumber', 'mobile', 'mobilenumber', 'whatsapp', 'whatsappnumber', 'number']);
  if (![nameColumn, phoneColumn].every(n => Number.isInteger(n) && n >= 0 && n < table.headers.length) || nameColumn === phoneColumn) {
    throw new DeskError('Choose different name and phone columns.');
  }
  const countryCode = String(input.countryCode ?? '').trim().replace(/^\+/, '');
  if (countryCode && !/^[1-9]\d{0,3}$/.test(countryCode)) throw new DeskError('Enter a valid default country code.');
  const seen = new Set<string>(), rows: ImportRow[] = [], errors: {row: number; message: string}[] = [];
  let duplicates = 0, invalid = 0;
  for (const {row, cells} of table.rows) {
    try {
      const rawName = cells[nameColumn] ?? '', rawPhone = cells[phoneColumn] ?? '';
      if (typeof rawName !== 'string') throw new DeskError(rawName.error);
      if (typeof rawPhone !== 'string') throw new DeskError(rawPhone.error);
      const name = rawName.trim();
      if (!name || name.length > 120) throw new DeskError('Name must contain 1-120 characters.');
      const phone = normalizePhone(rawPhone, countryCode);
      if (seen.has(phone)) { duplicates++; errors.push({row, message: 'Duplicate phone in this file; the first valid row is used.'}); continue; }
      seen.add(phone); rows.push({row, name, phone});
    } catch (error) {
      invalid++; errors.push({row, message: error instanceof DeskError ? error.message : 'Invalid contact.'});
    }
  }
  return {nameColumn, phoneColumn, countryCode, rows, errors, duplicates, invalid};
}

export async function previewImport(client: PrismaClient, table: ImportTable, prepared: ReturnType<typeof prepareImport>): Promise<ImportPreview> {
  const existing = await client.contact.findMany({where: {phone: {in: prepared.rows.map(row => row.phone)}}, select: {phone: true}});
  const phones = new Set(existing.map(row => row.phone));
  return {headers: table.headers, sheets: table.sheets, sheet: table.sheet, nameColumn: prepared.nameColumn, phoneColumn: prepared.phoneColumn,
    total: table.rows.length, valid: prepared.rows.length, duplicates: prepared.duplicates, invalid: prepared.invalid,
    existing: phones.size, newContacts: prepared.rows.length - phones.size,
    rows: prepared.rows.slice(0, 20).map(row => ({...row, existing: phones.has(row.phone)})), errors: prepared.errors.slice(0, 100)};
}

export async function commitImport(client: PrismaClient, rows: ImportRow[], groupIds: string[]) {
  if (!rows.length) throw new DeskError('There are no valid contacts to import.');
  if (groupIds.length > 100 || new Set(groupIds).size !== groupIds.length || groupIds.some(id => typeof id !== 'string' || id.length > 64)) throw new DeskError('Choose valid contact groups.');
  return client.$transaction(async tx => {
    if (groupIds.length && await tx.contactGroup.count({where: {id: {in: groupIds},systemKey:null}}) !== groupIds.length) throw new DeskError('A selected custom group no longer exists, or an automatic group was selected. Refresh and preview again.', 409);
    const inserted = await tx.contact.createMany({data: rows.map(({name, phone}) => ({name, phone, consentStatus: 'PENDING', consent: false})), skipDuplicates: true});
    const contacts = await tx.contact.findMany({where: {phone: {in: rows.map(row => row.phone)}}, select: {id: true}});
    // Existing names and consent decisions are never overwritten by a file import.
    let memberships = 0;
    const pairs = contacts.flatMap(contact => groupIds.map(groupId => ({contactId: contact.id, groupId})));
    for (let index = 0; index < pairs.length; index += 1000) {
      memberships += (await tx.contactGroupMembership.createMany({data: pairs.slice(index, index + 1000), skipDuplicates: true})).count;
    }
    return {created: inserted.count, existing: rows.length - inserted.count, memberships, imported: rows.length};
  }, {timeout: 60_000});
}
