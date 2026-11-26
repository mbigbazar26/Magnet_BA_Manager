"use client";
import { useRef, useState, type FormEvent } from "react";
import type { Action, Contact, DeskState } from "./types";

export function Badge({ status }: {status:string}) {
  const tone = /^(approved|delivered|read|received|opted in)$/i.test(status) ? "mint" : /failed|rejected|error|unknown/i.test(status) ? "rose" : /pending|submitt|sending/i.test(status) ? "amber" : "neutral";
  return <span className={"badge " + tone}>{status.replaceAll("_"," ").toLowerCase()}</span>;
}

export function ContactEditor({ contact, run, busy, close }: {contact?:Contact;run:Action;busy:boolean;close:()=>void}) {
  const [consent,setConsent] = useState(contact?.consent ?? false);
  async function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault(); const data = new FormData(e.currentTarget);
    if(await run("contacts",{id:contact?.id,name:data.get("name"),phone:data.get("phone"),consent},"Contact saved.")) close();
  }
  return <form className="panel form-card" onSubmit={submit}>
    <div className="card-head"><h2>{contact ? "Edit contact" : "New contact"}</h2><button className="quiet" type="button" onClick={close}>Close</button></div>
    <label>Customer name<input name="name" defaultValue={contact?.name} autoComplete="off" required maxLength={100} /></label>
    <label>WhatsApp number<input name="phone" type="tel" defaultValue={contact?.phone} readOnly={!!contact} placeholder="+91…" required /></label>
    <label className="check"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} />This customer agreed to receive WhatsApp messages.</label>
    <button className="primary" disabled={busy}>Save contact</button>
  </form>;
}

export function TemplateEditor({run,busy,close}:{run:Action;busy:boolean;close:()=>void}) {
  const [body,setBody] = useState("");
  const indices = Array.from(new Set(Array.from(body.matchAll(/\{\{(\d+)\}\}/g),m=>Number(m[1])))).sort((a,b)=>a-b);
  const badIndices = indices.some((n,i)=>n!==i+1);
  async function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault(); const data = new FormData(e.currentTarget);
    if(await run("templates",{name:data.get("name"),category:data.get("category"),language:data.get("language"),body,examples:indices.map(n=>data.get("example"+n))},"Template submitted to Meta.")) close();
  }
  return <form className="panel form-card" onSubmit={submit}>
    <div className="card-head"><h2>New text template</h2><button className="quiet" type="button" onClick={close}>Close</button></div>
    <label>Template name<input name="name" placeholder="order_ready" pattern="[a-z0-9_]+" title="Use lowercase letters, digits and underscores." maxLength={512} required /></label>
    <div className="fields"><label>Category<select name="category"><option value="UTILITY">Utility</option><option value="MARKETING">Marketing</option></select></label>
    <label>Language code<input name="language" defaultValue="en_US" required placeholder="en_US" /></label></div>
    <label>Message body<textarea rows={4} value={body} maxLength={1024} onChange={e=>setBody(e.target.value)} placeholder="Hi {{1}}, your order {{2}} is ready for pickup." required /></label>
    <small>Add numbered fields such as {"{{1}}"} to personalize each message.</small>
    {badIndices && <p role="alert">Number the fields consecutively from 1.</p>}
    {indices.map(n=><label key={n}>Example for field {n}<input name={"example"+n} required /></label>)}
    <button className="primary" disabled={busy||badIndices}>Submit to Meta</button>
  </form>;
}

export function Compose({state,run,busy,go}:{state:DeskState;run:Action;busy:boolean;go:(view:"Contacts"|"Templates"|"Setup"|"Messages")=>void}) {
  const [contactId,setContact] = useState(""), [templateId,setTemplate] = useState(""), [parameters,setParams] = useState<string[]>([]);
  const [sent,setSent]=useState(false), [reviewed,setReviewed]=useState(false);
  const requestId=useRef("");
  const contacts=state.contacts.filter(c=>c.consent), templates=state.templates.filter(t=>t.supported&&t.status.toUpperCase()==="APPROVED");
  const contact=contacts.find(c=>c.id===contactId), template=templates.find(t=>t.id===templateId);
  const values=Array.from({length:template?.parameters??0},(_,i)=>parameters[i]??"");
  const preview=template?.body.replace(/\{\{(\d+)\}\}/g,(match,n)=>values[Number(n)-1]||match);
  const configured=state.setup.hasToken&&!!state.setup.phoneNumberId&&!!state.setup.accountId;
  const ready=configured && !!contact && !!template && values.every(v=>v.trim());
  function reset() {requestId.current="";setSent(false);setReviewed(false);}
  async function submit(e:FormEvent) {
    e.preventDefault(); if(!ready||busy||sent) return;
    if(!reviewed) {setReviewed(true);return;}
    requestId.current ||= crypto.randomUUID();
    if(await run("send",{contactId,templateId,parameters:values,requestId:requestId.current},"Send request recorded. Check Messages for its status.")) setSent(true);
  }
  return <div className="compose-grid"><form onSubmit={submit} className="panel form-card">
    <div className="card-head"><h2>Message details</h2></div>
    {!configured&&<div className="hint">Connect your Meta account to send. <button className="link" type="button" onClick={()=>go("Setup")}>Open setup</button></div>}
    <label>Recipient<select value={contactId} onChange={e=>{reset();setContact(e.target.value);}} disabled={busy||sent}><option value="">Choose a contact</option>{contacts.map(c=><option value={c.id} key={c.id}>{c.name} · {c.phone}</option>)}</select></label>
    {!contacts.length&&<small>Save a contact with consent first. <button type="button" className="link" onClick={()=>go("Contacts")}>Contacts →</button></small>}
    <label>Approved template<select value={templateId} onChange={e=>{reset();setTemplate(e.target.value);setParams([]);}} disabled={busy||sent}><option value="">Choose a template</option>{templates.map(t=><option key={t.id} value={t.id}>{t.name} · {t.language}</option>)}</select></label>
    {!templates.length&&<small>Sync or create an approved text template. <button type="button" className="link" onClick={()=>go("Templates")}>Templates →</button></small>}
    {values.map((v,i)=><label key={i}>Field {i+1}<input value={v} disabled={busy||sent} onChange={e=>{reset();setParams(values.map((s,j)=>j===i?e.target.value:s));}} required /></label>)}
    {reviewed&&!sent&&<div className="hint">Send this WhatsApp message to <strong>{contact?.name}</strong> at {contact?.phone}?</div>}
    {sent?<button type="button" className="primary" onClick={()=>go("Messages")}>View message history →</button>:<button className="primary" disabled={busy||!ready}>{busy?"Working…":reviewed?"Confirm and send":"Review message"}</button>}
  </form><aside className="panel preview-panel"><h2>Message preview</h2><div className="preview-chat"><div className="conversation-label"><span className="brand-mark mini">B</span>Mancherikalam BigBazar</div><div className="chat-bubble">{preview||"Select a template to preview the message here."}</div></div>{template&&<small>{template.name} · {template.language}</small>}</aside></div>;
}

