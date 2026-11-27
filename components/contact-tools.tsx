"use client";
import {useRef, useState, type FormEvent} from 'react';
import type {Action, DeskState} from './types';
import type {ImportPreview} from '../lib/contact-import';

const labels: Record<string,string> = {PENDING:'Awaiting response',OPTED_IN:'Opted in',OPTED_OUT:'Opted out'};
export const consentLabel = (status: string) => labels[status] || 'Awaiting response';

type Inspection = {headers:string[];sheets:string[];sheet:string};
function findColumn(headers:string[], aliases:string[]) {
  return headers.findIndex(header=>aliases.includes(header.toLowerCase().replace(/[^a-z0-9]/g,'')));
}

export function ContactImport({state,busy,refresh,close}:{state:DeskState;busy:boolean;refresh:()=>Promise<void>;close:()=>void}) {
  const customGroups=state.groups.filter(group=>!group.systemKey);
  const [file,setFile]=useState<File|null>(null),[inspection,setInspection]=useState<Inspection|null>(null);
  const [nameColumn,setNameColumn]=useState(-1),[phoneColumn,setPhoneColumn]=useState(-1),[countryCode,setCountryCode]=useState('91');
  const [groupIds,setGroupIds]=useState<string[]>([]),[preview,setPreview]=useState<ImportPreview|null>(null);
  const [working,setWorking]=useState(false),[error,setError]=useState(''),[result,setResult]=useState('');
  const active=useRef(false);
  const locked=busy||working;
  function clearPreview(){setPreview(null);setResult('');setError('');}
  async function upload(mode:'inspect'|'preview'|'commit',selectedFile:File, sheet=inspection?.sheet||'') {
    const form=new FormData();form.set('file',selectedFile);form.set('mode',mode);form.set('sheet',sheet);
    form.set('nameColumn',String(nameColumn));form.set('phoneColumn',String(phoneColumn));form.set('countryCode',countryCode);form.set('groupIds',JSON.stringify(groupIds));
    const response=await fetch('/api/contact-import',{method:'POST',body:form});
    if(response.status===401){window.location.assign('/login');throw Error('Sign in to continue.');}
    const data=await response.json();if(!response.ok)throw Error(data.error||'Could not import the file.');return data;
  }
  async function inspect(selectedFile:File|null,sheet='') {
    if(active.current)return;
    setFile(selectedFile);setInspection(null);clearPreview();
    if(!selectedFile)return;
    if(!/\.(csv|xlsx)$/i.test(selectedFile.name)||selectedFile.size>5_000_000){setError('Choose a CSV or XLSX file up to 5 MB.');return;}
    active.current=true;setWorking(true);
    try {
      const data:Inspection=await upload('inspect',selectedFile,sheet);setInspection(data);
      setNameColumn(findColumn(data.headers,['name','fullname','customername','contactname']));
      setPhoneColumn(findColumn(data.headers,['phone','phonenumber','mobile','mobilenumber','whatsapp','whatsappnumber','number']));
    }catch(e){setError(e instanceof Error?e.message:'Could not read the file.');}finally{active.current=false;setWorking(false);}
  }
  async function submit(event:FormEvent) {
    event.preventDefault();if(!file||active.current)return;
    active.current=true;setWorking(true);setError('');setResult('');
    try {
      if(!preview)setPreview(await upload('preview',file));
      else {
        const saved=await upload('commit',file);
        setResult(`Imported ${saved.imported} contacts: ${saved.created} new, ${saved.existing} existing. Added ${saved.memberships} group memberships. Skipped ${saved.invalid} invalid rows and ${saved.duplicates} duplicate rows. Existing names and consent choices were preserved.`);
        setPreview(null);await refresh();
      }
    }catch(e){setError(e instanceof Error?e.message:'Import failed.');}finally{active.current=false;setWorking(false);}
  }
  const sample='data:text/csv;charset=utf-8,'+encodeURIComponent('name,phone\r\nExample Customer,+919876543210\r\nSecond Customer,+919876543211\r\n');
  return <form className="panel form-card import-panel" onSubmit={submit}>
    <div className="card-head"><div><h2>Import contacts</h2><small>CSV or Excel (.xlsx), up to 5 MB and 5,000 contacts per file.</small></div><button type="button" className="quiet" onClick={close} disabled={working}>Close</button></div>
    <p>New contacts start as <strong>Awaiting response</strong>. Existing contacts keep their name, groups and consent choice. Selected groups are added to their memberships.</p>
    <a href={sample} download="contacts-example.csv">Download example CSV</a>
    <label>Contact file<input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={locked} onChange={e=>void inspect(e.target.files?.[0]||null)}/></label>
    {inspection&&<>
      {inspection.sheets.length>1&&<label>Worksheet<select value={inspection.sheet} disabled={locked} onChange={e=>void inspect(file,e.target.value)}>{inspection.sheets.map(sheet=><option key={sheet}>{sheet}</option>)}</select></label>}
      <div className="fields"><label>Name column<select value={nameColumn} disabled={locked} onChange={e=>{setNameColumn(Number(e.target.value));clearPreview();}}><option value={-1}>Choose a column</option>{inspection.headers.map((header,index)=><option value={index} key={index}>{header}</option>)}</select></label>
      <label>Phone column<select value={phoneColumn} disabled={locked} onChange={e=>{setPhoneColumn(Number(e.target.value));clearPreview();}}><option value={-1}>Choose a column</option>{inspection.headers.map((header,index)=><option value={index} key={index}>{header}</option>)}</select></label></div>
      <label>Default country code<input value={countryCode} inputMode="numeric" maxLength={4} disabled={locked} onChange={e=>{setCountryCode(e.target.value);clearPreview();}} placeholder="91"/><small>Used for local numbers; numbers beginning with + keep their own country code. Leave blank when all numbers include a country code. In Excel, format phone columns as Text.</small></label>
      <fieldset className="group-picker" disabled={locked}><legend>Add to groups</legend>{customGroups.length?customGroups.map(group=><label className="check" key={group.id}><input type="checkbox" checked={groupIds.includes(group.id)} onChange={e=>{setGroupIds(current=>e.target.checked?[...current,group.id]:current.filter(id=>id!==group.id));clearPreview();}}/>{group.name}</label>):<small>Create a group in Contacts, then select it here. You can also import without groups.</small>}</fieldset>
      <small>Customers join Opted-in customers automatically after agreeing to offers.</small>
    </>}
    {error&&<p role="alert" className="error-text">{error}</p>}{result&&<div className="alert good" role="status">{result}</div>}
    {preview&&<>
      <div className="hint">{preview.total} rows: <strong>{preview.valid} valid</strong> ({preview.newContacts} new, {preview.existing} existing), {preview.invalid} invalid, {preview.duplicates} duplicates. Import will include valid rows only.{groupIds.length>0&&<> Groups: {state.groups.filter(group=>groupIds.includes(group.id)).map(group=>group.name).join(', ')}.</>}</div>
      <div className="table-scroll"><table className="import-table"><caption>Preview: first {preview.rows.length} valid contacts</caption><thead><tr><th>Row</th><th>Name</th><th>Phone</th><th>Action</th></tr></thead><tbody>{preview.rows.map(row=><tr key={row.row}><td>{row.row}</td><td>{row.name}</td><td>{row.phone}</td><td>{row.existing?'Keep contact; add groups':'Create awaiting contact'}</td></tr>)}</tbody></table></div>
      {preview.errors.length>0&&<details><summary>Skipped rows ({preview.invalid+preview.duplicates})</summary><ul>{preview.errors.map(error=><li key={error.row}>Row {error.row}: {error.message}</li>)}</ul>{preview.invalid+preview.duplicates>preview.errors.length&&<small>Showing the first 100 row issues.</small>}</details>}
    </>}
    <button className="primary" disabled={locked||!inspection||nameColumn<0||phoneColumn<0||nameColumn===phoneColumn||!!preview&&!preview.valid}>{working?'Working…':preview?`Import ${preview.valid} contacts`:'Preview import'}</button>
  </form>;
}

