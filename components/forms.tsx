"use client";
import { useRef, useState, type FormEvent } from "react";
import type { Action, Contact, ContactGroup, DeskState } from "./types";

export function Badge({ status }: {status:string}) {
  const tone = /^(approved|delivered|read|received|opted in)$/i.test(status) ? "mint" : /failed|rejected|error|unknown/i.test(status) ? "rose" : /pending|submitt|sending/i.test(status) ? "amber" : "neutral";
  return <span className={"badge " + tone}>{status.replaceAll("_"," ").toLowerCase()}</span>;
}

export function ContactEditor({ contact, groups, run, busy, close }: {contact?:Contact;groups:ContactGroup[];run:Action;busy:boolean;close:()=>void}) {
  const [consent,setConsent] = useState(contact?.consent ?? false);
  const [groupIds,setGroupIds] = useState<string[]>(contact?.groups.map(g=>g.id) ?? []);
  async function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault(); const data = new FormData(e.currentTarget);
    if(await run("contacts",{id:contact?.id,name:data.get("name"),phone:data.get("phone"),consent,groupIds},"Contact saved.")) close();
  }
  return <form className="panel form-card" onSubmit={submit}>
    <div className="card-head"><h2>{contact ? "Edit contact" : "New contact"}</h2><button className="quiet" type="button" onClick={close}>Close</button></div>
    <label>Customer name<input name="name" defaultValue={contact?.name} autoComplete="off" required maxLength={100} /></label>
    <label>WhatsApp number<input name="phone" type="tel" defaultValue={contact?.phone} readOnly={!!contact} placeholder="+91…" required /></label>
    <label className="check"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} />This customer agreed to receive WhatsApp messages.</label>
    {groups.length>0&&<fieldset className="group-picker"><legend>Contact groups</legend>{groups.map(g=><label className="check" key={g.id}><input type="checkbox" checked={groupIds.includes(g.id)} onChange={e=>setGroupIds(current=>e.target.checked?[...current,g.id]:current.filter(id=>id!==g.id))}/>{g.name}</label>)}</fieldset>}
    <button className="primary" disabled={busy}>Save contact</button>
  </form>;
}

