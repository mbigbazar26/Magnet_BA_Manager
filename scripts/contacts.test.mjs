import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {zipSync} from 'fflate';
import {readContactFile,prepareImport,normalizePhone} from '../lib/contact-import.ts';
import {decideReply,replyWords,eligibleContact} from '../lib/consent.ts';

const mapping={acceptButton:1,declineButton:0,acceptLabel:'I would like to receive offers',declineLabel:'I would not like to receive offers',acceptWords:['yes please'],declineWords:['no thanks']};

test('CSV import handles UTF-8, quoted names, local numbers, duplicates and invalid rows', async()=>{
  const bytes=Buffer.from('\ufeffname,phone\r\n"Jacob, Customer",9876543210\r\nമലയാളം,+919876543211\r\nDuplicate,+91 98765 43210\r\nBad,1.234E+10\r\nMissing,\r\n');
  const table=await readContactFile(bytes,'contacts.csv');
  const result=prepareImport(table,{countryCode:'91'});
  assert.deepEqual(result.rows.map(row=>[row.name,row.phone]),[['Jacob, Customer','+919876543210'],['മലയാളം','+919876543211']]);
  assert.equal(result.duplicates,1);assert.equal(result.invalid,2);
  assert.equal(result.errors[0].row,4);
});

test('custom column mapping and explicit international numbers are preserved',async()=>{
  const table=await readContactFile(Buffer.from('Other,Customer,Telephone\nx,Customer,+12025550123\n'),'contacts.csv');
  assert.throws(()=>prepareImport(table,{}),/columns/);
  const prepared=prepareImport(table,{nameColumn:1,phoneColumn:2,countryCode:'91'});
  assert.equal(prepared.rows[0].phone,'+12025550123');
  assert.equal(normalizePhone('00919876543210','91'),'+919876543210');
  assert.throws(()=>prepareImport(table,{nameColumn:1,phoneColumn:1}),/different/);
});

test('XLSX import selects a worksheet, preserves numeric phones and rejects formulas',async()=>{
  const workbook=new ExcelJS.Workbook();
  workbook.addWorksheet('Notes').addRows([['Info'],['Choose Customers']]);
  const ws=workbook.addWorksheet('Customers');
  ws.addRows([['Name','Mobile'],['Numeric phone',9876543210],['Formula',{formula:'1+1',result:2}],['Text phone','+919876543211']]);
  const bytes=Buffer.from(await workbook.xlsx.writeBuffer());
  const table=await readContactFile(bytes,'contacts.xlsx','Customers');
  assert.deepEqual(table.sheets,['Notes','Customers']);
  const prepared=prepareImport(table,{countryCode:'91'});
  assert.equal(prepared.rows.length,2);assert.equal(prepared.invalid,1);
  assert.match(prepared.errors[0].message,/Formulas/);
  assert.equal(prepared.rows[0].phone,'+919876543210');
});

test('corrupt files, older XLS, excessive rows and inflated ZIPs are rejected',async()=>{
  await assert.rejects(readContactFile(Buffer.from('not a workbook'),'bad.xlsx'),/Cannot read/);
  await assert.rejects(readContactFile(Buffer.from('x'),'old.xls'),/\.xlsx/);
  await assert.rejects(readContactFile(Buffer.from('name,phone\n'+'A,+919876543210\n'.repeat(5001)),'many.csv'),/5,000/);
  const bomb=zipSync({'large.xml':new Uint8Array(20_000_001)});
  await assert.rejects(readContactFile(Buffer.from(bomb),'large.xlsx'),/expanded/);
});

test('the existing No-first / Yes-second button order produces the correct consent decisions',()=>{
  assert.equal(decideReply('button',mapping.declineLabel,'desk_reply:outgoing:0',mapping,'outgoing'),'OPTED_OUT');
  assert.equal(decideReply('button',mapping.acceptLabel,'desk_reply:outgoing:1',mapping,'outgoing'),'OPTED_IN');
  assert.equal(decideReply('interactive',mapping.acceptLabel,'desk_reply:outgoing:1',mapping,'outgoing'),'OPTED_IN');
  assert.equal(decideReply('button',mapping.acceptLabel,'desk_reply:another-contact:1',mapping,'outgoing'),null);
  assert.equal(decideReply('button',mapping.declineLabel,'desk_reply:outgoing:1',mapping,'outgoing'),null);
  assert.equal(decideReply('text','YES   PLEASE','',mapping),'OPTED_IN');
  assert.equal(decideReply('text','yes please tell me more','',mapping),null);
  assert.equal(decideReply('text','STOP','',null),'OPTED_OUT');
  assert.equal(decideReply('text','yes','',null),null);
  assert.deepEqual(replyWords([' YES ', 'yes']),['yes']);
});

test('initial requests do not require offers opt-in; offer campaigns exclude pending and opted-out contacts',()=>{
  const awaiting={consent:false,consentStatus:'PENDING'},yes={consent:true,consentStatus:'OPTED_IN'},no={consent:false,consentStatus:'OPTED_OUT'};
  assert.equal(eligibleContact(awaiting,'OPT_IN'),true);
  assert.equal(eligibleContact(awaiting,'STANDARD'),false);
  assert.equal(eligibleContact(yes,'STANDARD'),true);
  assert.equal(eligibleContact(no,'STANDARD'),false);
  assert.equal(eligibleContact(no,'OPT_IN'),false);
});