export function ConsentConfiguration({state,run,busy}:{state:DeskState;run:Action;busy:boolean}) {
  const templates=state.templates.filter(template=>template.supported&&template.status==='APPROVED'&&template.quickReplies.length>=2);
  const initial=state.consentSettings;
  const [templateId,setTemplateId]=useState(initial?.templateId||templates.find(t=>/opt.?in/i.test(t.name))?.id||'');
  const selected=templates.find(t=>t.id===templateId);
  const guessDecline=(buttons:string[])=>buttons.findIndex(label=>/not|no thanks|decline|stop|unsubscribe/i.test(label));
  const guessAccept=(buttons:string[])=>buttons.findIndex(label=>!/not|no thanks|decline|stop|unsubscribe/i.test(label)&&/like|yes|agree|subscribe|accept/i.test(label));
  const [accept,setAccept]=useState(initial?.acceptButton??guessAccept(selected?.quickReplies||[])),[decline,setDecline]=useState(initial?.declineButton??guessDecline(selected?.quickReplies||[]));
  const [acceptWords,setAcceptWords]=useState(initial?.acceptWords.join('\n')||''),[declineWords,setDeclineWords]=useState(initial?.declineWords.join('\n')||'');
  async function submit(event:FormEvent) {
    event.preventDefault();await run('consent-settings',{templateId,acceptButton:accept,declineButton:decline,
      acceptWords:acceptWords.split('\n').map(s=>s.trim()).filter(Boolean),declineWords:declineWords.split('\n').map(s=>s.trim()).filter(Boolean)},'Opt-in reply rules saved. Customer responses will update their contact status.');
  }
  return <details className="panel consent-configuration" open={!initial?.templateId}>
    <summary>Initial opt-in message and reply rules {initial?.templateId?'· Configured':'· Set up'}</summary>
    <form className="form-card" onSubmit={submit}>
      <p>Use your existing approved template. The initial request can reach contacts before they opt in to offers. A customer who explicitly opts out is excluded until you record fresh permission.</p>
      <label>Initial opt-in template<select value={templateId} disabled={busy} onChange={event=>{const id=event.target.value;setTemplateId(id);const buttons=templates.find(t=>t.id===id)?.quickReplies||[];setAccept(guessAccept(buttons));setDecline(guessDecline(buttons));}}><option value="">Disable initial requests</option>{templates.map(template=><option value={template.id} key={template.id}>{template.name} · {template.language}</option>)}</select></label>
      {!templates.length&&<small>Sync your approved template from Meta. It must have at least two quick-reply buttons.</small>}
      {selected&&<><div className="fields"><label>Button that means opted in<select value={accept} disabled={busy} onChange={e=>setAccept(Number(e.target.value))}><option value={-1}>Choose a button</option>{selected.quickReplies.map((text,index)=><option key={index} value={index}>{index+1}. {text}</option>)}</select></label>
      <label>Button that means opted out<select value={decline} disabled={busy} onChange={e=>setDecline(Number(e.target.value))}><option value={-1}>Choose a button</option>{selected.quickReplies.map((text,index)=><option key={index} value={index}>{index+1}. {text}</option>)}</select></label></div>
      <div className="fields"><label>Typed opt-in phrases (optional)<textarea rows={2} value={acceptWords} disabled={busy} onChange={e=>setAcceptWords(e.target.value)} placeholder="One exact phrase per line"/></label><label>Typed opt-out phrases (optional)<textarea rows={2} value={declineWords} disabled={busy} onChange={e=>setDeclineWords(e.target.value)} placeholder="One exact phrase per line"/></label></div>
      <small>Leave typed phrases empty for buttons only. Phrases match complete replies, ignoring case and extra spaces. STOP and UNSUBSCRIBE always opt out. Incoming replies require the Meta messages webhook.</small></>}
      <button className="secondary" disabled={busy||!!templateId&&(!selected||accept<0||decline<0||accept===decline)}>Save reply rules</button>
    </form>
  </details>;
}