export function GroupManager({groups,run,busy}:{groups:ContactGroup[];run:Action;busy:boolean}) {
  const [name,setName]=useState("");
  async function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if(await run("groups",{name},"Contact group created.")) setName("");
  }
  return <section className="panel group-manager">
    <div className="card-head"><div><h2>Contact groups</h2><small>Contacts can belong to more than one group.</small></div></div>
    <form className="group-create" onSubmit={submit}><label className="sr-only" htmlFor="new-group-name">New group name</label><input id="new-group-name" value={name} onChange={e=>setName(e.target.value)} maxLength={80} placeholder="e.g. Weekend offers" required/><button className="secondary" disabled={busy||!name.trim()}>Create group</button></form>
    {groups.length>0?<ul className="group-list">{groups.map(g=><li key={g.id}><div><strong>{g.name}</strong><small>{g.contactCount??0} contacts</small></div><button className="quiet" type="button" disabled={busy} onClick={()=>{if(window.confirm(`Delete the “${g.name}” group? Contacts will remain in your address book.`))void run("delete-group",{id:g.id},"Contact group deleted.");}}>Delete</button></li>)}</ul>:<p className="group-empty">No groups yet. Create one, then assign contacts to it.</p>}
  </section>;
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
  const [recipientType,setRecipientType]=useState<"contact"|"group">("contact"),[contactId,setContact] = useState(""),[groupId,setGroup] = useState(""), [templateId,setTemplate] = useState(""), [parameters,setParams] = useState<string[]>([]);
  const [sent,setSent]=useState(false), [reviewed,setReviewed]=useState(false);
  const requestId=useRef("");
  const contacts=state.contacts.filter(c=>c.consent), templates=state.templates.filter(t=>t.supported&&t.status.toUpperCase()==="APPROVED");
  const contact=contacts.find(c=>c.id===contactId), group=state.groups.find(g=>g.id===groupId), template=templates.find(t=>t.id===templateId);
  const groupMembers=group?state.contacts.filter(c=>c.groups.some(g=>g.id===group.id)):[];
  const eligibleGroupMembers=groupMembers.filter(c=>c.consent);
  const values=Array.from({length:template?.parameters??0},(_,i)=>parameters[i]??"");
  const preview=template?.body.replace(/\{\{(\d+)\}\}/g,(match,n)=>values[Number(n)-1]||match);
  const configured=state.setup.hasToken&&!!state.setup.phoneNumberId&&!!state.setup.accountId;
  const targetReady=recipientType==="contact"?!!contact:!!group&&eligibleGroupMembers.length>0;
  const ready=configured && targetReady && !!template && values.every(v=>v.trim());
  function reset() {requestId.current="";setSent(false);setReviewed(false);}
  async function submit(e:FormEvent) {
    e.preventDefault(); if(!ready||busy||sent) return;
    if(!reviewed) {setReviewed(true);return;}
    requestId.current ||= crypto.randomUUID();
    const result=recipientType==="contact"
      ? await run("send",{contactId,templateId,parameters:values,requestId:requestId.current},"Send request recorded. Check Messages for its status.")
      : await run("send-group",{groupId,templateId,parameters:values,batchId:requestId.current},"Group send finished.");
    if(result) setSent(true);
  }
  return <div className="compose-grid"><form onSubmit={submit} className="panel form-card">
    <div className="card-head"><h2>Message details</h2></div>
    {!configured&&<div className="hint">Connect your Meta account to send. <button className="link" type="button" onClick={()=>go("Setup")}>Open setup</button></div>}
    <label>Send to<select value={recipientType} onChange={e=>{reset();setRecipientType(e.target.value as "contact"|"group");setContact("");setGroup("");}} disabled={busy||sent}><option value="contact">One contact</option><option value="group">A contact group</option></select></label>
    {recipientType==="contact"?<>
      <label>Recipient<select value={contactId} onChange={e=>{reset();setContact(e.target.value);}} disabled={busy||sent}><option value="">Choose a contact</option>{contacts.map(c=><option value={c.id} key={c.id}>{c.name} · {c.phone}</option>)}</select></label>
      {!contacts.length&&<small>Save a contact with consent first. <button type="button" className="link" onClick={()=>go("Contacts")}>Contacts →</button></small>}
    </>:<>
      <label>Recipient group<select value={groupId} onChange={e=>{reset();setGroup(e.target.value);}} disabled={busy||sent}><option value="">Choose a group</option>{state.groups.map(g=><option value={g.id} key={g.id}>{g.name} ({g.contactCount??0})</option>)}</select></label>
      {group&&<div className="hint">This group has {groupMembers.length} contacts. {eligibleGroupMembers.length} opted-in contacts will receive the message; {groupMembers.length-eligibleGroupMembers.length} without consent will be skipped.</div>}
      {!state.groups.length&&<small>Create a contact group and assign contacts first. <button type="button" className="link" onClick={()=>go("Contacts")}>Open Contacts →</button></small>}
      {group&&eligibleGroupMembers.length===0&&<small>This group has no opted-in contacts, so it cannot receive a send.</small>}
    </>}
    <label>Approved template<select value={templateId} onChange={e=>{reset();setTemplate(e.target.value);setParams([]);}} disabled={busy||sent}><option value="">Choose a template</option>{templates.map(t=><option key={t.id} value={t.id}>{t.name} · {t.language}</option>)}</select></label>
    {!templates.length&&<small>Sync or create an approved text template. <button type="button" className="link" onClick={()=>go("Templates")}>Templates →</button></small>}
    {values.map((v,i)=><label key={i}>Field {i+1}<input value={v} disabled={busy||sent} onChange={e=>{reset();setParams(values.map((s,j)=>j===i?e.target.value:s));}} required /></label>)}
    {reviewed&&!sent&&<div className="hint">{recipientType==="contact"?<>Send this WhatsApp message to <strong>{contact?.name}</strong> at {contact?.phone}?</>:<>Send this WhatsApp message to <strong>{eligibleGroupMembers.length} opted-in contacts</strong> in “{group?.name}”?</>}</div>}
    {sent?<button type="button" className="primary" onClick={()=>go("Messages")}>View message history →</button>:<button className="primary" disabled={busy||!ready}>{busy?"Working…":reviewed?"Confirm and send":"Review message"}</button>}
  </form><aside className="panel preview-panel"><h2>Message preview</h2><div className="preview-chat"><div className="conversation-label"><span className="brand-mark mini">B</span>Mancherikalam BigBazar</div><div className="chat-bubble">{preview||"Select a template to preview the message here."}</div></div>{template&&<small>{template.name} · {template.language}</small>}</aside></div>;
}

