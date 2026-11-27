"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Action, Contact, DeskState, Message, View } from "../components/types";
import { Badge, Compose, ContactEditor, GroupManager, TemplateEditor } from "../components/forms";

const nav: {view:View;mark:string}[] = [{view:"Overview",mark:"▦"},{view:"Messages",mark:"✉"},{view:"Contacts",mark:"♧"},{view:"Templates",mark:"▤"},{view:"Setup",mark:"⚙"}];
const dateTime=(date:string)=>new Intl.DateTimeFormat(undefined,{day:"numeric",month:"short",hour:"numeric",minute:"2-digit"}).format(new Date(date));
function nameFor(state:DeskState,phone:string) {return state.contacts.find(c=>c.phone===phone)?.name||phone;}
function avatar(name:string){return /^[+\d]/.test(name)?"#":name.split(/\s+/).slice(0,2).map(w=>w[0]).join("").toUpperCase();}

function MessageRows({rows,state}:{rows:Message[];state:DeskState}) {
  return <ul className="items">{rows.map(m=>{
    const name=nameFor(state,m.phone);
    return <li key={m.id}><span className="avatar">{avatar(name)}</span><div className="list-main"><strong>{name}</strong><small>{m.direction==="IN"?"Received from":"To"} {m.phone} · {dateTime(m.createdAt)}</small><p className="message-text">{m.body}</p>{m.error&&<small className="error-text">{m.error}</small>}</div><Badge status={m.status}/></li>;
  })}</ul>;
}
function Empty({title,details}:{title:string;details?:string}) {
  return <div className="empty"><div className="empty-mark" aria-hidden>✉</div><strong>{title}</strong>{details&&<p>{details}</p>}</div>;
}
function SetupPanel({state,run,busy}:{state:DeskState;run:Action;busy:boolean}){
  const cfg=state.setup;
  const rows=[["Phone Number ID",cfg.phoneNumberId||"Missing"],["Messaging Account ID",cfg.accountId||"Missing"],["Graph API",cfg.version||"Default"],["System User access token",cfg.hasToken?"Configured":"Missing"],["App secret",cfg.hasAppSecret?"Configured":"Missing"],["Webhook verify token",cfg.hasVerifyToken?"Configured":"Missing"]];
  return <div className="compose-grid"><section className="panel"><div className="card-head"><h2>Account configuration</h2><button className="secondary" disabled={busy||!cfg.hasToken} onClick={()=>run("check",{},"Meta connection verified.")}>{busy?"Checking…":"Check connection"}</button></div><dl className="config">{rows.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></section>
  <section className="panel padded"><h2>Connect Meta</h2><ol className="steps"><li>For a local desk, run <code>npm run setup</code> in the app folder. For a hosted desk, update the Meta credentials in your hosting environment settings.</li><li>Restart the app, open Templates, and select <strong>Sync from Meta</strong> to check your account access.</li><li>For incoming messages and delivery receipts, configure your HTTPS webhook in Meta using the instructions in the project README.</li></ol></section></div>;
}
export default function Dashboard(){
  const [view,setView]=useState<View>("Overview"), [state,setState]=useState<DeskState|null>(null), [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState(""), [error,setError]=useState(""), [loadError,setLoadError]=useState("");
  const [edit,setEdit]=useState<Contact|"new"|null>(null), [creating,setCreating]=useState(false), [query,setQuery]=useState(""), [direction,setDirection]=useState("all");
  const request=useRef(0),pending=useRef(false);
  const refresh=useCallback(async()=>{
    const id=++request.current;
    try {
      const res=await fetch("/api/desk/state",{cache:"no-store"});
      if(res.status===401 || res.redirected){window.location.assign("/login");return;}
      const data=await res.json(); if(!res.ok) throw new Error(data.error||"Cannot read the workspace.");
      if(id===request.current){setState(data);setLoadError("");}
    } catch(e){if(id===request.current)setLoadError(e instanceof Error?e.message:"Could not load workspace.");}
  },[]);
  useEffect(()=>{void refresh();const timer=setInterval(()=>{if(document.visibilityState==="visible" && !pending.current)void refresh();},20000);return()=>{clearInterval(timer);request.current++;};},[refresh]);
  function go(next:View){setView(next);setEdit(null);setCreating(false);setQuery("");setDirection("all");setError("");setNotice("");}
  async function run(action:string,body:unknown,success:string){
    if(pending.current)return false;pending.current=true;setBusy(true);setError("");setNotice("");
    try{
      const response=await fetch("/api/desk/"+action,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      if(response.status===401||response.redirected){window.location.assign("/login");return false;}
      const result=await response.json();if(!response.ok || result.error)throw new Error(result.error||"The request failed.");
      const message=action==="check"
        ? "Connected to "+result.account+" · "+result.phone
        : action==="send-group"
          ? `Meta accepted ${result.sent} messages for “${result.groupName}”; ${result.failed} not confirmed, ${result.skipped} skipped because consent is missing.`
          : success;
      setNotice(message);await refresh();return true;
    }catch(e){setError(e instanceof Error?e.message:"The request failed.");await refresh();return false;}
    finally{pending.current=false;setBusy(false);}
  }
  async function logout(){try{const res=await fetch("/api/session",{method:"POST"});if(!res.ok)throw new Error();window.location.assign("/login");}catch{setError("Could not sign out. Try again.");}}
  const meta=state?.setup;
  const sendable=(state?.templates||[]).filter(t=>t.status.toUpperCase()==="APPROVED"&&t.supported);
  const book=(state?.contacts||[]).filter(c=>(c.name+" "+c.phone).toLowerCase().includes(query.trim().toLowerCase()));
  const feed=(state?.messages||[]).filter(m=>(direction==="all"||m.direction===direction)&&(m.phone+" "+nameFor(state!,m.phone)+" "+m.body+" "+m.status).toLowerCase().includes(query.trim().toLowerCase()));
  const titles:Record<View,string>={Overview:"Workspace overview",Messages:"Message history",Contacts:"Contacts",Templates:"Message templates",Compose:"Compose a message",Setup:"Workspace setup"};
  return <div className="shell">
    <aside className="rail"><div className="identity"><span className="brand-mark">B</span><div><strong>BigBazar</strong><small>Messaging desk</small></div></div>
      <nav aria-label="Workspace">{nav.map(n=><button aria-current={view===n.view?"page":undefined} className={view===n.view?"active":""} onClick={()=>go(n.view)} key={n.view}><span aria-hidden>{n.mark}</span>{n.view}</button>)}</nav>
      <div className="rail-bottom"><div className="operator-dot"/>Local operator<button className="signout" onClick={logout}>Sign out</button></div>
    </aside>
    <main className="stage"><div className="crumb">Mancherikalam BigBazar <span>/</span> {view}</div>
    <header className="page-head"><h1>{titles[view]}</h1>{(view==="Overview"||view==="Messages")&&<button className="primary" onClick={()=>go("Compose")}>＋ Compose message</button>}
    {view==="Contacts"&&<button className="primary" onClick={()=>setEdit("new")}>＋ Add contact</button>}
    {view==="Templates"&&<div className="actions"><button className="secondary" disabled={busy||!meta?.hasToken} onClick={()=>run("sync",{},"Templates synced from Meta.")}>{busy?"Working…":"↻ Sync from Meta"}</button><button className="primary" onClick={()=>setCreating(true)}>＋ New template</button></div>}</header>
    {loadError&&<div role="alert" className="alert bad">Couldn’t load workspace data. {loadError} <button className="link" onClick={refresh}>Retry</button></div>}
    {error&&<div role="alert" className="alert bad">{error}</div>}{notice&&<div role="status" className="alert good">{notice}</div>}
    {!state&&!loadError&&<div className="panel padded" role="status">Loading workspace…</div>}
    {state&&view==="Overview"&&<>
      <section className="account-card"><div><small>Sending account</small><h2>Mancherikalam BigBazar</h2><p>{state.setup.phoneNumberId==="1524500964085667"?"+91 77366 85977":state.setup.phoneNumberId?"Phone ID "+state.setup.phoneNumberId:"Configure your business number"}</p></div><button onClick={()=>go("Setup")}>Account setup <span aria-hidden>↗</span></button></section>
      <div className="stats">{[{label:"Contacts",value:state.contacts.length,view:"Contacts"},{label:"Approved text templates",value:sendable.length,view:"Templates"},{label:"Recent messages (up to 250)",value:state.messages.length,view:"Messages"}].map(s=><button key={s.label} onClick={()=>go(s.view as View)}><span>{s.label}</span><strong>{s.value}</strong><i aria-hidden>↗</i></button>)}</div>
      <section className="panel padded"><h2>Messaging balance</h2><p>Balance and remaining message estimates are unavailable in this desk. Check your payment account in Meta for the current balance.</p></section>
      <section className="panel"><div className="card-head"><h2>Recent messages</h2><button className="link" onClick={()=>go("Messages")}>View history →</button></div>{state.messages.length?<MessageRows state={state} rows={state.messages.slice(0,5)} />:<Empty title="Your message history starts here" details="Send your first template or connect a webhook to receive customer replies."/>}</section>
    </>}
    {state&&view==="Messages"&&<section className="panel"><div className="toolbar"><input aria-label="Search messages" placeholder="Search name, phone or message" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Direction" value={direction} onChange={e=>setDirection(e.target.value)}><option value="all">All messages</option><option value="IN">Incoming</option><option value="OUT">Outgoing</option></select><button className="secondary" onClick={refresh}>Refresh</button></div>{feed.length?<MessageRows rows={feed} state={state}/>:<Empty title="No matching messages" details={query?"Try a different search.":"Delivery updates and replies appear here when the webhook is connected."}/>}</section>}
    {state&&view==="Contacts"&&<>{edit&&<ContactEditor key={edit==="new"?"new":edit.id} contact={edit==="new"?undefined:edit} groups={state.groups} run={run} busy={busy} close={()=>setEdit(null)}/>}<GroupManager groups={state.groups} run={run} busy={busy}/><section className="panel"><div className="toolbar"><h2>Address book</h2><input aria-label="Search contacts" placeholder="Search name or phone" value={query} onChange={e=>setQuery(e.target.value)}/></div>{book.length?<ul className="items">{book.map(c=><li key={c.id}><span className="avatar">{avatar(c.name)}</span><div className="list-main"><strong>{c.name}</strong><small>{c.phone}</small>{c.groups.length>0&&<div className="group-tags">{c.groups.map(g=><span key={g.id}>{g.name}</span>)}</div>}</div><Badge status={c.consent?"Opted in":"No consent"}/><button className="quiet" onClick={()=>setEdit(c)}>Edit</button></li>)}</ul>:<Empty title={query?"No matching contacts":"Your address book is empty"} details="Add a customer's name, number and messaging consent."/>}</section></>}
    {state&&view==="Templates"&&<>{creating&&<TemplateEditor run={run} busy={busy} close={()=>setCreating(false)}/>}<section className="panel"><div className="card-head"><h2>Template library</h2><small>{state.templates.length} total</small></div>{state.templates.length?<ul className="items">{state.templates.map(t=><li key={t.id}><span className="avatar tile">▤</span><div className="list-main"><strong>{t.name}</strong><small>{t.language} · {t.category.toLowerCase()}{!t.supported?" · Unsupported format":""}</small><p className="message-text">{t.body}</p></div><Badge status={t.status}/></li>)}</ul>:<Empty title="No templates in the local library" details="Sync templates from Meta or create one for review."/>}</section></>}
    {state&&view==="Compose"&&<Compose state={state} run={run} busy={busy} go={go}/>}
    {state&&view==="Setup"&&<SetupPanel state={state} run={run} busy={busy}/>}
    </main></div>;
}

