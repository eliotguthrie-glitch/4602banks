import { useState, useMemo, useRef, useEffect, useCallback, Fragment } from "react";

// ── Supabase ───────────────────────────────────────────────────────────────
const SB_URL = "https://wsitewxcjuevhujckvsm.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndzaXRld3hjanVldmh1amNrdnNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5ODcxOTcsImV4cCI6MjA4ODU2MzE5N30.VhlZ2Gt8apYzQQO-vXz4bSIkEkTOdDmpwkPME69FPBQ";
let AUTH_TOKEN = null; // set on login, referenced by all mutations
let _devNextId = (() => {
  try { const d = JSON.parse(localStorage.getItem("4602banks_dev_data")||"{}");
    let max = 9000;
    ["projects","tasks","expenses","events","team","proceeds"].forEach(k=>{
      (d[k]||[]).forEach(r=>{ if(r && typeof r.id==="number" && r.id>max) max=r.id; });
    });
    (d.quotes||[]).forEach(q=>{ if(q.id>max) max=q.id; (q.contractors||[]).forEach(c=>{if(c.id>max)max=c.id;}); (q.items||[]).forEach(it=>{if(it.id>max)max=it.id;}); });
    return max;
  } catch(e){ return 9000; }
})();

const sbFetch = (path, opts={}) => {
  const tok = AUTH_TOKEN || SB_KEY;
  return fetch(SB_URL+path, {
    ...opts,
    headers: {
      "apikey": SB_KEY,
      "Authorization": "Bearer "+tok,
      "Content-Type": "application/json",
      ...(opts.headers||{}),
    },
  }).then(r => r.text().then(t => {
    if(!r.ok) throw new Error(t);
    return t ? JSON.parse(t) : null;
  }));
};

const _isDev = () => import.meta.env.DEV && !AUTH_TOKEN;

const sbSignIn  = (email, pw) => sbFetch("/auth/v1/token?grant_type=password", {method:"POST", body:JSON.stringify({email,password:pw})});
const sbSignOut = ()          => sbFetch("/auth/v1/logout", {method:"POST"});
const sbQ       = (table, qs) => sbFetch("/rest/v1/"+table+(qs?"?"+qs:"?select=*"));
const sbInsertRow = (table, data) => {
  if(_isDev()) { const id = ++_devNextId; return Promise.resolve([{id, ...data, created_at:new Date().toISOString()}]); }
  return sbFetch("/rest/v1/"+table, {method:"POST", headers:{"Prefer":"return=representation"}, body:JSON.stringify(data)});
};
const sbPatch = (table, id, data) => {
  if(_isDev()) return Promise.resolve([{id, ...data}]);
  return sbFetch("/rest/v1/"+table+"?id=eq."+id, {method:"PATCH", headers:{"Prefer":"return=representation"}, body:JSON.stringify(data)});
};
const sbDel = (table, id) => {
  if(_isDev()) return Promise.resolve(null);
  return sbFetch("/rest/v1/"+table+"?id=eq."+id, {method:"DELETE"});
};

// DB → app field mappers
const mapProject   = p => ({...p, start:p.start_date, end:p.end_date, budget:p.target_budget||p.budget||0, target_budget:p.target_budget||p.budget||0, contingency:p.contingency||0, photos:[]});
const mapTask    = t => ({...t, start:t.start_date, end:t.end_date, actual_cost:t.actual_cost||null, materials:t.materials||[], photos:[]});
const taskTotalEst = (t, allTasks) => (t.price||0) + (allTasks||[]).filter(s=>s.parent_task_id===t.id).reduce((s,s2)=>s+(s2.price||0),0) + (t.materials||[]).reduce((s,m)=>s+(parseFloat(m.cost)||0)*(parseFloat(m.qty)||1),0);
const taskTotalAct = (t, allTasks) => (t.actual_cost||0) + (allTasks||[]).filter(s=>s.parent_task_id===t.id).reduce((s,s2)=>s+(s2.actual_cost||0),0) + (t.materials||[]).reduce((s,m)=>s+(parseFloat(m.actual_cost)||0)*(parseFloat(m.qty)||1),0);
const mapEvent   = e => ({...e, date:e.event_date, end_date:e.event_end_date||null, type:e.event_type, time:e.event_time||""});
const mapExpense = e => ({...e, date:e.expense_date});
const mapQuote   = q => ({
  id:q.id, project_id:q.project_id, task_id:q.task_id||null, awarded_to:q.awarded_to, notes:q.notes,
  contractors:(q.quote_contractors_quote_id_fkey||q.quote_contractors||[]).sort((a,b)=>a.sort_order-b.sort_order),
  items:(q.quote_items||[]).sort((a,b)=>a.sort_order-b.sort_order).map(item=>({
    id:item.id, label:item.label,
    amounts:Object.fromEntries((item.quote_item_amounts||[]).map(a=>[a.contractor_id,a.amount])),
  })),
});

// ── Tokens ─────────────────────────────────────────────────────────────────
const C = {
  bg:"#F7F7F5", surface:"#FFFFFF", hover:"#F1F1EF", border:"#E5E5E3",
  divider:"#EBEBEA", text:"#1A1A1A", muted:"#91918E", faint:"#C7C7C5",
  accent:"#2383E2", accentBg:"#EBF3FD", green:"#1D7D4A", greenBg:"#EEFBF4",
  sidebar:"#F7F7F5", sideText:"#73726E",
  phase:["#E16A16","#2AA981","#9B59B6","#2980B9","#C0392B","#27AE60"],
};
const pc = id => C.phase[(id-1) % C.phase.length];

// ── Seed data ──────────────────────────────────────────────────────────────
const PROJECT = {name:"4602 Banks", address:"4602 Banks St, New Orleans LA", total_budget:185000, start:"2026-02-01", end:"2026-11-30"};

const PHASES_SEED = [
  {id:1,name:"HVAC System",      budget:18000,start:"2026-02-01",end:"2026-03-15",status:"active",   notes:"Phased install — Unit 1 (rental) first, Unit 2 after tenant moves out.",photos:[]},
  {id:2,name:"Kitchen",          budget:45000,start:"2026-03-15",end:"2026-06-30",status:"planning", notes:"Full gut. Keeping footprint. Induction range, integrated fridge. Elysha leading tile/cabinet selections.",photos:[]},
  {id:3,name:"Master Bath",      budget:28000,start:"2026-05-01",end:"2026-07-31",status:"planning", notes:"Walk-in shower, double vanity. Zellige tile on accent wall.",photos:[]},
  {id:4,name:"Guest Bath",       budget:18000,start:"2026-07-01",end:"2026-08-31",status:"planning", notes:"Simpler scope — new fixtures, tile floor, fresh paint.",photos:[]},
  {id:5,name:"Exterior + Porch", budget:32000,start:"2026-08-01",end:"2026-11-01",status:"planning", notes:"Structural assessment needed before scoping porch work. Paint color TBD.",photos:[]},
  {id:6,name:"Landscaping",      budget:12000,start:"2026-10-01",end:"2026-11-30",status:"planning", notes:"Native plantings. Drip irrigation.",photos:[]},
];

const TASKS_SEED = [
  {id:1, project_id:1,title:"Get 3 contractor bids",        start:"2026-02-03",end:"2026-02-10",status:"complete",    assignee:"Eliot",        notes:"Castillo came in lowest at $16,200.",photos:[]},
  {id:2, project_id:1,title:"Permit application",           start:"2026-02-10",end:"2026-02-15",status:"complete",    assignee:"Eliot",        notes:"Filed with City of New Orleans.",photos:[]},
  {id:3, project_id:1,title:"Unit 1 installation",          start:"2026-02-20",end:"2026-03-01",status:"in_progress", assignee:"Castillo HVAC",notes:"Carrier 3-ton unit. Access through rear.",photos:[]},
  {id:4, project_id:1,title:"Unit 2 installation",          start:"2026-03-01",end:"2026-03-15",status:"todo",        assignee:"Castillo HVAC",notes:"Hold until rental unit vacated.",photos:[]},
  {id:5, project_id:2,title:"Design finalization",          start:"2026-03-15",end:"2026-03-25",status:"todo",        assignee:"Eliot",        notes:"",photos:[]},
  {id:6, project_id:2,title:"Order cabinets",               start:"2026-03-25",end:"2026-04-05",status:"todo",        assignee:"Elysha",       notes:"IKEA SEKTION or semi-custom. Lead time ~6 weeks.",photos:[],materials:[{name:"SEKTION base cabinets",qty:"6",unit:"ea",cost:"280"},{name:"SEKTION wall cabinets",qty:"4",unit:"ea",cost:"220"},{name:"Drawer fronts",qty:"12",unit:"ea",cost:"45"}]},
  {id:7, project_id:2,title:"Demo existing kitchen",        start:"2026-04-10",end:"2026-04-22",status:"todo",        assignee:"GC",           notes:"",photos:[]},
  {id:8, project_id:2,title:"Cabinet installation",         start:"2026-05-01",end:"2026-05-28",status:"todo",        assignee:"GC",           notes:"",photos:[]},
  {id:9, project_id:2,title:"Countertop template + install",start:"2026-06-01",end:"2026-06-16",status:"todo",        assignee:"GC",           notes:"Quartz preferred.",photos:[]},
  {id:10,project_id:2,title:"Appliance hookup",             start:"2026-06-20",end:"2026-06-30",status:"todo",        assignee:"GC",           notes:"",photos:[]},
  {id:11,project_id:3,title:"Tile selection",               start:"2026-05-01",end:"2026-05-10",status:"todo",        assignee:"Elysha",       notes:"",photos:[],materials:[{name:"Zellige tile (accent wall)",qty:"80",unit:"sqft",cost:"18"},{name:"Floor tile",qty:"120",unit:"sqft",cost:"6"}]},
  {id:12,project_id:3,title:"Demo + rough plumbing",        start:"2026-05-15",end:"2026-05-30",status:"todo",        assignee:"GC",           notes:"",photos:[]},
  {id:13,project_id:3,title:"Tile installation",            start:"2026-06-10",end:"2026-06-30",status:"todo",        assignee:"GC",           notes:"",photos:[]},
  {id:14,project_id:3,title:"Fixtures + finish",            start:"2026-07-15",end:"2026-07-31",status:"todo",        assignee:"GC",           notes:"",photos:[]},
  {id:15,project_id:5,title:"Porch structural assessment",  start:"2026-08-05",end:"2026-08-18",status:"todo",        assignee:"Eliot",        notes:"",photos:[]},
  {id:16,project_id:5,title:"Exterior paint",               start:"2026-09-01",end:"2026-09-30",status:"todo",        assignee:"GC",           notes:"",photos:[]},
  {id:17,project_id:6,title:"Plant selection + layout",     start:"2026-10-01",end:"2026-10-18",status:"todo",        assignee:"Elysha",       notes:"",photos:[]},
  {id:18,project_id:6,title:"Irrigation install",           start:"2026-10-20",end:"2026-11-05",status:"todo",        assignee:"GC",           notes:"",photos:[]},
];

const EXPENSES_SEED = [
  {id:1,project_id:1,category:"Labor",    vendor:"Castillo HVAC",      amount:8500,date:"2026-02-20"},
  {id:2,project_id:1,category:"Materials",vendor:"Johnstone Supply",    amount:3200,date:"2026-02-22"},
  {id:3,project_id:1,category:"Permits",  vendor:"City of New Orleans", amount:450, date:"2026-02-15"},
];

// Quote structure: {id, phase_id, contractors:[{id,name,phone,email}], items:[{id,label,amounts:{contractorId:number}}], awarded_to:contractorId|null, notes:""}
const QUOTES_SEED = [
  {
    id:1, project_id:1,
    awarded_to:1,
    notes:"Awarded to Castillo. Best price, good references.",
    contractors:[
      {id:1,name:"Castillo HVAC",    phone:"504-555-0101",email:"castillo@hvac.com"},
      {id:2,name:"Cool Air Services",phone:"504-555-0202",email:"info@coolair.com"},
      {id:3,name:"Delta Mechanical", phone:"504-555-0303",email:"bids@deltamech.com"},
    ],
    items:[
      {id:1,label:"Labor",           amounts:{1:9200, 2:10800, 3:11500}},
      {id:2,label:"Equipment / units",amounts:{1:6200, 2:6800,  3:6200}},
      {id:3,label:"Materials",       amounts:{1:800,  2:950,   3:1100}},
      {id:4,label:"Permits + fees",  amounts:{1:450,  2:450,   3:450}},
    ],
  },
];

const EVENTS_SEED = [
  {id:1, date:"2026-03-12",title:"Plumbing rough-in inspection",  type:"inspection", project_id:1,   notes:"Inspector: Marcus Webb, 504-555-9001. Confirm 48hrs prior.",done:false},
  {id:2, date:"2026-03-15",title:"Castillo HVAC final walkthrough",type:"walkthrough",project_id:1,   notes:"Walk both units before sign-off.",done:false},
  {id:3, date:"2026-04-01",title:"Cabinet delivery",              type:"delivery",   project_id:2,   notes:"Confirm delivery window the day before.",done:false},
  {id:4, date:"2026-04-10",title:"Kitchen demo start",            type:"milestone",  project_id:2,   notes:"",done:false},
  {id:5, date:"2026-06-15",title:"Countertop template day",       type:"delivery",   project_id:2,   notes:"Fabricator on-site 9am.",done:false},
  {id:6, date:"2026-08-01",title:"Structural engineer site visit", type:"inspection", project_id:5,   notes:"Re: porch load-bearing assessment.",done:false},
];

const TODAY = "2026-03-08";

const EVENT_TYPES = [
  {value:"inspection", label:"Inspection", color:"#9B59B6"},
  {value:"walkthrough",label:"Walkthrough",color:"#2383E2"},
  {value:"delivery",   label:"Delivery",   color:"#E16A16"},
  {value:"milestone",  label:"Milestone",  color:"#2AA981"},
  {value:"meeting",    label:"Meeting",    color:"#C0392B"},
  {value:"other",      label:"Other",      color:"#73726E"},
];
const eventColor = t => (EVENT_TYPES.find(e=>e.value===t)||EVENT_TYPES[5]).color;
const eventLabel = t => (EVENT_TYPES.find(e=>e.value===t)||EVENT_TYPES[5]).label;

// ── Utils ──────────────────────────────────────────────────────────────────
const toMs        = s    => new Date(s+"T12:00:00").getTime();
const toISO       = ms   => new Date(ms).toISOString().split("T")[0];
const daysBetween = (a,b)=> Math.round((toMs(b)-toMs(a))/86400000);
const addDays     = (s,n)=> toISO(toMs(s)+n*86400000);
const datePct     = (d,s,e)=> Math.max(0,Math.min(100,((toMs(d)-toMs(s))/(toMs(e)-toMs(s)))*100));
const fmtD        = s    => s ? new Date(s+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"}) : "—";
const fmtDow      = s    => s ? new Date(s+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"}) : "—";
const fmtFull     = s    => s ? new Date(s+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "—";
const fmtM        = n    => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
const fmtN        = n    => n ? new Intl.NumberFormat("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}).format(n) : "";
const parseMoney  = s    => parseFloat(String(s).replace(/[^0-9.\-]/g,""))||0;
const uid         = ()   => Math.random().toString(36).slice(2,9);

// ── Shared UI ──────────────────────────────────────────────────────────────
function Chip({status}) {
  const map={complete:{bg:"#EEFBF4",color:"#1D7D4A",label:"Done"},todo:{bg:"#F1F1EF",color:"#73726E",label:"To do"},active:{bg:"#EBF3FD",color:"#1A6BBC",label:"Active"},planning:{bg:"#F1F1EF",color:"#73726E",label:"Planning"},on_hold:{bg:"#FEF9EC",color:"#A0700A",label:"On hold"}};
  const {bg,color,label}=map[status]||map.todo;
  return <span style={{background:bg,color,fontSize:11,fontWeight:500,padding:"2px 8px",borderRadius:4,whiteSpace:"nowrap"}}>{label}</span>;
}

function Avatar({name,size=20}) {
  const cols=["#E16A16","#2AA981","#9B59B6","#2980B9","#C0392B","#27AE60","#2383E2"];
  const col=cols[name.charCodeAt(0)%cols.length];
  const ini=name.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);
  return <span title={name} style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:size,height:size,borderRadius:"50%",background:col,color:"white",fontSize:size*0.42,fontWeight:700,flexShrink:0}}>{ini}</span>;
}

function CheckBox({done,onClick}) {
  return (
    <div onClick={onClick} style={{width:15,height:15,borderRadius:3,flexShrink:0,border:`1.5px solid ${done?C.accent:C.faint}`,background:done?C.accent:"transparent",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",marginTop:1}}>
      {done&&<svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1.5 4L3.5 6L6.5 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
    </div>
  );
}

function PhotoGrid({photos,onAdd,onRemove}) {
  const ref=useRef(null);
  const handle=e=>{
    Array.from(e.target.files).forEach(f=>{
      const r=new FileReader();r.onload=ev=>onAdd({id:uid(),url:ev.target.result,name:f.name});r.readAsDataURL(f);
    });e.target.value="";
  };
  return (
    <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
      {photos.map(p=>(
        <div key={p.id} style={{position:"relative",width:88,height:68,borderRadius:5,overflow:"hidden",border:`1px solid ${C.border}`,flexShrink:0}}>
          <img src={p.url} alt={p.name} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
          <button onClick={()=>onRemove(p.id)} style={{position:"absolute",top:3,right:3,background:"rgba(0,0,0,0.55)",color:"white",border:"none",borderRadius:3,width:16,height:16,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700}}>✕</button>
        </div>
      ))}
      <button onClick={()=>ref.current?.click()} style={{width:88,height:68,borderRadius:5,border:`1.5px dashed ${C.faint}`,background:C.bg,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,color:C.muted,flexShrink:0}}>
        <svg width="14" height="14" fill="none" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke={C.muted} strokeWidth="2" strokeLinecap="round"/></svg>
        <span style={{fontSize:10}}>Add</span>
      </button>
      <input ref={ref} type="file" accept="image/*" multiple onChange={handle} style={{display:"none"}}/>
    </div>
  );
}

function NoteField({value,onChange,placeholder="Add notes...",rows=4}) {
  return (
    <textarea value={value||""} onChange={e=>onChange(e.target.value)} placeholder={placeholder} rows={rows}
      style={{width:"100%",resize:"vertical",border:`1px solid ${C.border}`,borderRadius:6,padding:"9px 12px",fontSize:13,color:C.text,background:C.bg,fontFamily:"inherit",lineHeight:1.6,outline:"none",boxSizing:"border-box"}}
      onFocus={e=>e.target.style.borderColor=C.accent} onBlur={e=>e.target.style.borderColor=C.border}/>
  );
}

function Breadcrumb({crumbs}) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:20,fontSize:13,color:C.muted}}>
      {crumbs.map((c,i)=>(
        <span key={i} style={{display:"flex",alignItems:"center",gap:6}}>
          {i>0&&<span style={{color:C.faint}}>/</span>}
          {c.onClick?<span onClick={c.onClick} style={{cursor:"pointer",color:C.muted}}>{c.label}</span>:<span style={{color:C.text,fontWeight:500}}>{c.label}</span>}
        </span>
      ))}
    </div>
  );
}

function Input({value,onChange,placeholder,style={}}) {
  return <input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
    style={{border:`1px solid ${C.border}`,borderRadius:5,padding:"7px 10px",fontSize:13,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none",width:"100%",...style}}
    onFocus={e=>e.target.style.borderColor=C.accent} onBlur={e=>e.target.style.borderColor=C.border}/>;
}

function Btn({onClick,children,variant="default",style={}}) {
  const styles={
    default:{background:C.surface,color:C.text,border:`1px solid ${C.border}`},
    primary:{background:C.accent,color:"white",border:"none"},
    ghost:{background:"transparent",color:C.muted,border:"none"},
    danger:{background:"transparent",color:"#9E3C3C",border:`1px solid #F5C5C5`},
  };
  return <button onClick={onClick} style={{padding:"6px 12px",fontSize:12,fontWeight:500,borderRadius:5,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:5,...styles[variant],...style}}>{children}</button>;
}

// ── QUOTE COMPARISON ───────────────────────────────────────────────────────
function QuoteComparison({quote,onUpdate,phaseName,onAward}) {
  const totals = useMemo(()=>{
    const t={};
    quote.contractors.forEach(c=>{t[c.id]=quote.items.reduce((s,item)=>s+(item.amounts[c.id]||0),0);});
    return t;
  },[quote]);
  const lowestId = useMemo(()=>{
    if(!quote.contractors.length) return null;
    return quote.contractors.reduce((a,b)=>(totals[a.id]||Infinity)<=(totals[b.id]||Infinity)?a:b).id;
  },[totals,quote.contractors]);

  const updQ = fn => onUpdate(q=>fn(q));

  const setAmount=(itemId,cId,val)=>{
    updQ(q=>({...q,items:q.items.map(i=>i.id===itemId?{...i,amounts:{...i.amounts,[cId]:parseFloat(val)||0}}:i)}));
  };
  const addContractor=()=>{
    const c={id:uid(),name:"Contractor "+(quote.contractors.length+1),phone:"",email:""};
    updQ(q=>({...q,contractors:[...q.contractors,c],items:q.items.map(i=>({...i,amounts:{...i.amounts,[c.id]:0}}))}));
  };
  const removeContractor=id=>{
    updQ(q=>({...q,contractors:q.contractors.filter(c=>c.id!==id),items:q.items.map(i=>{const a={...i.amounts};delete a[id];return{...i,amounts:a};})}));
  };
  const updateContractor=(id,field,val)=>{
    updQ(q=>({...q,contractors:q.contractors.map(c=>c.id===id?{...c,[field]:val}:c)}));
  };
  const addItem=()=>{
    const amounts={};quote.contractors.forEach(c=>amounts[c.id]=0);
    updQ(q=>({...q,items:[...q.items,{id:uid(),label:"New line item",amounts}]}));
  };
  const removeItem=id=>updQ(q=>({...q,items:q.items.filter(i=>i.id!==id)}));
  const updateItemLabel=(id,val)=>updQ(q=>({...q,items:q.items.map(i=>i.id===id?{...i,label:val}:i)}));
  const award=id=>{
    const isUnawarding = id===null||quote.awarded_to===id;
    const newAwarded = isUnawarding?null:id;
    updQ(q=>({...q,awarded_to:newAwarded}));
    if(onAward) onAward(isUnawarding?null:(totals[id]||0));
  };

  const colW = 130;

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
        <p style={{fontSize:13,fontWeight:600,color:C.text}}>Quote Comparison — {phaseName}</p>
        <div style={{display:"flex",gap:8}}>
          <Btn onClick={addItem}>+ Line item</Btn>
          <Btn onClick={addContractor} variant="primary">+ Contractor</Btn>
        </div>
      </div>

      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
          <thead>
            <tr style={{background:C.bg}}>
              <th style={{padding:"10px 14px",textAlign:"left",borderBottom:`1px solid ${C.border}`,fontSize:11,fontWeight:600,color:C.muted,textTransform:"uppercase",letterSpacing:"0.06em",width:180}}>Line item</th>
              {quote.contractors.map(c=>(
                <th key={c.id} style={{padding:"10px 12px",borderBottom:`1px solid ${C.border}`,minWidth:colW,verticalAlign:"top"}}>
                  <div style={{display:"flex",flexDirection:"column",gap:4}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,justifyContent:"space-between"}}>
                      <input value={c.name} onChange={e=>updateContractor(c.id,"name",e.target.value)}
                        style={{fontWeight:600,fontSize:13,color:C.text,border:"none",background:"transparent",outline:"none",width:"100%",fontFamily:"inherit"}}/>
                      <button onClick={()=>removeContractor(c.id)} style={{background:"none",border:"none",cursor:"pointer",color:C.faint,fontSize:12,flexShrink:0}}>✕</button>
                    </div>
                    <input value={c.phone} onChange={e=>updateContractor(c.id,"phone",e.target.value)} placeholder="Phone"
                      style={{fontSize:11,color:C.muted,border:"none",background:"transparent",outline:"none",width:"100%",fontFamily:"inherit"}}/>
                    <input value={c.email} onChange={e=>updateContractor(c.id,"email",e.target.value)} placeholder="Email"
                      style={{fontSize:11,color:C.muted,border:"none",background:"transparent",outline:"none",width:"100%",fontFamily:"inherit"}}/>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {quote.items.map((item,ri)=>(
              <tr key={item.id} style={{borderBottom:`1px solid ${C.divider}`}}
                onMouseEnter={e=>e.currentTarget.style.background=C.hover}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}
              >
                <td style={{padding:"8px 14px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <input value={item.label} onChange={e=>updateItemLabel(item.id,e.target.value)}
                      style={{fontSize:13,color:C.text,border:"none",background:"transparent",outline:"none",fontFamily:"inherit",width:"100%"}}/>
                    <button onClick={()=>removeItem(item.id)} style={{background:"none",border:"none",cursor:"pointer",color:C.faint,fontSize:11,flexShrink:0,opacity:0}}
                      onMouseEnter={e=>e.target.style.opacity=1} onMouseLeave={e=>e.target.style.opacity=0}>✕</button>
                  </div>
                </td>
                {quote.contractors.map(c=>{
                  const val=item.amounts[c.id]||0;
                  const isLowest=quote.contractors.length>1&&val===Math.min(...quote.contractors.map(x=>item.amounts[x.id]||0))&&val>0;
                  return (
                    <td key={c.id} style={{padding:"8px 12px",textAlign:"right"}}>
                      <div style={{position:"relative",display:"inline-flex",alignItems:"center"}}>
                        <span style={{fontSize:12,color:C.muted,marginRight:2}}>$</span>
                        <input type="number" value={val||""} onChange={e=>setAmount(item.id,c.id,e.target.value)}
                          style={{width:80,textAlign:"right",fontSize:13,fontVariantNumeric:"tabular-nums",color:isLowest?C.green:C.text,fontWeight:isLowest?600:400,border:"none",background:"transparent",outline:"none",fontFamily:"inherit"}}/>
                        {isLowest&&<span style={{fontSize:9,color:C.green,marginLeft:2}}>↓</span>}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}

            {/* Totals */}
            <tr style={{background:C.bg,borderTop:`2px solid ${C.border}`}}>
              <td style={{padding:"11px 14px",fontWeight:600,fontSize:13,color:C.text}}>Total</td>
              {quote.contractors.map(c=>{
                const total=totals[c.id]||0;
                const isLow=c.id===lowestId&&quote.contractors.length>1;
                return (
                  <td key={c.id} style={{padding:"11px 12px",textAlign:"right",fontWeight:700,fontSize:14,fontVariantNumeric:"tabular-nums",color:isLow?C.green:C.text}}>
                    {fmtM(total)} {isLow&&<span style={{fontSize:10}}>↓ lowest</span>}
                  </td>
                );
              })}
            </tr>

            {/* Award row */}
            <tr style={{borderTop:`1px solid ${C.divider}`}}>
              <td style={{padding:"10px 14px",fontSize:12,color:C.muted}}>Award</td>
              {quote.contractors.map(c=>{
                const awarded=quote.awarded_to===c.id;
                return (
                  <td key={c.id} style={{padding:"10px 12px",textAlign:"right"}}>
                    <button onClick={()=>award(c.id)} style={{
                      padding:"5px 10px",fontSize:12,fontWeight:500,borderRadius:4,cursor:"pointer",
                      background:awarded?C.greenBg:"transparent",
                      color:awarded?C.green:C.muted,
                      border:`1px solid ${awarded?"#A3D9B8":C.border}`,
                    }}>{awarded?"✓ Awarded":"Award"}</button>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Notes */}
      <div style={{marginTop:16}}>
        <p style={{fontSize:11,color:C.muted,marginBottom:6,fontWeight:500}}>Notes</p>
        <NoteField value={quote.notes} onChange={v=>updQ(q=>({...q,notes:v}))} placeholder="Add notes about this bid comparison..." rows={3}/>
      </div>
    </div>
  );
}

// ── TASK DETAIL ────────────────────────────────────────────────────────────
function SubtaskPanel({taskId, projectId, tasks, onUpdateTask, onAddTask}) {
  const subtasks = tasks.filter(t=>t.parent_task_id===taskId);
  const [addingSub, setAddingSub] = useState(false);
  const subRef = useRef(null);
  useEffect(()=>{ if(addingSub && subRef.current) subRef.current.focus(); },[addingSub]);

  const estTotal = subtasks.reduce((s,st)=>s+(parseFloat(st.price)||0),0);
  const actTotal = subtasks.reduce((s,st)=>s+(parseFloat(st.actual_cost)||0),0);

  const syncParent = (excludeId, field, newVal) => {
    const total = subtasks.reduce((s,st)=>s+(st.id===excludeId?(field==="price"?newVal:(parseFloat(st.actual_cost)||0)):(field==="price"?(parseFloat(st.price)||0):(parseFloat(st.actual_cost)||0))),0);
    const actT = subtasks.reduce((s,st)=>s+(st.id===excludeId?(field==="actual_cost"?newVal:(parseFloat(st.price)||0)):(field==="actual_cost"?(parseFloat(st.actual_cost)||0):(parseFloat(st.price)||0))),0);
    // We only sync the specific field that changed
    if(field==="price"){
      const t2=subtasks.reduce((s,st)=>s+(st.id===excludeId?newVal:(parseFloat(st.price)||0)),0);
      onUpdateTask(taskId,t=>({...t,price:t2})); sbPatch("tasks",taskId,{price:t2}).catch(console.error);
    } else {
      const t2=subtasks.reduce((s,st)=>s+(st.id===excludeId?newVal:(parseFloat(st.actual_cost)||0)),0);
      onUpdateTask(taskId,t=>({...t,actual_cost:t2})); sbPatch("tasks",taskId,{actual_cost:t2}).catch(console.error);
    }
  };

  const commitSub = () => {
    const title = (subRef.current?.value||"").trim();
    if(!title) { setAddingSub(false); return; }
    const dbTask = {project_id:projectId, title, parent_task_id:taskId, assignee:"", start_date:null, end_date:null, status:"todo", notes:"", sort_order:0, price:0, actual_cost:0};
    if(subRef.current) subRef.current.value = "";
    setAddingSub(false);
    sbInsertRow("tasks", dbTask).then(rows=>{ if(rows?.[0]) onAddTask(mapTask(rows[0])); }).catch(console.error);
  };

  return (
    <div style={{border:`1px solid ${C.border}`,borderRadius:8,background:C.surface,marginBottom:16}}>
      <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.divider}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <p style={{fontSize:13,fontWeight:600,color:C.text}}>Subtasks <span style={{fontWeight:400,color:C.muted,fontSize:12}}>{subtasks.filter(t=>t.status==="complete").length}/{subtasks.length}</span></p>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          {(estTotal>0||actTotal>0)&&<span style={{fontSize:11,color:C.muted,fontWeight:500}}>
            {estTotal>0&&<>Est {fmtM(estTotal)}</>}{estTotal>0&&actTotal>0&&" · "}{actTotal>0&&<>Act {fmtM(actTotal)}</>}
          </span>}
          <button onClick={()=>setAddingSub(true)} style={{fontSize:12,color:C.accent,background:"none",border:"none",cursor:"pointer",padding:0,fontWeight:500}}>+ Add</button>
        </div>
      </div>
      {subtasks.length>0&&(
        <div style={{display:"flex",alignItems:"center",padding:"6px 16px",borderBottom:`1px solid ${C.divider}`,background:C.bg}}>
          <span style={{flex:1}}/>
          <span style={{width:78,fontSize:10,color:C.muted,fontWeight:600,textAlign:"right",textTransform:"uppercase",letterSpacing:"0.04em"}}>Est.</span>
          <span style={{width:78,fontSize:10,color:C.muted,fontWeight:600,textAlign:"right",textTransform:"uppercase",letterSpacing:"0.04em"}}>Actual</span>
          <span style={{width:24}}/>
        </div>
      )}
      {subtasks.map((st,i)=>(
        <div key={st.id} style={{display:"flex",alignItems:"center",gap:6,padding:"9px 16px",borderBottom:(i<subtasks.length-1||addingSub)?`1px solid ${C.divider}`:"none"}}
          onMouseEnter={e=>e.currentTarget.style.background=C.hover} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
          <div onClick={()=>{const ns=st.status==="complete"?"todo":"complete";onUpdateTask(st.id,t=>({...t,status:ns}));sbPatch("tasks",st.id,{status:ns}).catch(console.error);}}
            style={{width:13,height:13,borderRadius:2,flexShrink:0,cursor:"pointer",border:"1.5px solid "+(st.status==="complete"?C.green:C.faint),background:st.status==="complete"?C.green:"transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>
            {st.status==="complete"&&<svg width="7" height="7" viewBox="0 0 8 8" fill="none"><path d="M1.5 4L3.5 6L6.5 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
          </div>
          <span style={{fontSize:13,flex:1,color:st.status==="complete"?C.muted:C.text,textDecoration:st.status==="complete"?"line-through":"none"}}>{st.title}</span>
          <div style={{width:78,display:"flex",alignItems:"center",justifyContent:"flex-end",gap:2,flexShrink:0}}>
            <span style={{fontSize:11,color:C.muted}}>$</span>
            <input type="text" defaultValue={fmtN(st.price)} placeholder="0.00"
              onFocus={e=>{e.target.value=st.price||"";e.target.select();}}
              onBlur={e=>{const v=parseMoney(e.target.value);e.target.value=fmtN(v);onUpdateTask(st.id,t=>({...t,price:v}));sbPatch("tasks",st.id,{price:v}).catch(console.error);syncParent(st.id,"price",v);}}
              style={{width:52,fontSize:12,color:C.text,border:"none",background:"transparent",fontFamily:"inherit",outline:"none",padding:0,textAlign:"right",fontVariantNumeric:"tabular-nums"}}/>
          </div>
          <div style={{width:78,display:"flex",alignItems:"center",justifyContent:"flex-end",gap:2,flexShrink:0}}>
            <span style={{fontSize:11,color:C.muted}}>$</span>
            <input type="text" defaultValue={fmtN(st.actual_cost)} placeholder="0.00"
              onFocus={e=>{e.target.value=st.actual_cost||"";e.target.select();}}
              onBlur={e=>{const v=parseMoney(e.target.value);e.target.value=fmtN(v);onUpdateTask(st.id,t=>({...t,actual_cost:v}));sbPatch("tasks",st.id,{actual_cost:v}).catch(console.error);syncParent(st.id,"actual_cost",v);}}
              style={{width:52,fontSize:12,color:C.text,border:"none",background:"transparent",fontFamily:"inherit",outline:"none",padding:0,textAlign:"right",fontVariantNumeric:"tabular-nums"}}/>
          </div>
          {st.assignee?<span style={{width:24,fontSize:11,color:C.muted,textAlign:"center",flexShrink:0}} title={st.assignee}>{st.assignee.charAt(0)}</span>:<span style={{width:24,flexShrink:0}}/>}
        </div>
      ))}
      {addingSub&&(
        <div style={{display:"flex",alignItems:"center",gap:10,padding:"9px 16px"}}>
          <div style={{width:13,height:13,borderRadius:2,flexShrink:0,border:"1.5px solid "+C.faint}}/>
          <input ref={subRef} defaultValue="" placeholder="Subtask name"
            onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();commitSub();} if(e.key==="Escape")setAddingSub(false);}}
            onBlur={()=>{const v=(subRef.current?.value||"").trim();if(v)commitSub();else setAddingSub(false);}}
            style={{flex:1,fontSize:13,border:"none",outline:"none",background:"transparent",fontFamily:"inherit",color:C.text,padding:0}}/>
        </div>
      )}
      {subtasks.length===0&&!addingSub&&<p style={{padding:"12px 16px",fontSize:12,color:C.faint}}>No subtasks yet.</p>}
    </div>
  );
}

function TaskPage({task,phase,tasks,quotes,onBack,onNavigate,onUpdateTask,onAddTask,onUpdateQuote,onAddEvent,team}) {
  const [addedToCalendar, setAddedToCalendar] = useState(false);
  const [taskTab, setTaskTab] = useState("detail"); // "detail" | "quotes"
  const [editingTitle, setEditingTitle] = useState(false);
  const titleRef = useRef(null);
  const convertToEvent = () => {
    const ev = { title:task.title, event_date:task.start, event_type:"milestone", project_id:task.project_id, notes:task.notes||"", done:false };
    sbInsertRow("events", ev).then(rows=>{ if(rows?.[0]) onAddEvent(mapEvent(rows[0])); setAddedToCalendar(true); }).catch(console.error);
  };
  const taskQuote = (quotes||[]).find(q=>q.task_id===task.id);
  const subtasks = (tasks||[]).filter(t=>t.parent_task_id===task.id);
  const subEstTotal = subtasks.reduce((s,st)=>s+(parseFloat(st.price)||0),0);
  const subActTotal = subtasks.reduce((s,st)=>s+(parseFloat(st.actual_cost)||0),0);
  const matEstTotal = (task.materials||[]).reduce((s,m)=>s+(parseFloat(m.cost)||0)*(parseFloat(m.qty)||1),0);
  const matActTotal = (task.materials||[]).reduce((s,m)=>s+(parseFloat(m.actual_cost)||0)*(parseFloat(m.qty)||1),0);
  const totalEst = (task.price||0) + subEstTotal + matEstTotal;
  const totalAct = (task.actual_cost||0) + subActTotal + matActTotal;
  const variance = totalEst - totalAct;
  const hasActual = totalAct>0;
  const duration = task.start&&task.end?daysBetween(task.start,task.end):null;

  // Property row helper
  const PropRow = ({label, children, borderless}) => (
    <div style={{display:"flex",alignItems:"center",minHeight:38,padding:"0 16px",borderBottom:borderless?"none":`1px solid ${C.divider}`}}>
      <span style={{width:120,flexShrink:0,fontSize:12,color:C.muted,fontWeight:500}}>{label}</span>
      <div style={{flex:1,minWidth:0}}>{children}</div>
    </div>
  );

  return (
    <div style={{padding:"32px 40px",maxWidth:900}}>
      <Breadcrumb crumbs={[{label:"Overview",onClick:()=>onNavigate("dashboard")},{label:phase.name,onClick:onBack},{label:task.title}]}/>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{display:"flex",alignItems:"flex-start",gap:16,marginBottom:24}}>
        {/* Status checkbox */}
        <div onClick={()=>{const ns=task.status==="complete"?"todo":"complete";onUpdateTask(task.id,t=>({...t,status:ns}));sbPatch("tasks",task.id,{status:ns}).catch(console.error);}}
          style={{width:24,height:24,borderRadius:6,flexShrink:0,marginTop:4,cursor:"pointer",border:`2px solid ${task.status==="complete"?C.green:C.faint}`,background:task.status==="complete"?C.green:"transparent",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.15s"}}>
          {task.status==="complete"&&<svg width="12" height="12" viewBox="0 0 8 8" fill="none"><path d="M1.5 4L3.5 6L6.5 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
        </div>
        <div style={{flex:1,minWidth:0}}>
          {editingTitle
            ? <input ref={titleRef} defaultValue={task.title} autoFocus
                onBlur={e=>{const v=e.target.value.trim();if(v&&v!==task.title){onUpdateTask(task.id,t=>({...t,title:v}));sbPatch("tasks",task.id,{title:v}).catch(console.error);}setEditingTitle(false);}}
                onKeyDown={e=>{if(e.key==="Enter")e.target.blur();if(e.key==="Escape")setEditingTitle(false);}}
                style={{fontSize:24,fontWeight:700,color:C.text,letterSpacing:"-0.3px",border:"none",outline:"none",background:"transparent",fontFamily:"inherit",width:"100%",padding:0,margin:0}}/>
            : <h1 onClick={()=>setEditingTitle(true)} style={{fontSize:24,fontWeight:700,color:task.status==="complete"?C.muted:C.text,letterSpacing:"-0.3px",cursor:"text",textDecoration:task.status==="complete"?"line-through":"none"}}>{task.title}</h1>
          }
          <div style={{display:"flex",alignItems:"center",gap:8,marginTop:6,flexWrap:"wrap"}}>
            <Chip status={task.status}/>
            <span onClick={onBack} style={{display:"flex",alignItems:"center",gap:5,fontSize:12,color:C.muted,cursor:"pointer"}}>
              <div style={{width:6,height:6,borderRadius:2,background:pc(phase.id)}}/>{phase.name}
            </span>
            {task.assignee&&<span style={{display:"flex",alignItems:"center",gap:5,fontSize:12,color:C.muted}}><Avatar name={task.assignee} size={16}/>{task.assignee}</span>}
            {duration!==null&&<span style={{fontSize:12,color:C.faint}}>{duration} days</span>}
          </div>
        </div>
        {/* Actions */}
        <div style={{display:"flex",gap:6,flexShrink:0,alignItems:"center"}}>
          {addedToCalendar
            ? <span style={{fontSize:11,color:C.green,fontWeight:500}}>✓ On calendar</span>
            : <Btn onClick={convertToEvent}>+ Calendar</Btn>
          }
          {[{s:"todo",label:"To do"},{s:"in_progress",label:"Active"},{s:"complete",label:"Done"}].map(({s,label})=>(
            <button key={s} onClick={()=>{onUpdateTask(task.id,t=>({...t,status:s}));sbPatch("tasks",task.id,{status:s}).catch(console.error);}} style={{padding:"5px 12px",fontSize:11,fontWeight:500,borderRadius:5,cursor:"pointer",border:`1px solid ${task.status===s?C.accent:C.border}`,background:task.status===s?C.accentBg:C.surface,color:task.status===s?C.accent:C.muted}}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab nav ─────────────────────────────────────────────────────── */}
      <div style={{display:"flex",gap:0,borderBottom:`1px solid ${C.border}`,marginBottom:20}}>
        {[{id:"detail",label:"Detail"},{id:"quotes",label:"Quotes"+(taskQuote?" ✓":"")}].map(t=>(
          <button key={t.id} onClick={()=>setTaskTab(t.id)} style={{
            padding:"8px 16px",fontSize:13,fontWeight:taskTab===t.id?600:400,
            color:taskTab===t.id?C.text:C.muted,background:"none",border:"none",
            borderBottom:taskTab===t.id?`2px solid ${C.text}`:"2px solid transparent",
            cursor:"pointer",marginBottom:-1,
          }}>{t.label}</button>
        ))}
      </div>

      {taskTab==="detail"&&<>
      <div style={{display:"grid",gridTemplateColumns:"1fr 280px",gap:20}}>
        {/* ── Main column ───────────────────────────────────────────── */}
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          {/* Budget card */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:1,border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden",background:C.border}}>
            <div style={{background:C.surface,padding:"14px 16px"}}>
              <p style={{fontSize:10,color:C.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Estimated</p>
              <div style={{display:"flex",alignItems:"baseline",gap:4}}>
                <span style={{fontSize:11,color:C.muted}}>$</span>
                <input type="text" defaultValue={fmtN(task.price)} placeholder="0.00"
                  onFocus={e=>{e.target.value=task.price||"";e.target.select();}}
                  onBlur={e=>{const v=parseMoney(e.target.value);e.target.value=fmtN(v);onUpdateTask(task.id,t=>({...t,price:v}));sbPatch("tasks",task.id,{price:v}).catch(console.error);}}
                  style={{fontSize:18,fontWeight:600,color:C.text,border:"none",background:"transparent",fontFamily:"inherit",outline:"none",padding:0,width:"100%",fontVariantNumeric:"tabular-nums"}}/>
              </div>
              {(subEstTotal+matEstTotal)>0&&<p style={{fontSize:10,color:C.faint,marginTop:6,lineHeight:1.5,fontVariantNumeric:"tabular-nums"}}>
                {[task.price>0&&fmtM(task.price),subEstTotal>0&&fmtM(subEstTotal)+" sub",matEstTotal>0&&fmtM(matEstTotal)+" mat"].filter(Boolean).join(" + ")} = <span style={{fontWeight:600,color:C.text}}>{fmtM(totalEst)}</span>
              </p>}
            </div>
            <div style={{background:C.surface,padding:"14px 16px"}}>
              <p style={{fontSize:10,color:C.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Actual</p>
              <div style={{display:"flex",alignItems:"baseline",gap:4}}>
                <span style={{fontSize:11,color:C.muted}}>$</span>
                <input type="text" defaultValue={fmtN(task.actual_cost)} placeholder="0.00"
                  onFocus={e=>{e.target.value=task.actual_cost||"";e.target.select();}}
                  onBlur={e=>{const v=parseMoney(e.target.value)||null;e.target.value=v?fmtN(v):"";onUpdateTask(task.id,t=>({...t,actual_cost:v}));sbPatch("tasks",task.id,{actual_cost:v||null}).catch(console.error);}}
                  style={{fontSize:18,fontWeight:600,color:(task.actual_cost>0)?C.text:C.faint,border:"none",background:"transparent",fontFamily:"inherit",outline:"none",padding:0,width:"100%",fontVariantNumeric:"tabular-nums"}}/>
              </div>
              {(subActTotal+matActTotal)>0&&<p style={{fontSize:10,color:C.faint,marginTop:6,lineHeight:1.5,fontVariantNumeric:"tabular-nums"}}>
                {[task.actual_cost>0&&fmtM(task.actual_cost),subActTotal>0&&fmtM(subActTotal)+" sub",matActTotal>0&&fmtM(matActTotal)+" mat"].filter(Boolean).join(" + ")} = <span style={{fontWeight:600,color:C.text}}>{fmtM(totalAct)}</span>
              </p>}
            </div>
            <div style={{background:C.surface,padding:"14px 16px"}}>
              <p style={{fontSize:10,color:C.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Variance</p>
              <p style={{fontSize:18,fontWeight:600,fontVariantNumeric:"tabular-nums",color:hasActual?(variance>=0?C.green:"#C0392B"):C.faint}}>
                {hasActual?(variance>=0?"+":"")+fmtM(variance):"—"}
              </p>
              {hasActual&&<p style={{fontSize:10,color:variance>=0?C.green:"#C0392B",fontWeight:500,marginTop:2}}>{variance>=0?"Under budget":"Over budget"}</p>}
            </div>
          </div>

          {/* Subtasks */}
          <SubtaskPanel taskId={task.id} projectId={task.project_id} tasks={tasks||[]} onUpdateTask={onUpdateTask} onAddTask={onAddTask}/>

          {/* Materials */}
          <div style={{border:`1px solid ${C.border}`,borderRadius:8,background:C.surface,overflow:"hidden"}}>
            <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.divider}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <p style={{fontSize:13,fontWeight:600,color:C.text}}>Materials</p>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                {(matEstTotal>0||matActTotal>0)&&<span style={{fontSize:11,color:C.muted,fontWeight:500}}>
                  {matEstTotal>0&&<>Est {fmtM(matEstTotal)}</>}{matEstTotal>0&&matActTotal>0&&" · "}{matActTotal>0&&<>Act {fmtM(matActTotal)}</>}
                </span>}
                <button onClick={()=>onUpdateTask(task.id,t=>({...t,materials:[...(t.materials||[]),{name:"",qty:"",unit:"",cost:"",actual_cost:""}]}))}
                  style={{fontSize:12,color:C.accent,background:"none",border:"none",cursor:"pointer",padding:0,fontWeight:500}}>+ Add</button>
              </div>
            </div>
            {(task.materials||[]).length>0&&(
              <div style={{display:"flex",alignItems:"center",gap:6,padding:"6px 16px",borderBottom:`1px solid ${C.divider}`,background:C.bg}}>
                <span style={{flex:1,fontSize:10,color:C.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.04em"}}>Item</span>
                <span style={{width:56,fontSize:10,color:C.muted,fontWeight:600,textAlign:"center",textTransform:"uppercase",letterSpacing:"0.04em"}}>Qty</span>
                <span style={{width:56,fontSize:10,color:C.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.04em"}}>Unit</span>
                <span style={{width:78,fontSize:10,color:C.muted,fontWeight:600,textAlign:"right",textTransform:"uppercase",letterSpacing:"0.04em"}}>Est.</span>
                <span style={{width:78,fontSize:10,color:C.muted,fontWeight:600,textAlign:"right",textTransform:"uppercase",letterSpacing:"0.04em"}}>Actual</span>
                <span style={{width:24}}/>
              </div>
            )}
            {(task.materials||[]).map((m,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:6,padding:"9px 16px",borderBottom:i<(task.materials||[]).length-1?`1px solid ${C.divider}`:"none"}}
                onMouseEnter={e=>e.currentTarget.style.background=C.hover} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <input value={m.name||""} placeholder="Item" onChange={e=>{const mats=[...(task.materials||[])];mats[i]={...mats[i],name:e.target.value};onUpdateTask(task.id,t=>({...t,materials:mats}));}}
                  onBlur={()=>sbPatch("tasks",task.id,{materials:task.materials||[]}).catch(console.error)}
                  style={{flex:1,fontSize:13,color:C.text,border:"none",background:"transparent",fontFamily:"inherit",outline:"none",padding:0,minWidth:0}}/>
                <input value={m.qty||""} placeholder="—" type="number" onChange={e=>{const mats=[...(task.materials||[])];mats[i]={...mats[i],qty:e.target.value};onUpdateTask(task.id,t=>({...t,materials:mats}));}}
                  onBlur={()=>sbPatch("tasks",task.id,{materials:task.materials||[]}).catch(console.error)}
                  style={{width:56,fontSize:12,color:C.text,border:"none",background:"transparent",fontFamily:"inherit",outline:"none",textAlign:"center",padding:0}}/>
                <input value={m.unit||""} placeholder="—" onChange={e=>{const mats=[...(task.materials||[])];mats[i]={...mats[i],unit:e.target.value};onUpdateTask(task.id,t=>({...t,materials:mats}));}}
                  onBlur={()=>sbPatch("tasks",task.id,{materials:task.materials||[]}).catch(console.error)}
                  style={{width:56,fontSize:12,color:C.text,border:"none",background:"transparent",fontFamily:"inherit",outline:"none",padding:0}}/>
                <div style={{width:78,display:"flex",alignItems:"center",justifyContent:"flex-end",gap:2,flexShrink:0}}>
                  <span style={{fontSize:11,color:C.muted}}>$</span>
                  <input type="text" defaultValue={fmtN(parseFloat(m.cost)||0)} placeholder="0.00"
                    onFocus={e=>{e.target.value=m.cost||"";e.target.select();}}
                    onBlur={e=>{const v=parseMoney(e.target.value);e.target.value=fmtN(v);const mats=[...(task.materials||[])];mats[i]={...mats[i],cost:String(v)};onUpdateTask(task.id,t=>({...t,materials:mats}));sbPatch("tasks",task.id,{materials:mats}).catch(console.error);}}
                    style={{width:52,fontSize:12,color:C.text,border:"none",background:"transparent",fontFamily:"inherit",outline:"none",padding:0,textAlign:"right",fontVariantNumeric:"tabular-nums"}}/>
                </div>
                <div style={{width:78,display:"flex",alignItems:"center",justifyContent:"flex-end",gap:2,flexShrink:0}}>
                  <span style={{fontSize:11,color:C.muted}}>$</span>
                  <input type="text" defaultValue={fmtN(parseFloat(m.actual_cost)||0)} placeholder="0.00"
                    onFocus={e=>{e.target.value=m.actual_cost||"";e.target.select();}}
                    onBlur={e=>{const v=parseMoney(e.target.value);e.target.value=fmtN(v);const mats=[...(task.materials||[])];mats[i]={...mats[i],actual_cost:String(v)};onUpdateTask(task.id,t=>({...t,materials:mats}));sbPatch("tasks",task.id,{materials:mats}).catch(console.error);}}
                    style={{width:52,fontSize:12,color:C.text,border:"none",background:"transparent",fontFamily:"inherit",outline:"none",padding:0,textAlign:"right",fontVariantNumeric:"tabular-nums"}}/>
                </div>
                <button onClick={()=>{const mats=[...(task.materials||[])];mats.splice(i,1);onUpdateTask(task.id,t=>({...t,materials:mats}));sbPatch("tasks",task.id,{materials:mats}).catch(console.error);}}
                  style={{background:"none",border:"none",cursor:"pointer",fontSize:16,color:C.faint,padding:"2px 4px",lineHeight:1,width:24,textAlign:"center"}}>×</button>
              </div>
            ))}
            {(task.materials||[]).length===0&&<p style={{padding:"12px 16px",fontSize:12,color:C.faint}}>No materials yet.</p>}
          </div>

          {/* Notes */}
          <div style={{border:`1px solid ${C.border}`,borderRadius:8,background:C.surface,overflow:"hidden"}}>
            <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.divider}`}}><p style={{fontSize:13,fontWeight:600,color:C.text}}>Notes</p></div>
            <div style={{padding:"12px 16px"}}>
              <NoteField value={task.notes||""} onChange={v=>{onUpdateTask(task.id,t=>({...t,notes:v}));}} onBlur={()=>{sbPatch("tasks",task.id,{notes:task.notes||""}).catch(console.error);}} placeholder="Add task notes..." rows={5}/>
            </div>
          </div>

          {/* Photos */}
          <div style={{border:`1px solid ${C.border}`,borderRadius:8,background:C.surface}}>
            <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.divider}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <p style={{fontSize:13,fontWeight:600,color:C.text}}>Photos</p>
                <span style={{fontSize:11,color:C.faint}}>rolls up to project</span>
              </div>
            </div>
            <div style={{padding:"12px 16px"}}>
              <PhotoGrid photos={task.photos} onAdd={p=>onUpdateTask(task.id,t=>({...t,photos:[...(t.photos||[]),p]}))} onRemove={id=>onUpdateTask(task.id,t=>({...t,photos:(t.photos||[]).filter(p=>p.id!==id)}))}/>
            </div>
          </div>
        </div>

        {/* ── Sidebar ───────────────────────────────────────────────── */}
        <div>
          <div style={{border:`1px solid ${C.border}`,borderRadius:8,background:C.surface,overflow:"hidden",position:"sticky",top:20}}>
            <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`,background:C.bg}}>
              <p style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:"uppercase",letterSpacing:"0.06em"}}>Properties</p>
            </div>
            <PropRow label="Project">
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <div style={{width:7,height:7,borderRadius:2,background:pc(phase.id),flexShrink:0}}/>
                <span onClick={onBack} style={{fontSize:13,color:C.accent,cursor:"pointer",fontWeight:500}}>{phase.name}</span>
              </div>
            </PropRow>
            <PropRow label="Assignee">
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                {task.assignee&&<Avatar name={task.assignee} size={20}/>}
                <select value={task.assignee||""} onChange={e=>{const v=e.target.value;onUpdateTask(task.id,t=>({...t,assignee:v}));sbPatch("tasks",task.id,{assignee:v}).catch(console.error);}}
                  style={{fontSize:13,color:C.text,border:"none",background:"transparent",fontFamily:"inherit",outline:"none",cursor:"pointer",padding:0,flex:1}}>
                  <option value="">Unassigned</option>
                  {(team||[]).map(m=><option key={m.id} value={m.name}>{m.name}</option>)}
                </select>
              </div>
            </PropRow>
            <PropRow label="Status">
              <select value={task.status} onChange={e=>{const v=e.target.value;onUpdateTask(task.id,t=>({...t,status:v}));sbPatch("tasks",task.id,{status:v}).catch(console.error);}}
                style={{fontSize:13,color:C.text,border:"none",background:"transparent",fontFamily:"inherit",outline:"none",cursor:"pointer",padding:0,width:"100%"}}>
                <option value="todo">To do</option>
                <option value="in_progress">In progress</option>
                <option value="complete">Complete</option>
              </select>
            </PropRow>
            <PropRow label="Start">
              <input type="date" value={task.start||""} onChange={e=>{
                const v=e.target.value;
                onUpdateTask(task.id,t=>({...t,start:v}));
                sbPatch("tasks",task.id,{start_date:v}).catch(console.error);
              }} style={{fontSize:13,color:C.text,border:"none",background:"transparent",fontFamily:"inherit",cursor:"pointer",outline:"none",padding:0,width:"100%"}}/>
            </PropRow>
            <PropRow label="End">
              <input type="date" value={task.end||""} onChange={e=>{
                const v=e.target.value||null;
                onUpdateTask(task.id,t=>({...t,end:v||""}));
                sbPatch("tasks",task.id,{end_date:v}).catch(console.error);
              }} style={{fontSize:13,color:C.text,border:"none",background:"transparent",fontFamily:"inherit",cursor:"pointer",outline:"none",padding:0,width:"100%"}}/>
            </PropRow>
            <PropRow label="Duration" borderless>
              <span style={{fontSize:13,color:C.text}}>{duration!==null?duration+" days":"—"}</span>
            </PropRow>

            {/* Quick budget summary in sidebar */}
            {(totalEst>0||hasActual)&&<>
              <div style={{borderTop:`1px solid ${C.border}`,padding:"12px 16px",background:C.bg}}>
                <p style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:"uppercase",letterSpacing:"0.06em"}}>Budget</p>
              </div>
              <PropRow label="Estimated">
                <span style={{fontSize:13,color:C.text,fontVariantNumeric:"tabular-nums",fontWeight:500}}>{totalEst>0?fmtM(totalEst):"—"}</span>
              </PropRow>
              <PropRow label="Actual">
                <span style={{fontSize:13,color:hasActual?C.text:C.faint,fontVariantNumeric:"tabular-nums",fontWeight:500}}>{hasActual?fmtM(totalAct):"—"}</span>
              </PropRow>
              {hasActual&&<PropRow label="Variance" borderless>
                <span style={{fontSize:13,fontWeight:600,fontVariantNumeric:"tabular-nums",color:variance>=0?C.green:"#C0392B"}}>{(variance>=0?"+":"")+fmtM(variance)}</span>
              </PropRow>}
            </>}
          </div>
        </div>
      </div>
      </>}

      {taskTab==="quotes"&&(
        <div style={{border:`1px solid ${C.border}`,borderRadius:8,background:C.surface,padding:20}}>
          {taskQuote ? (
            <QuoteComparison
              quote={taskQuote}
              phaseName={task.title}
              onUpdate={fn=>onUpdateQuote(taskQuote.id,fn)}
              onAward={total=>{
                if(total!==null){
                  onUpdateTask(task.id,t=>({...t,price:total}));
                  sbPatch("tasks",task.id,{price:total}).catch(console.error);
                }
              }}
            />
          ) : (
            <div style={{textAlign:"center",padding:"48px 0",color:C.muted}}>
              <p style={{fontSize:13,marginBottom:4}}>No quote comparison for this task.</p>
              <p style={{fontSize:12,color:C.faint,marginBottom:16}}>Compare bids from multiple contractors side by side.</p>
              <Btn variant="primary" onClick={()=>{
                const newQ={id:uid(),project_id:task.project_id,task_id:task.id,awarded_to:null,notes:"",
                  contractors:[{id:uid(),name:"Contractor 1",phone:"",email:"",sort_order:0}],
                  items:[{id:uid(),label:"Labor",amounts:{}},{id:uid(),label:"Materials",amounts:{}}]};
                onUpdateQuote(null,null,newQ);
              }}>+ Add quote comparison</Btn>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── AI PANEL ───────────────────────────────────────────────────────────────
const AI_MODES = [
  {id:"generate", label:"Generate tasks",    icon:"✦"},
  {id:"audit",    label:"Audit & conflicts", icon:"⚑"},
  {id:"prices",   label:"Price lookup",      icon:"$"},
];

const SYS_GENERATE = [
  "You are a construction project manager for a New Orleans home remodel.",
  "Return ONLY a JSON array of task objects, no prose, no markdown fences.",
  'Each task: {"title":"...","assignee":"...","start":"YYYY-MM-DD","end":"YYYY-MM-DD","status":"todo","notes":"..."}',
  "Assignee: one of Eliot, Elysha, GC, or a trade contractor name.",
].join("\n");

const SYS_AUDIT = [
  "You are a construction project manager reviewing a remodel schedule.",
  "Return ONLY a JSON array of findings, no prose, no markdown fences.",
  'Each finding: {"type":"conflict","title":"...","detail":"..."} — type is one of: conflict, missing, warning, tip',
  "Be specific and actionable.",
].join("\n");

const SYS_PRICES = [
  "You are a construction cost estimator for New Orleans, Louisiana.",
  "Search for current market prices for the requested materials or components.",
  "Return ONLY a JSON array, no prose, no markdown fences.",
  '{"label":"...","low":number,"high":number,"unit":"...","notes":"...","category":"Labor or Materials or Equipment"}',
  "Prices in USD. Be specific to the New Orleans market where relevant.",
].join("\n");

const callClaude = (messages, systemPrompt, useSearch) => {
  const body = {
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    system: systemPrompt,
    messages,
  };
  if(useSearch) body.tools = [{type:"web_search_20250305", name:"web_search"}];
  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify(body),
  })
  .then(r => r.json())
  .then(data => {
    return data.content.filter(b => b.type==="text").map(b => b.text).join("\n");
  });
};

const stripFences = s => s.replace(/[\x60]{3}json|[\x60]{3}/g,"").trim();

function AIPanel({phase, projects, tasks, onAddTasks, onAddBudgetItems, compact}) {
  const [mode, setMode]           = useState("generate");
  const [input, setInput]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [result, setResult]       = useState(null);
  const [error, setError]         = useState("");
  const [selPhaseId, setSelPhaseId] = useState(phase ? phase.id : (projects[0] ? projects[0].id : null));

  const activePhase = phase || projects.find(p => p.id === Number(selPhaseId));
  const projectTasks  = tasks.filter(t => activePhase && t.project_id === activePhase.id);

  const reset = () => { setResult(null); setError(""); setInput(""); };

  const runGenerate = () => {
    if(!input.trim() || !activePhase) return;
    setLoading(true); setError(""); setResult(null);
    const sys = SYS_GENERATE + "\nToday is " + TODAY + ". Phase runs " + activePhase.start + " to " + activePhase.end + ".";
    const userMsg = "Phase: " + activePhase.name + "\nScope: " + input + "\nExisting tasks: " + (projectTasks.map(t=>t.title).join(", ")||"none") + "\nGenerate a task breakdown.";
    callClaude([{role:"user", content:userMsg}], sys)
      .then(text => {
        const arr = JSON.parse(stripFences(text));
        setResult({type:"tasks", data: arr.map((t,i) => ({...t, id:Date.now()+i, project_id:activePhase.id, photos:[], _selected:true}))});
        setLoading(false);
      })
      .catch(() => { setError("Couldn't parse AI response. Try rephrasing the scope."); setLoading(false); });
  };

  const runAudit = () => {
    if(!activePhase) return;
    setLoading(true); setError(""); setResult(null);
    const taskLines = projectTasks.map(t => "- " + t.title + " (" + t.start + " to " + t.end + ", " + t.assignee + ", " + t.status + ")").join("\n");
    const userMsg = "Project: 4602 Banks St, New Orleans\nPhase: " + activePhase.name + "\nDates: " + activePhase.start + " to " + activePhase.end + "\nBudget: $" + (activePhase.budget||0).toLocaleString() + "\nTasks:\n" + (taskLines||"No tasks yet.") + "\nAudit for conflicts, missing steps, and scheduling issues. Today is " + TODAY + ".";
    callClaude([{role:"user", content:userMsg}], SYS_AUDIT)
      .then(text => {
        const arr = JSON.parse(stripFences(text));
        setResult({type:"audit", data:arr});
        setLoading(false);
      })
      .catch(() => { setError("Couldn't parse AI response. Please try again."); setLoading(false); });
  };

  const runPrices = () => {
    if(!input.trim() || !activePhase) return;
    setLoading(true); setError(""); setResult(null);
    const userMsg = "Phase: " + activePhase.name + "\nLookup current New Orleans market prices for: " + input;
    callClaude([{role:"user", content:userMsg}], SYS_PRICES, true)
      .then(text => {
        const arr = JSON.parse(stripFences(text));
        setResult({type:"prices", data: arr.map(item => ({...item, _selected:true}))});
        setLoading(false);
      })
      .catch(() => { setError("Price lookup failed. Try a more specific description."); setLoading(false); });
  };

  const run = () => { if(mode==="generate") runGenerate(); else if(mode==="audit") runAudit(); else runPrices(); };

  const toggleItem = i => setResult(r => ({...r, data: r.data.map((d,j) => j===i ? {...d, _selected:!d._selected} : d)}));

  const addSelected = () => {
    if(result && result.type==="tasks") {
      onAddTasks(result.data.filter(t=>t._selected).map(({_selected,...t})=>t));
      reset();
    } else if(result && result.type==="prices") {
      onAddBudgetItems(result.data.filter(t=>t._selected), activePhase.id);
      reset();
    }
  };

  const AUDIT_COLORS = {conflict:"#9E3C3C", missing:"#7A5500", warning:"#5A4A9A", tip:C.green};
  const AUDIT_BG     = {conflict:"#FDF1F1", missing:"#FDF8ED", warning:"#F4F1FD", tip:C.greenBg};
  const placeholders = {
    generate:"Describe the scope — e.g. \"Full kitchen demo and rebuild: new cabinets, quartz counters, tile backsplash, induction range hookup\"",
    audit:"",
    prices:"Describe materials — e.g. \"Zellige tile 80 sq ft, Carrier 3-ton mini-split, 10 sheets drywall\"",
  };

  return (
    <div style={{background:C.surface, border:"1px solid "+C.border, borderRadius:8, overflow:"hidden"}}>
      <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>

      {/* Mode tabs */}
      <div style={{display:"flex", borderBottom:"1px solid "+C.border, background:C.bg}}>
        {AI_MODES.map(m=>(
          <button key={m.id} onClick={()=>{setMode(m.id);reset();}} style={{
            flex:1, padding:"10px 6px", fontSize:12, fontWeight:mode===m.id?600:400,
            color:mode===m.id?C.text:C.muted, background:"transparent", border:"none",
            borderBottom:"2px solid "+(mode===m.id?C.accent:"transparent"),
            cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:5,
          }}>
            <span style={{fontSize:13}}>{m.icon}</span>{m.label}
          </button>
        ))}
      </div>

      <div style={{padding:16}}>
        {/* Phase selector — global panel only */}
        {!phase&&(
          <div style={{marginBottom:12}}>
            <select value={selPhaseId||""} onChange={e=>setSelPhaseId(Number(e.target.value))}
              style={{width:"100%", border:"1px solid "+C.border, borderRadius:5, padding:"7px 10px", fontSize:13, color:C.text, background:C.bg, cursor:"pointer"}}>
              {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}

        {/* Input */}
        {mode!=="audit"&&(
          <textarea value={input} onChange={e=>setInput(e.target.value)}
            placeholder={placeholders[mode]} rows={compact?3:4}
            style={{width:"100%", border:"1px solid "+C.border, borderRadius:6, padding:"9px 12px", fontSize:13, color:C.text, background:C.bg, fontFamily:"inherit", lineHeight:1.5, outline:"none", resize:"vertical", boxSizing:"border-box", marginBottom:10}}
            onFocus={e=>{e.target.style.borderColor=C.accent;}} onBlur={e=>{e.target.style.borderColor=C.border;}}
            onKeyDown={e=>{if(e.key==="Enter"&&(e.metaKey||e.ctrlKey)){e.preventDefault();run();}}}
          />
        )}
        {mode==="audit"&&!result&&!loading&&(
          <p style={{fontSize:13, color:C.muted, marginBottom:10, lineHeight:1.5}}>
            AI will review <strong style={{color:C.text}}>{projectTasks.length} task{projectTasks.length!==1?"s":""}</strong> in <strong style={{color:C.text}}>{activePhase ? activePhase.name : "—"}</strong> and flag conflicts, missing steps, and scheduling issues.
          </p>
        )}

        {/* Run button */}
        {!result&&(
          <button onClick={run} disabled={loading||(mode!=="audit"&&!input.trim())}
            style={{width:"100%", padding:"8px", background:loading?C.bg:C.accent, color:loading?C.muted:"white", border:"1px solid "+(loading?C.border:C.accent), borderRadius:6, fontSize:13, fontWeight:600, cursor:loading?"default":"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8}}>
            {loading
              ? <span style={{display:"inline-flex",alignItems:"center",gap:8}}><span style={{display:"inline-block",width:12,height:12,border:"2px solid "+C.faint,borderTopColor:C.accent,borderRadius:"50%",animation:"spin 0.7s linear infinite"}}/> Thinking...</span>
              : {generate:"Generate tasks",audit:"Audit this phase",prices:"Look up prices"}[mode]
            }
          </button>
        )}

        {error&&<p style={{fontSize:12, color:"#9E3C3C", marginTop:8}}>{error}</p>}

        {/* Task results */}
        {result&&result.type==="tasks"&&(
          <div style={{marginTop:12}}>
            <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10}}>
              <p style={{fontSize:13, fontWeight:600, color:C.text}}>{result.data.length} tasks generated</p>
              <div style={{display:"flex", gap:6}}>
                <Btn onClick={reset}>Clear</Btn>
                <Btn variant="primary" onClick={addSelected}>+ Add {result.data.filter(t=>t._selected).length} to phase</Btn>
              </div>
            </div>
            <div style={{border:"1px solid "+C.border, borderRadius:6, overflow:"hidden"}}>
              {result.data.map((t,i)=>(
                <div key={i} onClick={()=>toggleItem(i)} style={{display:"flex", alignItems:"flex-start", gap:10, padding:"9px 12px", borderBottom:i<result.data.length-1?"1px solid "+C.divider:"none", cursor:"pointer", background:t._selected?"transparent":C.bg}}
                  onMouseEnter={e=>e.currentTarget.style.background=C.hover}
                  onMouseLeave={e=>e.currentTarget.style.background=t._selected?"transparent":C.bg}
                >
                  <div style={{width:14, height:14, borderRadius:3, flexShrink:0, marginTop:1, border:"1.5px solid "+(t._selected?C.accent:C.faint), background:t._selected?C.accent:"transparent", display:"flex", alignItems:"center", justifyContent:"center"}}>
                    {t._selected&&<svg width="7" height="7" viewBox="0 0 8 8" fill="none"><path d="M1.5 4L3.5 6L6.5 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </div>
                  <div style={{flex:1, minWidth:0}}>
                    <p style={{fontSize:13, color:C.text, fontWeight:500, marginBottom:2}}>{t.title}</p>
                    <div style={{display:"flex", gap:10, flexWrap:"wrap"}}>
                      <span style={{fontSize:11, color:C.muted}}>{fmtD(t.start)} → {fmtD(t.end)}</span>
                      {t.assignee&&<span style={{fontSize:11, color:C.muted}}>· {t.assignee}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Audit results */}
        {result&&result.type==="audit"&&(
          <div style={{marginTop:12}}>
            <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10}}>
              <p style={{fontSize:13, fontWeight:600, color:C.text}}>{result.data.length} finding{result.data.length!==1?"s":""}</p>
              <Btn onClick={reset}>Clear</Btn>
            </div>
            <div style={{display:"flex", flexDirection:"column", gap:8}}>
              {result.data.map((f,i)=>{
                const col=AUDIT_COLORS[f.type]||C.muted, bg=AUDIT_BG[f.type]||C.bg;
                return (
                  <div key={i} style={{background:bg, border:"1px solid "+col+"22", borderRadius:6, padding:"10px 12px"}}>
                    <div style={{display:"flex", alignItems:"center", gap:7, marginBottom:4}}>
                      <span style={{fontSize:10, fontWeight:700, color:col, textTransform:"uppercase", letterSpacing:"0.06em"}}>{f.type}</span>
                      <p style={{fontSize:13, fontWeight:600, color:C.text}}>{f.title}</p>
                    </div>
                    <p style={{fontSize:12, color:C.muted, lineHeight:1.5}}>{f.detail}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Price results */}
        {result&&result.type==="prices"&&(
          <div style={{marginTop:12}}>
            <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10}}>
              <p style={{fontSize:13, fontWeight:600, color:C.text}}>{result.data.length} item{result.data.length!==1?"s":""} found</p>
              <div style={{display:"flex", gap:6}}>
                <Btn onClick={reset}>Clear</Btn>
                <Btn variant="primary" onClick={addSelected}>+ Add {result.data.filter(t=>t._selected).length} to budget</Btn>
              </div>
            </div>
            <div style={{border:"1px solid "+C.border, borderRadius:6, overflow:"hidden"}}>
              {result.data.map((item,i)=>(
                <div key={i} onClick={()=>toggleItem(i)} style={{display:"flex", alignItems:"center", gap:10, padding:"9px 12px", borderBottom:i<result.data.length-1?"1px solid "+C.divider:"none", cursor:"pointer", background:item._selected?"transparent":C.bg}}
                  onMouseEnter={e=>e.currentTarget.style.background=C.hover}
                  onMouseLeave={e=>e.currentTarget.style.background=item._selected?"transparent":C.bg}
                >
                  <div style={{width:14, height:14, borderRadius:3, flexShrink:0, border:"1.5px solid "+(item._selected?C.accent:C.faint), background:item._selected?C.accent:"transparent", display:"flex", alignItems:"center", justifyContent:"center"}}>
                    {item._selected&&<svg width="7" height="7" viewBox="0 0 8 8" fill="none"><path d="M1.5 4L3.5 6L6.5 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </div>
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{display:"flex", alignItems:"baseline", gap:8, marginBottom:2}}>
                      <p style={{fontSize:13, color:C.text, fontWeight:500}}>{item.label}</p>
                      <span style={{fontSize:11, color:C.muted}}>{item.category}</span>
                    </div>
                    <div style={{display:"flex", gap:10, alignItems:"center"}}>
                      <span style={{fontSize:13, color:C.green, fontWeight:600, fontVariantNumeric:"tabular-nums"}}>{fmtM(item.low)} – {fmtM(item.high)}</span>
                      <span style={{fontSize:11, color:C.muted}}>per {item.unit}</span>
                      {item.notes&&<span style={{fontSize:11, color:C.faint, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1}}>{item.notes}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p style={{fontSize:11, color:C.faint, marginTop:8}}>Estimates from current market data. Verify with suppliers before budgeting.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── PHASE DETAIL ───────────────────────────────────────────────────────────
function ProjectPage({project,tasks,expenses,quotes,phases,initialTaskId,onNavigate,onUpdateProject,onUpdateTask,onUpdateQuote,onAddTasks,onAddBudgetItems,onDeleteProject,onAddEvent,team}) {
  const phase = project; // alias for minimal churn
  const [tab,setTab]=useState("tasks");
  const [activeTaskId,setActiveTaskId]=useState(initialTaskId||null);
  const [editing,setEditing]=useState(false);
  const [addingTask,setAddingTask]=useState(false);
  const projectTaskRef=useRef(null);
  const [editForm,setEditForm]=useState({name:phase.name,status:phase.status,target_budget:phase.target_budget||phase.budget||0,contingency:phase.contingency||0,start:phase.start,end:phase.end,notes:phase.notes||"",datesMode:phase.datesMode||"manual",phase_id:phase.phase_id||""});
  const [confirmDelete,setConfirmDelete]=useState(false);
  useEffect(()=>{ if(addingTask && projectTaskRef.current) projectTaskRef.current.focus(); },[addingTask]);
  const projectTasks=tasks.filter(t=>t.project_id===phase.id);
  const taskDerivedDates = useMemo(()=>{
    const ts=projectTasks.filter(t=>t.start&&t.end);
    if(!ts.length) return {start:"",end:""};
    return {
      start: ts.reduce((min,t)=>t.start<min?t.start:min, ts[0].start),
      end:   ts.reduce((max,t)=>t.end>max?t.end:max,     ts[0].end),
    };
  },[projectTasks]);
  const spent=expenses.filter(e=>e.project_id===phase.id).reduce((s,e)=>s+e.amount,0);
  const projectQuote=quotes.find(q=>q.project_id===phase.id);

  if(activeTaskId){
    const t=tasks.find(x=>x.id===activeTaskId);
    if(t) return <TaskPage task={t} phase={phase} tasks={tasks} quotes={quotes} onNavigate={onNavigate} onBack={()=>setActiveTaskId(null)} onUpdateTask={onUpdateTask} onAddTask={t=>onAddTasks([t])} onUpdateQuote={onUpdateQuote} onAddEvent={onAddEvent} team={team}/>;
  }

  const saveEdit = () => {
    const resolvedStart = editForm.datesMode==="tasks" ? (taskDerivedDates.start||editForm.start) : editForm.start;
    const resolvedEnd   = editForm.datesMode==="tasks" ? (taskDerivedDates.end||editForm.end)     : editForm.end;
    const updated = {...phase, ...editForm, start:resolvedStart, end:resolvedEnd, budget:parseInt(editForm.target_budget)||0, target_budget:parseInt(editForm.target_budget)||0, contingency:parseFloat(editForm.contingency)||0, phase_id:parseInt(editForm.phase_id)||null};
    onUpdateProject(phase.id, ()=>updated);
    sbPatch("projects", phase.id, {
      name:editForm.name, status:editForm.status, target_budget:parseInt(editForm.target_budget)||0, contingency:parseFloat(editForm.contingency)||0,
      start_date:resolvedStart, end_date:resolvedEnd, notes:editForm.notes,
      dates_mode:editForm.datesMode, phase_id:parseInt(editForm.phase_id)||null,
    }).catch(console.error);
    setEditing(false);
  };

  const doDelete = () => {
    onDeleteProject(phase.id);
    onNavigate("dashboard");
  };

  const quickAddTask = () => {
    const title = (projectTaskRef.current?.value||"").trim();
    if(!title) { setAddingTask(false); return; }
    const dbTask = {project_id:phase.id, title, assignee:"", start_date:null, end_date:null, status:"todo", notes:"", sort_order:0};
    if(projectTaskRef.current) projectTaskRef.current.value = "";
    setAddingTask(false);
    sbInsertRow("tasks", dbTask).then(rows=>{
      if(rows?.[0]) onAddTasks([mapTask(rows[0])]);
    }).catch(err=>alert("Failed: "+err.message));
  };

  const tabs=[{id:"tasks",label:"Tasks"},{id:"quotes",label:"Quotes"},{id:"photos",label:"Photos"},{id:"notes",label:"Notes"},{id:"ai",label:"✦ AI"}];

  return (
    <div style={{padding:"32px 40px",maxWidth:1000}}>
      <Breadcrumb crumbs={[{label:"Overview",onClick:()=>onNavigate("dashboard")},{label:phase.name}]}/>

      {/* Edit form */}
      {editing&&(
        <div style={{border:`1px solid ${C.border}`,borderRadius:8,background:C.surface,padding:20,marginBottom:20}}>
          <p style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:14}}>Edit project</p>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
            <div>
              <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Name</p>
              <Input value={editForm.name} onChange={v=>setEditForm(f=>({...f,name:v}))}/>
            </div>
            <div>
              <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Status</p>
              <select value={editForm.status} onChange={e=>setEditForm(f=>({...f,status:e.target.value}))}
                style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:5,padding:"7px 10px",fontSize:13,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none",appearance:"none"}}>
                <option value="planning">Planning</option>
                <option value="active">Active</option>
                <option value="complete">Complete</option>
                <option value="on_hold">On hold</option>
              </select>
            </div>
            <div>
              <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Phase</p>
              <select value={editForm.phase_id||""} onChange={e=>setEditForm(f=>({...f,phase_id:e.target.value}))}
                style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:5,padding:"7px 10px",fontSize:13,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none",appearance:"none"}}>
                <option value="">— No phase —</option>
                {(phases||[]).map(fa=><option key={fa.id} value={fa.id}>{fa.name}</option>)}
              </select>
            </div>
            <div style={{gridColumn:"1/-1"}}>
              <p style={{fontSize:11,color:C.muted,marginBottom:6,fontWeight:500}}>Timeline</p>
              <div style={{display:"flex",gap:6,marginBottom:editForm.datesMode==="manual"?10:0}}>
                {[{v:"manual",l:"Manual"},{v:"tasks",l:"From tasks"}].map(({v,l})=>(
                  <button key={v} onClick={()=>setEditForm(f=>({...f,datesMode:v}))}
                    style={{padding:"4px 12px",fontSize:12,fontWeight:500,borderRadius:5,cursor:"pointer",
                      border:"1px solid "+(editForm.datesMode===v?C.accent:C.border),
                      background:editForm.datesMode===v?C.accentBg:C.surface,
                      color:editForm.datesMode===v?C.accent:C.muted}}>
                    {l}
                  </button>
                ))}
              </div>
              {editForm.datesMode==="tasks"&&(
                <p style={{fontSize:12,color:C.muted,marginTop:6}}>
                  {taskDerivedDates.start
                    ? fmtD(taskDerivedDates.start)+" → "+fmtD(taskDerivedDates.end)+" (from "+projectTasks.filter(t=>t.start&&t.end).length+" tasks)"
                    : "No tasks with dates yet"}
                </p>
              )}
            </div>
            {editForm.datesMode==="manual"&&<div>
              <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Start</p>
              <input type="date" value={editForm.start||""} onChange={e=>setEditForm(f=>({...f,start:e.target.value}))}
                style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:5,padding:"7px 10px",fontSize:13,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}/>
            </div>}
            {editForm.datesMode==="manual"&&<div>
              <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>End</p>
              <input type="date" value={editForm.end||""} onChange={e=>setEditForm(f=>({...f,end:e.target.value}))}
                style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:5,padding:"7px 10px",fontSize:13,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}/>
            </div>}
            <div>
              <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Target Budget ($)</p>
              <Input value={String(editForm.target_budget||"")} onChange={v=>setEditForm(f=>({...f,target_budget:v}))} placeholder="0"/>
            </div>
          </div>
          <div style={{marginBottom:14}}>
            <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Notes</p>
            <NoteField value={editForm.notes} onChange={v=>setEditForm(f=>({...f,notes:v}))} rows={2}/>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{display:"flex",gap:8}}>
              <Btn variant="primary" onClick={saveEdit}>Save</Btn>
              <Btn onClick={()=>setEditing(false)}>Cancel</Btn>
            </div>
            {!confirmDelete
              ? <Btn variant="danger" onClick={()=>setConfirmDelete(true)}>Delete project</Btn>
              : <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:12,color:"#9E3C3C"}}>Delete project and all its tasks?</span>
                  <Btn variant="danger" onClick={doDelete}>Yes, delete</Btn>
                  <Btn onClick={()=>setConfirmDelete(false)}>Cancel</Btn>
                </div>
            }
          </div>
        </div>
      )}

      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:20}}>
        <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
          <div style={{width:10,height:10,borderRadius:2,background:pc(phase.id),marginTop:6,flexShrink:0}}/>
          <div>
            <h1 style={{fontSize:24,fontWeight:700,color:C.text,letterSpacing:"-0.3px",marginBottom:6}}>{phase.name}</h1>
            <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
              <span style={{fontSize:12,color:C.muted}}>{fmtFull(phase.start)} → {fmtFull(phase.end)}</span>
              <span style={{fontSize:12,color:C.muted}}>· {daysBetween(phase.start,phase.end)} days</span>
            </div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
          <div style={{textAlign:"right",flexShrink:0}}>
            <p style={{fontSize:11,color:C.muted,marginBottom:2}}>Budget</p>
            <p style={{fontSize:18,fontWeight:600,color:C.text,fontVariantNumeric:"tabular-nums"}}>{fmtM(phase.target_budget||phase.budget||0)}</p>
            <p style={{fontSize:12,color:C.muted}}>{fmtM(spent)} spent · {fmtM((phase.target_budget||phase.budget||0)-spent)} left</p>
          </div>
          <Btn onClick={()=>{setEditing(s=>!s);setConfirmDelete(false);setEditForm({name:phase.name,status:phase.status,target_budget:phase.target_budget||phase.budget||0,contingency:phase.contingency||0,start:phase.start,end:phase.end,notes:phase.notes||"",datesMode:phase.datesMode||"manual",phase_id:phase.phase_id||""});}}>
            {editing?"Cancel":"Edit"}
          </Btn>
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:2,borderBottom:`1px solid ${C.border}`,marginBottom:20}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"8px 14px",fontSize:13,fontWeight:tab===t.id?600:400,color:tab===t.id?C.text:C.muted,background:"transparent",border:"none",borderBottom:`2px solid ${tab===t.id?C.text:"transparent"}`,cursor:"pointer",marginBottom:-1}}>
            {t.label}
          </button>
        ))}
      </div>

      {tab==="tasks"&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 280px",gap:20}}>
          <div style={{border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden",background:C.surface}}>
            <div style={{padding:"11px 16px",borderBottom:`1px solid ${C.divider}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <p style={{fontSize:13,fontWeight:600,color:C.text}}>Tasks</p>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:11,color:C.muted}}>{projectTasks.filter(t=>t.status==="complete").length}/{projectTasks.length} done</span>
                <button onClick={()=>setAddingTask(true)} style={{fontSize:12,color:C.accent,background:"none",border:"none",cursor:"pointer",padding:0,fontWeight:500}}>+ Add task</button>
              </div>
            </div>
            {projectTasks.filter(t=>!t.parent_task_id).map((t,i)=>(
              <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 16px",borderBottom:i<projectTasks.length-1?`1px solid ${C.divider}`:"none",cursor:"pointer"}}
                onMouseEnter={e=>e.currentTarget.style.background=C.hover} onMouseLeave={e=>e.currentTarget.style.background="transparent"}
              >
                <CheckBox done={t.status==="complete"} onClick={e=>{e.stopPropagation();onUpdateTask(t.id,x=>({...x,status:x.status==="complete"?"todo":"complete"}));}}/>
                <div style={{flex:1,minWidth:0}} onClick={()=>setActiveTaskId(t.id)}>
                  <p style={{fontSize:13,color:t.status==="complete"?C.muted:C.text,textDecoration:t.status==="complete"?"line-through":"none",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</p>
                  <p style={{fontSize:11,color:C.muted,marginTop:1}}>
                    {t.start?fmtD(t.start)+" → "+(t.end?fmtD(t.end):"…"):"No date"}
                    {(()=>{const sc=tasks.filter(x=>x.parent_task_id===t.id);return sc.length>0?<span style={{marginLeft:6,color:C.faint}}>{sc.filter(x=>x.status==="complete").length}/{sc.length} subtasks</span>:null;})()}
                  </p>
                </div>
                <Avatar name={t.assignee}/>
                <Chip status={t.status}/>
                {taskTotalEst(t,tasks)>0&&<span style={{fontSize:11,color:C.muted,fontVariantNumeric:"tabular-nums"}}>{fmtM(taskTotalEst(t,tasks))}</span>}{((t.photos||[]).length>0||t.notes)&&<span style={{fontSize:11,color:C.faint}}>{(t.photos||[]).length>0?"📷":""}{t.notes?"📝":""}</span>}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke={C.faint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
            ))}
            {addingTask&&(
              <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 16px",borderTop:`1px solid ${C.divider}`}}>
                <div style={{width:15,height:15,borderRadius:3,flexShrink:0,border:"1.5px solid "+C.faint}}/>
                <input ref={projectTaskRef} defaultValue="" placeholder="Task name — Enter to save"
                  onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();quickAddTask();} if(e.key==="Escape") setAddingTask(false);}}
                  style={{flex:1,border:"none",outline:"none",background:"transparent",fontFamily:"inherit",fontSize:13,color:C.text,padding:0}}/>
                <button onMouseDown={e=>{e.preventDefault();quickAddTask();}} style={{background:"none",border:"none",cursor:"pointer",color:C.accent,fontSize:14,padding:"0 4px"}}>✓</button>
                <button onMouseDown={e=>{e.preventDefault();setAddingTask(false);}} style={{background:"none",border:"none",cursor:"pointer",color:C.faint,fontSize:14,padding:"0 4px"}}>✕</button>
              </div>
            )}
            {!addingTask&&(
              <button onClick={()=>setAddingTask(true)} style={{display:"flex",alignItems:"center",gap:8,padding:"10px 16px",background:"none",border:"none",cursor:"pointer",color:C.faint,fontSize:13,width:"100%",textAlign:"left"}}
                onMouseEnter={e=>e.currentTarget.style.color=C.muted} onMouseLeave={e=>e.currentTarget.style.color=C.faint}>
                <span style={{fontSize:15,lineHeight:1}}>+</span> Add task
              </button>
            )}
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div style={{border:`1px solid ${C.border}`,borderRadius:8,background:C.surface}}>
              <div style={{padding:"11px 16px",borderBottom:`1px solid ${C.divider}`}}><p style={{fontSize:13,fontWeight:600,color:C.text}}>Assignees</p></div>
              <div style={{padding:"12px 16px",display:"flex",flexDirection:"column",gap:10}}>
                {[...new Set(projectTasks.map(t=>t.assignee))].map(a=>{
                  const total=projectTasks.filter(t=>t.assignee===a).length;
                  const done=projectTasks.filter(t=>t.assignee===a&&t.status==="complete").length;
                  return (
                    <div key={a} style={{display:"flex",alignItems:"center",gap:10}}>
                      <Avatar name={a} size={28}/>
                      <div style={{flex:1}}>
                        <p style={{fontSize:13,color:C.text,fontWeight:500}}>{a}</p>
                        <p style={{fontSize:11,color:C.muted}}>{done}/{total} done</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{border:`1px solid ${C.border}`,borderRadius:8,background:C.surface}}>
              <div style={{padding:"11px 16px",borderBottom:`1px solid ${C.divider}`}}><p style={{fontSize:13,fontWeight:600,color:C.text}}>Budget</p></div>
              <div style={{padding:"12px 16px"}}>
                {[{l:"Target",v:fmtM(phase.target_budget||phase.budget||0)},{l:"Spent",v:fmtM(spent)},{l:"Remaining",v:fmtM((phase.target_budget||phase.budget||0)-spent)}].map(({l,v})=>(
                  <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${C.divider}`}}>
                    <span style={{fontSize:12,color:C.muted}}>{l}</span>
                    <span style={{fontSize:13,color:C.text,fontWeight:500,fontVariantNumeric:"tabular-nums"}}>{v}</span>
                  </div>
                ))}
                <div style={{marginTop:10,height:4,background:C.divider,borderRadius:2}}>
                  <div style={{height:"100%",width:`${Math.min(100,(spent/(phase.target_budget||phase.budget||1))*100)}%`,background:pc(phase.id),borderRadius:2}}/>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab==="quotes"&&(
        <div>
          {projectTasks.filter(t=>!t.parent_task_id).length===0&&(
            <div style={{border:`1px solid ${C.border}`,borderRadius:8,background:C.surface,padding:40,textAlign:"center",color:C.muted,fontSize:13}}>Add tasks first, then attach quotes to individual tasks.</div>
          )}
          {projectTasks.filter(t=>!t.parent_task_id).map(t=>{
            const tq=(quotes||[]).find(q=>q.task_id===t.id);
            return (
              <div key={t.id} style={{border:`1px solid ${C.border}`,borderRadius:8,background:C.surface,padding:20,marginBottom:12}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:tq?16:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:13,fontWeight:600,color:C.text}}>{t.title}</span>
                    {tq?.awarded_to&&(()=>{
                      const c=tq.contractors.find(x=>x.id===tq.awarded_to);
                      const total=tq.items.reduce((s,item)=>s+(item.amounts[tq.awarded_to]||0),0);
                      return c?<span style={{fontSize:11,color:C.green,background:C.greenBg,padding:"2px 8px",borderRadius:4,fontWeight:500}}>✓ Awarded {c.name} · {fmtM(total)}</span>:null;
                    })()}
                  </div>
                  {!tq&&<Btn onClick={()=>{
                    const newQ={id:uid(),project_id:phase.id,task_id:t.id,awarded_to:null,notes:"",
                      contractors:[{id:uid(),name:"Contractor 1",phone:"",email:"",sort_order:0}],
                      items:[{id:uid(),label:"Labor",amounts:{}},{id:uid(),label:"Materials",amounts:{}}]};
                    onUpdateQuote(null,null,newQ);
                  }}>+ Add quotes</Btn>}
                </div>
                {tq&&<QuoteComparison
                  quote={tq}
                  phaseName={t.title}
                  onUpdate={fn=>onUpdateQuote(tq.id,fn)}
                  onAward={total=>{
                    if(total!==null){
                      onUpdateTask(t.id,tk=>({...tk,price:total}));
                      sbPatch("tasks",t.id,{price:total}).catch(console.error);
                    }
                  }}
                />}
              </div>
            );
          })}
        </div>
      )}

      {tab==="photos"&&(
        <div style={{border:`1px solid ${C.border}`,borderRadius:8,background:C.surface,padding:20}}>
          <p style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:12}}>Phase photos</p>
          <PhotoGrid photos={phase.photos} onAdd={p=>onUpdateProject(phase.id,ph=>({...ph,photos:[...ph.photos,p]}))} onRemove={id=>onUpdateProject(phase.id,ph=>({...ph,photos:ph.photos.filter(p=>p.id!==id)}))}/>
          {projectTasks.some(t=>t.photos.length>0)&&(
            <div style={{marginTop:20,paddingTop:16,borderTop:`1px solid ${C.divider}`}}>
              <p style={{fontSize:12,color:C.muted,marginBottom:10}}>From tasks</p>
              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                {projectTasks.flatMap(t=>t.photos.map(p=>({...p,taskTitle:t.title}))).map(p=>(
                  <div key={p.id} style={{position:"relative",width:88,height:68,borderRadius:5,overflow:"hidden",border:`1px solid ${C.border}`}}>
                    <img src={p.url} alt={p.name} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                    <div style={{position:"absolute",bottom:0,left:0,right:0,background:"rgba(0,0,0,0.5)",padding:"3px 5px"}}>
                      <p style={{fontSize:9,color:"white",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.taskTitle}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab==="notes"&&(
        <div style={{border:`1px solid ${C.border}`,borderRadius:8,background:C.surface,padding:20}}>
          <NoteField value={phase.notes} onChange={v=>onUpdateProject(phase.id,ph=>({...ph,notes:v}))} placeholder="Add project notes..." rows={10}/>
        </div>
      )}

      {tab==="ai"&&(
        <AIPanel
          phase={phase}
          phases={[phase]}
          tasks={tasks}
          onAddTasks={newTasks=>{onAddTasks(newTasks);setTab("tasks");}}
          onAddBudgetItems={onAddBudgetItems}
          compact={false}
        />
      )}
    </div>
  );
}

// ── MINI CALENDAR (single date or range picker) ───────────────────────────
function MiniCal({mode,setMode,startDate,endDate,onSelect}) {
  const [viewDate,setViewDate]=useState(()=>{
    const d=startDate?new Date(startDate+"T12:00:00"):new Date();
    return {year:d.getFullYear(),month:d.getMonth()};
  });
  const {year,month}=viewDate;
  const first=new Date(year,month,1);
  const startDay=first.getDay();
  const daysInMonth=new Date(year,month+1,0).getDate();
  const weeks=[];
  let day=1-startDay;
  for(let w=0;w<6;w++){
    const row=[];
    for(let d=0;d<7;d++,day++){
      row.push(day>=1&&day<=daysInMonth?day:null);
    }
    if(row.some(d=>d!==null))weeks.push(row);
  }
  const pad=n=>String(n).padStart(2,"0");
  const toISO=(y,m,d)=>`${y}-${pad(m+1)}-${pad(d)}`;
  const isSelected=d=>{
    if(!d)return false;
    const iso=toISO(year,month,d);
    if(mode==="single") return iso===startDate;
    return iso===startDate||iso===endDate;
  };
  const isInRange=d=>{
    if(!d||mode==="single"||!startDate||!endDate)return false;
    const iso=toISO(year,month,d);
    return iso>startDate&&iso<endDate;
  };
  const isToday=d=>{
    if(!d)return false;
    return toISO(year,month,d)===TODAY;
  };
  const handleClick=d=>{
    if(!d)return;
    const iso=toISO(year,month,d);
    if(mode==="single") onSelect(iso,null);
    else {
      if(!startDate||endDate||iso<startDate) onSelect(iso,null);
      else onSelect(startDate,iso);
    }
  };
  const prevMonth=()=>setViewDate(v=>v.month===0?{year:v.year-1,month:11}:{...v,month:v.month-1});
  const nextMonth=()=>setViewDate(v=>v.month===11?{year:v.year+1,month:0}:{...v,month:v.month+1});
  const monthLabel=new Date(year,month).toLocaleDateString("en-US",{month:"long",year:"numeric"});

  return (
    <div>
      {/* Mode radio */}
      <div style={{display:"flex",gap:12,marginBottom:10}}>
        {[{v:"single",l:"Single date"},{v:"range",l:"Date range"}].map(o=>(
          <label key={o.v} style={{display:"flex",alignItems:"center",gap:5,fontSize:12,color:C.text,cursor:"pointer"}}>
            <input type="radio" name="calMode" checked={mode===o.v} onChange={()=>{setMode(o.v);if(o.v==="single")onSelect(startDate,null);}}
              style={{accentColor:C.accent,margin:0}}/>
            {o.l}
          </label>
        ))}
      </div>
      {/* Month nav */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
        <button onClick={prevMonth} style={{background:"none",border:"none",cursor:"pointer",color:C.muted,fontSize:16,padding:"2px 6px"}}>‹</button>
        <span style={{fontSize:12,fontWeight:600,color:C.text}}>{monthLabel}</span>
        <button onClick={nextMonth} style={{background:"none",border:"none",cursor:"pointer",color:C.muted,fontSize:16,padding:"2px 6px"}}>›</button>
      </div>
      {/* Day headers */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",textAlign:"center",marginBottom:4}}>
        {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d=>(
          <span key={d} style={{fontSize:10,fontWeight:600,color:C.faint,padding:"2px 0"}}>{d}</span>
        ))}
      </div>
      {/* Day grid */}
      {weeks.map((row,wi)=>(
        <div key={wi} style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",textAlign:"center"}}>
          {row.map((d,di)=>{
            const sel=isSelected(d);
            const inR=isInRange(d);
            const td=isToday(d);
            return (
              <div key={di} onClick={()=>handleClick(d)}
                style={{padding:"5px 0",cursor:d?"pointer":"default",fontSize:12,fontWeight:sel?700:td?600:400,
                  color:sel?"#fff":d?C.text:"transparent",
                  background:sel?C.accent:inR?C.accentBg:"transparent",
                  borderRadius:sel?4:0,
                  transition:"background 0.1s",
                  ...(td&&!sel?{boxShadow:`inset 0 -2px 0 ${C.accent}`}:{}),
                }}>
                {d||""}
              </div>
            );
          })}
        </div>
      ))}
      {/* Selection label */}
      <div style={{marginTop:8,fontSize:11,color:C.muted}}>
        {mode==="single"?(startDate?fmtD(startDate):"Click a date")
          :(startDate&&endDate?`${fmtD(startDate)} → ${fmtD(endDate)}`
            :startDate?`${fmtD(startDate)} → click end date`
            :"Click start date")}
      </div>
    </div>
  );
}

// ── EVENTS VIEW ────────────────────────────────────────────────────────────
function EventsView({events,setEvents,projects}) {
  const [showAdd,setShowAdd]=useState(false);
  const [form,setForm]=useState({date:"",end_date:"",time:"",title:"",type:"inspection",project_id:"",notes:"",calMode:"single"});
  const [editId,setEditId]=useState(null);
  const [editForm,setEditForm]=useState({date:"",end_date:"",time:"",title:"",type:"",project_id:"",notes:"",calMode:"single"});
  const [dumpMode,setDumpMode]=useState(false);
  const [dumpText,setDumpText]=useState("");
  const [dumpDate,setDumpDate]=useState(TODAY);
  const [dumpType,setDumpType]=useState("other");
  const dumpRef=useRef(null);
  useEffect(()=>{if(dumpMode&&dumpRef.current)dumpRef.current.focus();},[dumpMode]);

  const submitDump = async () => {
    const lines = dumpText.split("\n").map(l=>l.trim()).filter(Boolean);
    if(!lines.length) return;
    for(const title of lines) {
      try {
        const rows = await sbInsertRow("events", {title, event_date:dumpDate, event_type:dumpType, event_time:null, project_id:null, notes:"", done:false});
        if(rows?.[0]) setEvents(prev=>[...prev, mapEvent(rows[0])]);
      } catch(e){console.error(e);}
    }
    setDumpText("");setDumpMode(false);
  };

  const startEdit = ev => { setEditId(ev.id); setEditForm({date:ev.date||"",end_date:ev.end_date||"",time:ev.time||"",title:ev.title||"",type:ev.type||"inspection",project_id:ev.project_id?String(ev.project_id):"",notes:ev.notes||"",calMode:ev.end_date?"range":"single"}); };
  const cancelEdit = () => { setEditId(null); };
  const saveEdit = () => {
    if(!editForm.date||!editForm.title) return;
    const endD=editForm.calMode==="range"&&editForm.end_date?editForm.end_date:null;
    const patch = {event_date:editForm.date,event_end_date:endD,event_time:editForm.time||null,title:editForm.title,event_type:editForm.type,project_id:editForm.project_id?parseInt(editForm.project_id):null,notes:editForm.notes};
    setEvents(prev=>prev.map(e=>e.id===editId?{...e,date:editForm.date,end_date:endD,time:editForm.time||"",title:editForm.title,type:editForm.type,project_id:patch.project_id,notes:editForm.notes}:e));
    sbPatch("events",editId,patch).catch(console.error);
    setEditId(null);
  };

  const grouped=useMemo(()=>{
    const sorted=[...events].sort((a,b)=>toMs(a.date)-toMs(b.date));
    const months={};
    sorted.forEach(ev=>{
      const d=new Date(ev.date+"T12:00:00");
      const key=d.toLocaleDateString("en-US",{month:"long",year:"numeric"});
      if(!months[key])months[key]=[];
      months[key].push(ev);
    });
    return Object.entries(months);
  },[events]);

  const addEvent=()=>{
    if(!form.date||!form.title) return;
    const endD=form.calMode==="range"&&form.end_date?form.end_date:null;
    const dbEvent = {
      event_date:form.date, event_end_date:endD, event_time:form.time||null, title:form.title, event_type:form.type,
      project_id:form.project_id?parseInt(form.project_id):null,
      notes:form.notes, done:false,
    };
    setForm({date:"",end_date:"",time:"",title:"",type:"inspection",project_id:"",notes:"",calMode:"single"});
    setShowAdd(false);
    sbInsertRow("events", dbEvent).then(rows=>{
      if(rows?.[0]) setEvents(prev=>[...prev, mapEvent(rows[0])]);
    }).catch(console.error);
  };
  const toggleDone=id=>{
    const ev=events.find(e=>e.id===id); if(!ev) return;
    setEvents(prev=>prev.map(e=>e.id===id?{...e,done:!e.done}:e));
    sbPatch("events", id, {done:!ev.done}).catch(console.error);
  };
  const removeEvent=id=>{
    setEvents(prev=>prev.filter(e=>e.id!==id));
    sbDel("events", id).catch(console.error);
  };

  const upcoming=events.filter(e=>!e.done&&toMs(e.date)>=toMs(TODAY)).sort((a,b)=>toMs(a.date)-toMs(b.date)).slice(0,3);

  return (
    <div style={{padding:"32px 40px",maxWidth:800}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:24}}>
        <h2 style={{fontSize:18,fontWeight:700,color:C.text,letterSpacing:"-0.2px"}}>Events</h2>
        <div style={{display:"flex",gap:8}}>
          <Btn variant={dumpMode?"primary":"default"} onClick={()=>{setDumpMode(m=>!m);setShowAdd(false);}}>Brain dump</Btn>
          <Btn variant="primary" onClick={()=>{setShowAdd(s=>!s);setDumpMode(false);}}>+ Add event</Btn>
        </div>
      </div>

      {/* Brain dump textarea */}
      {dumpMode&&(
        <div style={{border:`1px solid ${C.accent}`,borderRadius:8,background:C.surface,padding:16,marginBottom:16}}>
          <p style={{fontSize:12,fontWeight:600,color:C.text,marginBottom:6}}>Brain dump</p>
          <p style={{fontSize:11,color:C.muted,marginBottom:10}}>Type one event per line. They'll all be created with the date and type below.</p>
          <div style={{display:"flex",gap:10,marginBottom:10}}>
            <div>
              <p style={{fontSize:10,color:C.muted,marginBottom:3,fontWeight:500}}>Date</p>
              <input type="date" value={dumpDate} onChange={e=>setDumpDate(e.target.value)}
                style={{border:`1px solid ${C.border}`,borderRadius:5,padding:"5px 8px",fontSize:12,color:C.text,background:C.bg,fontFamily:"inherit",outline:"none"}}/>
            </div>
            <div>
              <p style={{fontSize:10,color:C.muted,marginBottom:3,fontWeight:500}}>Type</p>
              <select value={dumpType} onChange={e=>setDumpType(e.target.value)}
                style={{border:`1px solid ${C.border}`,borderRadius:5,padding:"5px 8px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none",appearance:"none"}}>
                {EVENT_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <textarea ref={dumpRef} value={dumpText} onChange={e=>setDumpText(e.target.value)}
            placeholder={"Final inspection\nWalk-through with buyer\nPermit pickup\nContractor meeting"}
            rows={6}
            style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:5,padding:"10px 12px",fontSize:13,color:C.text,background:C.bg,fontFamily:"inherit",outline:"none",resize:"vertical",lineHeight:"1.7"}}
            onFocus={e=>e.target.style.borderColor=C.accent} onBlur={e=>e.target.style.borderColor=C.border}/>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:10}}>
            <span style={{fontSize:11,color:C.muted}}>{dumpText.split("\n").filter(l=>l.trim()).length} event(s)</span>
            <div style={{display:"flex",gap:8}}>
              <Btn onClick={()=>{setDumpText("");setDumpMode(false);}}>Cancel</Btn>
              <Btn variant="primary" onClick={submitDump}>Create all</Btn>
            </div>
          </div>
        </div>
      )}

      {/* Add form */}
      {showAdd&&(
        <div style={{border:`1px solid ${C.border}`,borderRadius:8,background:C.surface,padding:20,marginBottom:24}}>
          <p style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:14}}>New event</p>
          <div style={{display:"flex",gap:20,marginBottom:14}}>
            {/* Calendar */}
            <div style={{width:240,flexShrink:0,border:`1px solid ${C.border}`,borderRadius:8,padding:12,background:C.bg}}>
              <MiniCal mode={form.calMode} setMode={m=>setForm(f=>({...f,calMode:m,end_date:m==="single"?"":f.end_date}))}
                startDate={form.date} endDate={form.end_date}
                onSelect={(s,e)=>setForm(f=>({...f,date:s||"",end_date:e||""}))}/>
            </div>
            {/* Fields */}
            <div style={{flex:1,display:"flex",flexDirection:"column",gap:10}}>
              <div>
                <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Title</p>
                <Input value={form.title} onChange={v=>setForm(f=>({...f,title:v}))} placeholder="Event title"/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div>
                  <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Time (optional)</p>
                  <input type="time" value={form.time} onChange={e=>setForm(f=>({...f,time:e.target.value}))}
                    style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:5,padding:"7px 10px",fontSize:13,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}/>
                </div>
                <div>
                  <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Type</p>
                  <select value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}
                    style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:5,padding:"7px 10px",fontSize:13,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none",appearance:"none"}}>
                    {EVENT_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Project (optional)</p>
                <select value={form.project_id} onChange={e=>setForm(f=>({...f,project_id:e.target.value}))}
                  style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:5,padding:"7px 10px",fontSize:13,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none",appearance:"none"}}>
                  <option value="">— No project —</option>
                  {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Notes</p>
                <NoteField value={form.notes} onChange={v=>setForm(f=>({...f,notes:v}))} placeholder="Any details..." rows={2}/>
              </div>
            </div>
          </div>
          <div style={{display:"flex",gap:8}}>
            <Btn variant="primary" onClick={addEvent}>Add event</Btn>
            <Btn onClick={()=>setShowAdd(false)}>Cancel</Btn>
          </div>
        </div>
      )}

      {/* Upcoming strip */}
      {upcoming.length>0&&(
        <div style={{marginBottom:28}}>
          <p style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:10}}>Coming up</p>
          <div style={{display:"flex",gap:10}}>
            {upcoming.map(ev=>{
              const ph=projects.find(p=>p.id===ev.project_id);
              const col=eventColor(ev.type);
              return (
                <div key={ev.id} style={{flex:1,border:`1px solid ${C.border}`,borderRadius:8,padding:"12px 14px",background:C.surface}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
                    <div style={{width:7,height:7,borderRadius:"50%",background:col,flexShrink:0}}/>
                    <span style={{fontSize:11,fontWeight:600,color:col,textTransform:"uppercase",letterSpacing:"0.04em"}}>{eventLabel(ev.type)}</span>
                  </div>
                  <p style={{fontSize:13,fontWeight:500,color:C.text,marginBottom:3,lineHeight:1.3}}>{ev.title}</p>
                  <p style={{fontSize:12,fontVariantNumeric:"tabular-nums",color:C.muted}}>{fmtFull(ev.date)}{ev.time?" · "+ev.time:""}</p>
                  {ph&&<p style={{fontSize:11,color:C.faint,marginTop:3}}>{ph.name}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Full list by month */}
      {grouped.map(([month,evs])=>(
        <div key={month} style={{marginBottom:24}}>
          <p style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:10}}>{month}</p>
          <div style={{border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden",background:C.surface}}>
            {evs.map((ev,i)=>{
              const ph=projects.find(p=>p.id===ev.project_id);
              const col=eventColor(ev.type);
              const isPast=toMs(ev.date)<toMs(TODAY)&&!ev.done;
              const isEditing=editId===ev.id;
              const fSt={border:`1px solid ${C.border}`,borderRadius:5,padding:"5px 8px",fontSize:12,color:C.text,background:C.bg,fontFamily:"inherit",outline:"none"};
              return isEditing?(
                <div key={ev.id} style={{padding:"14px 16px",borderBottom:i<evs.length-1?`1px solid ${C.divider}`:"none",background:C.accentBg}}>
                  <div style={{display:"flex",gap:16,marginBottom:10}}>
                    <div style={{width:220,flexShrink:0,border:`1px solid ${C.border}`,borderRadius:8,padding:10,background:C.bg}}>
                      <MiniCal mode={editForm.calMode} setMode={m=>setEditForm(f=>({...f,calMode:m,end_date:m==="single"?"":f.end_date}))}
                        startDate={editForm.date} endDate={editForm.end_date}
                        onSelect={(s,e)=>setEditForm(f=>({...f,date:s||"",end_date:e||""}))}/>
                    </div>
                    <div style={{flex:1,display:"flex",flexDirection:"column",gap:8}}>
                      <div>
                        <p style={{fontSize:10,color:C.muted,marginBottom:3,fontWeight:500}}>Title</p>
                        <input value={editForm.title} onChange={e=>setEditForm(f=>({...f,title:e.target.value}))} style={{...fSt,width:"100%"}} onKeyDown={e=>e.key==="Enter"&&saveEdit()}/>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                        <div>
                          <p style={{fontSize:10,color:C.muted,marginBottom:3,fontWeight:500}}>Time</p>
                          <input type="time" value={editForm.time} onChange={e=>setEditForm(f=>({...f,time:e.target.value}))} style={{...fSt,width:"100%"}}/>
                        </div>
                        <div>
                          <p style={{fontSize:10,color:C.muted,marginBottom:3,fontWeight:500}}>Type</p>
                          <select value={editForm.type} onChange={e=>setEditForm(f=>({...f,type:e.target.value}))} style={{...fSt,width:"100%",appearance:"none"}}>
                            {EVENT_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}
                          </select>
                        </div>
                      </div>
                      <div>
                        <p style={{fontSize:10,color:C.muted,marginBottom:3,fontWeight:500}}>Project</p>
                        <select value={editForm.project_id} onChange={e=>setEditForm(f=>({...f,project_id:e.target.value}))} style={{...fSt,width:"100%",appearance:"none"}}>
                          <option value="">— No project —</option>
                          {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <p style={{fontSize:10,color:C.muted,marginBottom:3,fontWeight:500}}>Notes</p>
                        <input value={editForm.notes} onChange={e=>setEditForm(f=>({...f,notes:e.target.value}))} style={{...fSt,width:"100%"}} placeholder="Notes..."/>
                      </div>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:6}}>
                    <Btn variant="primary" onClick={saveEdit} style={{fontSize:11,padding:"4px 12px"}}>Save</Btn>
                    <Btn onClick={cancelEdit} style={{fontSize:11,padding:"4px 10px"}}>Cancel</Btn>
                  </div>
                </div>
              ):(
                <div key={ev.id} style={{display:"flex",alignItems:"flex-start",gap:12,padding:"12px 16px",borderBottom:i<evs.length-1?`1px solid ${C.divider}`:"none",opacity:ev.done?0.5:1}}>
                  {/* Date column */}
                  <div style={{width:48,flexShrink:0,textAlign:"center",paddingTop:1}}>
                    <p style={{fontSize:18,fontWeight:700,color:isPast?C.faint:C.text,lineHeight:1,fontVariantNumeric:"tabular-nums"}}>{new Date(ev.date+"T12:00:00").getDate()}</p>
                    <p style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.04em"}}>{new Date(ev.date+"T12:00:00").toLocaleDateString("en-US",{month:"short"})}</p>
                  </div>
                  {/* Color bar */}
                  <div style={{width:3,alignSelf:"stretch",background:col,borderRadius:2,flexShrink:0,minHeight:36}}/>
                  {/* Content */}
                  <div style={{flex:1,minWidth:0,cursor:"pointer"}} onClick={()=>startEdit(ev)}>
                    <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:3}}>
                      <span style={{fontSize:11,fontWeight:600,color:col,textTransform:"uppercase",letterSpacing:"0.04em"}}>{eventLabel(ev.type)}</span>
                      {ph&&<><span style={{color:C.faint,fontSize:11}}>·</span><span style={{fontSize:11,color:C.muted}}>{ph.name}</span></>}
                    </div>
                    <p style={{fontSize:13,fontWeight:500,color:ev.done?C.muted:C.text,textDecoration:ev.done?"line-through":"none"}}>{ev.title}</p>
                    {ev.end_date&&<p style={{fontSize:11,color:C.accent,marginTop:2}}>{fmtD(ev.date)} → {fmtD(ev.end_date)}</p>}
                    {ev.time&&<p style={{fontSize:12,color:C.muted,marginTop:2}}>{ev.time}</p>}{ev.notes&&<p style={{fontSize:12,color:C.muted,marginTop:3,lineHeight:1.4}}>{ev.notes}</p>}
                  </div>
                  {/* Actions */}
                  <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                    <button onClick={()=>startEdit(ev)} style={{background:"none",border:"none",cursor:"pointer",color:C.faint,fontSize:12,padding:"0 2px"}} title="Edit">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>
                    <CheckBox done={ev.done} onClick={()=>toggleDone(ev.id)}/>
                    <button onClick={()=>removeEvent(ev.id)} style={{background:"none",border:"none",cursor:"pointer",color:C.faint,fontSize:13,padding:"0 2px"}}>✕</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── DASHBOARD ──────────────────────────────────────────────────────────────
function Dashboard({projects,tasks,expenses,events,phases,proceeds,onNavigate}) {
  const [taskNum,setTaskNum]=useState(2);
  const [taskUnit,setTaskUnit]=useState("w"); // "w","m","y","all"
  const totalProceeds  = (proceeds||[]).reduce((s,p)=>s+(parseFloat(p.amount)||0),0);
  const totalActual    = tasks.filter(t=>!t.parent_task_id).reduce((s,t)=>s+(taskTotalAct(t,tasks)||0),0);
  const totalProjected = projects.reduce((s,p)=>{
    const tc=tasks.filter(t=>t.project_id===p.id&&!t.parent_task_id).reduce((a,t)=>a+(taskTotalEst(t,tasks)||0),0);
    return s+tc+(p.contingency||0);
  },0);
  const runningBalance = totalProceeds - totalActual;
  const done=tasks.filter(t=>t.status==="complete").length;
  const windowEnd=useMemo(()=>{
    if(taskUnit==="all") return null;
    const d=new Date(TODAY+"T12:00:00");
    if(taskUnit==="w") d.setDate(d.getDate()+taskNum*7);
    else if(taskUnit==="m") d.setMonth(d.getMonth()+taskNum);
    else if(taskUnit==="y") d.setFullYear(d.getFullYear()+taskNum);
    return d.toISOString().split("T")[0];
  },[taskNum,taskUnit]);
  const upcoming=[...tasks].filter(t=>t.status!=="complete"&&t.end&&toMs(t.end)>=toMs(TODAY)&&(!windowEnd||toMs(t.end)<=toMs(windowEnd))).sort((a,b)=>toMs(a.end)-toMs(b.end));
  const upcomingEvents=[...events].filter(e=>!e.done&&toMs(e.date)>=toMs(TODAY)).sort((a,b)=>toMs(a.date)-toMs(b.date)).slice(0,4);

  return (
    <div style={{padding:"32px 40px",maxWidth:960}}>
      <div style={{marginBottom:22}}>
        <p style={{fontSize:13,color:C.muted,marginBottom:3}}>{PROJECT.address}</p>
        <h1 style={{fontSize:22,fontWeight:700,color:C.text,letterSpacing:"-0.3px"}}>{PROJECT.name}</h1>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:1,border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden",marginBottom:22,background:C.border}}>
        {[
          {l:"Proceeds",       v:fmtM(totalProceeds),  color:C.text},
          {l:"Projected Spend",v:fmtM(totalProjected), color:C.text},
          {l:"Actual Spend",   v:fmtM(totalActual),    color:totalActual>0?"#C0392B":C.muted},
          {l:"Running Balance",v:fmtM(runningBalance),  color:runningBalance>=0?C.green:"#C0392B"},
        ].map(({l,v,color})=>(
          <div key={l} style={{background:C.surface,padding:"14px 18px"}}>
            <p style={{fontSize:11,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:5}}>{l}</p>
            <p style={{fontSize:18,fontWeight:600,color,fontVariantNumeric:"tabular-nums"}}>{v}</p>
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1.2fr 1fr 0.8fr",gap:16,alignItems:"start"}}>
        <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8}}>
          <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.divider}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <p style={{fontSize:13,fontWeight:600,color:C.text}}>Upcoming tasks</p>
            <div style={{display:"flex",alignItems:"center",gap:4}}>
              {taskUnit!=="all"&&<input type="number" min={1} max={52} value={taskNum} onChange={e=>setTaskNum(Math.max(1,parseInt(e.target.value)||1))}
                style={{width:36,border:`1px solid ${C.border}`,borderRadius:5,padding:"3px 6px",fontSize:11,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none",textAlign:"center"}}/>}
              {[{v:"w",l:"Wk"},{v:"m",l:"Mo"},{v:"y",l:"Yr"},{v:"all",l:"All"}].map(o=>(
                <button key={o.v} onClick={()=>setTaskUnit(o.v)} style={{padding:"3px 8px",fontSize:11,fontWeight:500,borderRadius:5,cursor:"pointer",
                  border:`1px solid ${taskUnit===o.v?C.accent:C.border}`,background:taskUnit===o.v?C.accentBg:C.surface,color:taskUnit===o.v?C.accent:C.muted,transition:"all 0.1s"}}>{o.l}</button>
              ))}
            </div>
          </div>
          {upcoming.length===0&&<p style={{padding:"16px",fontSize:12,color:C.muted}}>No tasks due in this window.</p>}
          {upcoming.map((t,i)=>{
            const ph=projects.find(p=>p.id===t.project_id);
            return (
              <div key={t.id} onClick={()=>onNavigate("project",t.project_id)} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 16px",borderBottom:i<upcoming.length-1?`1px solid ${C.divider}`:"none",cursor:"pointer"}}
                onMouseEnter={e=>e.currentTarget.style.background=C.hover} onMouseLeave={e=>e.currentTarget.style.background="transparent"}
              >
                <div style={{width:6,height:6,borderRadius:"50%",background:pc(t.project_id),flexShrink:0}}/>
                <div style={{flex:1,minWidth:0}}>
                  <p style={{fontSize:13,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</p>
                  <p style={{fontSize:11,color:C.muted,marginTop:1}}>{ph?.name}</p>
                </div>
                <Avatar name={t.assignee}/>
                <p style={{fontSize:12,color:C.muted,fontVariantNumeric:"tabular-nums",minWidth:48,textAlign:"right"}}>{fmtD(t.end)}</p>
              </div>
            );
          })}
        </div>
        <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8}}>
          <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.divider}`}}><p style={{fontSize:13,fontWeight:600,color:C.text}}>Projects</p></div>
          {projects.map((ph,i)=>{
            const pTasks=tasks.filter(t=>t.project_id===ph.id);
            const projected=pTasks.filter(t=>!t.parent_task_id).reduce((a,t)=>a+(taskTotalEst(t,tasks)||0),0)+(ph.contingency||0);
            const actual=pTasks.filter(t=>!t.parent_task_id).reduce((a,t)=>a+(taskTotalAct(t,tasks)||0),0);
            const cap=projected||ph.target_budget||1;
            return (
              <div key={ph.id} onClick={()=>onNavigate("project",ph.id)} style={{padding:"9px 16px",borderBottom:i<projects.length-1?`1px solid ${C.divider}`:"none",cursor:"pointer"}}
                onMouseEnter={e=>e.currentTarget.style.background=C.hover} onMouseLeave={e=>e.currentTarget.style.background="transparent"}
              >
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                  <div style={{width:7,height:7,borderRadius:2,background:pc(ph.id)}}/>
                  <span style={{fontSize:13,color:C.text,flex:1,fontWeight:500}}>{ph.name}</span>
                </div>
                <div style={{height:3,background:C.divider,borderRadius:2,marginLeft:15}}>
                  <div style={{height:"100%",width:`${Math.min(100,(actual/cap)*100)}%`,background:C.green,borderRadius:2}}/>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8}}>
          <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.divider}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <p style={{fontSize:13,fontWeight:600,color:C.text}}>Events</p>
            <span onClick={()=>onNavigate("events")} style={{fontSize:11,color:C.accent,cursor:"pointer"}}>See all</span>
          </div>
          {upcomingEvents.length===0&&<p style={{padding:"16px",fontSize:12,color:C.muted}}>No upcoming events.</p>}
          {upcomingEvents.map((ev,i)=>{
            const col=eventColor(ev.type);
            return (
              <div key={ev.id} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"9px 16px",borderBottom:i<upcomingEvents.length-1?`1px solid ${C.divider}`:"none"}}>
                <div style={{width:3,alignSelf:"stretch",background:col,borderRadius:2,flexShrink:0,minHeight:24}}/>
                <div style={{flex:1,minWidth:0}}>
                  <p style={{fontSize:12,fontWeight:500,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ev.title}</p>
                  <p style={{fontSize:11,color:C.muted,marginTop:1}}>{fmtFull(ev.date)}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── TIMELINE ───────────────────────────────────────────────────────────────
const LCOL=250;
function TimelineView({tasks,setTasks,projects,setProjects,onNavigate,proceeds,setProceeds,phases,expenses,quotes,updateQuote,team,events,setEvents}) {
  const [tlRange,setTlRange]=useState({start:PROJECT.start,end:PROJECT.end});
  const pS=tlRange.start,pE=tlRange.end,projDays=daysBetween(pS,pE)||1;
  const setRange=(s,e)=>setTlRange({start:s,end:e});
  const zoomPresets=[
    {l:"1 mo",fn:()=>{const s=TODAY;setRange(s,addDays(s,30));}},
    {l:"3 mo",fn:()=>{const s=addDays(TODAY,-15);setRange(s,addDays(s,90));}},
    {l:"6 mo",fn:()=>{const s=addDays(TODAY,-30);setRange(s,addDays(s,180));}},
    {l:"All",fn:()=>setRange(PROJECT.start,PROJECT.end)},
  ];
  const panLeft=()=>{ const d=Math.max(7,Math.round(projDays*0.25)); setRange(addDays(pS,-d),addDays(pE,-d)); };
  const panRight=()=>{ const d=Math.max(7,Math.round(projDays*0.25)); setRange(addDays(pS,d),addDays(pE,d)); };
  const containerRef=useRef(null);
  const [drag,setDrag]=useState(null);
  const [dragTip,setDragTip]=useState(null); // {x,y,text}
  const [groupBy,setGroupBy]=useState("phase"); // "phase" | "assignee" | "all"
  const [hideComplete,setHideComplete]=useState(false);
  const [showCashFlow,setShowCashFlow]=useState(true);
  const [showDrawdown,setShowDrawdown]=useState(false);
  const [showProceeds,setShowProceeds]=useState(true);
  const [showEvents,setShowEvents]=useState(true);
  const [collapsedGroups,setCollapsedGroups]=useState({});
  const toggleGroup=k=>setCollapsedGroups(prev=>({...prev,[k]:!prev[k]}));
  const [peek,setPeek]=useState(null); // {type:"task"|"event"|"proceed"|"project", id}
  const [hoverEventId,setHoverEventId]=useState(null);
  const [hoverTaskId,setHoverTaskId]=useState(null);
  const [hoverProceedId,setHoverProceedId]=useState(null);
  const [expandedTlTasks,setExpandedTlTasks]=useState(new Set());
  const toggleTlExpand=id=>setExpandedTlTasks(prev=>{const s=new Set(prev);if(s.has(id))s.delete(id);else s.add(id);return s;});
  const [showAddEvent,setShowAddEvent]=useState(false);
  const [newEvent,setNewEvent]=useState({title:"",event_date:TODAY,event_type:"other"});
  const [showAddProceed,setShowAddProceed]=useState(false);
  const [newProceed,setNewProceed]=useState({label:"",amount:"",received_date:TODAY,type:"contribution"});
  const [addingTaskGroup,setAddingTaskGroup]=useState(null);
  const [newTaskTitle,setNewTaskTitle]=useState("");
  const [showAddProject,setShowAddProject]=useState(false);
  const [newProjectName,setNewProjectName]=useState("");

  // Sort proceeds/events only when user explicitly clicks sort
  const sortProceeds=(mode)=>{
    setProceeds(prev=>[...prev].sort(mode==="date"
      ?(a,b)=>(a.received_date||"").localeCompare(b.received_date||"")||(a.id-b.id)
      :(a,b)=>(a.label||"").localeCompare(b.label||"")||(a.id-b.id)));
  };
  const sortEvents=(mode)=>{
    setEvents(prev=>[...prev].sort(mode==="date"
      ?(a,b)=>(a.date||"").localeCompare(b.date||"")||(a.id-b.id)
      :(a,b)=>(a.title||"").localeCompare(b.title||"")||(a.id-b.id)));
  };

  const months=useMemo(()=>{
    const res=[],s=new Date(pS+"T12:00:00"),e=new Date(pE+"T12:00:00");
    let c=new Date(s.getFullYear(),s.getMonth(),1);
    while(c<=e){
      const iso=`${c.getFullYear()}-${String(c.getMonth()+1).padStart(2,"0")}-01`;
      // For short ranges (<=60 days), show weeks instead of months
      if(projDays<=60){
        res.push({label:c.toLocaleDateString("en-US",{month:"long",year:"numeric"}),pct:datePct(iso,pS,pE)});
      } else {
        res.push({label:c.toLocaleDateString("en-US",{month:"short",year:"2-digit"}),pct:datePct(iso,pS,pE)});
      }
      c=new Date(c.getFullYear(),c.getMonth()+1,1);
    }
    return res;
  },[pS,pE,projDays]);

  const bw=useCallback(()=>containerRef.current?containerRef.current.getBoundingClientRect().width-LCOL:800,[]);
  const onDown=useCallback((e,id,type)=>{
    e.preventDefault();e.stopPropagation();
    const t=tasks.find(x=>x.id===id);if(!t)return;
    const start = t.start||TODAY;
    const end   = t.end||addDays(TODAY,7);
    if(!t.start||!t.end) setTasks(prev=>prev.map(x=>x.id===id?{...x,start,end}:x));
    setDrag({id,type,kind:"task",startX:e.clientX,origStart:start,origEnd:end,bw:bw()});
  },[tasks,bw]);

  const onDownProceed=useCallback((e,id)=>{
    e.preventDefault();e.stopPropagation();
    const p=(proceeds||[]).find(x=>x.id===id);if(!p)return;
    const date=p.received_date||TODAY;
    if(!p.received_date) setProceeds(prev=>prev.map(x=>x.id===id?{...x,received_date:date}:x));
    setDrag({id,kind:"proceed",startX:e.clientX,origDate:date,bw:bw()});
  },[proceeds,bw]);

  const onDownEvent=useCallback((e,id)=>{
    e.preventDefault();e.stopPropagation();
    const ev=(events||[]).find(x=>x.id===id);if(!ev)return;
    const date=ev.date||TODAY;
    if(!ev.date) setEvents(prev=>prev.map(x=>x.id===id?{...x,date}:x));
    setDrag({id,kind:"event",startX:e.clientX,origDate:date,bw:bw()});
  },[events,bw]);

  useEffect(()=>{
    if(!drag)return;
    const mv=e=>{
      const dd=Math.round(((e.clientX-drag.startX)/drag.bw)*projDays);
      if(drag.kind==="task"){
        let tipText="";
        setTasks(prev=>prev.map(t=>{
          if(t.id!==drag.id)return t;
          if(!drag.origStart||!drag.origEnd)return t;
          if(drag.type==="move"){
            const ns=addDays(drag.origStart,dd),ne=addDays(drag.origEnd,dd);
            tipText=`${fmtDow(ns)} → ${fmtDow(ne)}`;
            return{...t,start:ns,end:ne};
          }
          const ne=addDays(drag.origEnd,dd);
          const clamped=ne>drag.origStart?ne:addDays(drag.origStart,1);
          tipText=`${fmtDow(drag.origStart)} → ${fmtDow(clamped)}`;
          return{...t,end:clamped};
        }));
        setDragTip({x:e.clientX,y:e.clientY,text:tipText});
      } else if(drag.kind==="proceed"){
        const nd=addDays(drag.origDate,dd);
        setProceeds(prev=>prev.map(p=>p.id===drag.id?{...p,received_date:nd}:p));
        setDragTip({x:e.clientX,y:e.clientY,text:fmtDow(nd)});
      } else if(drag.kind==="event"){
        const nd=addDays(drag.origDate,dd);
        setEvents(prev=>prev.map(ev=>ev.id===drag.id?{...ev,date:nd,event_date:nd}:ev));
        setDragTip({x:e.clientX,y:e.clientY,text:fmtDow(nd)});
      }
    };
    const up=e=>{
      if(drag){
        const dd=Math.round(((e.clientX-drag.startX)/drag.bw)*projDays);
        if(drag.kind==="task"&&drag.origStart&&drag.origEnd){
          let ns=drag.origStart,ne=drag.origEnd;
          if(drag.type==="move"){ns=addDays(drag.origStart,dd);ne=addDays(drag.origEnd,dd);}
          else{ne=addDays(drag.origEnd,dd);if(ne<=drag.origStart)ne=addDays(drag.origStart,1);}
          setTasks(prev=>prev.map(t=>t.id===drag.id?{...t,start:ns,end:ne}:t));
          sbPatch("tasks",drag.id,{start_date:ns,end_date:ne}).catch(console.error);
        } else if(drag.kind==="proceed"){
          const nd=addDays(drag.origDate,dd);
          setProceeds(prev=>prev.map(p=>p.id===drag.id?{...p,received_date:nd}:p));
          sbPatch("proceeds",drag.id,{received_date:nd}).catch(console.error);
        } else if(drag.kind==="event"){
          const nd=addDays(drag.origDate,dd);
          setEvents(prev=>prev.map(ev=>ev.id===drag.id?{...ev,date:nd,event_date:nd}:ev));
          sbPatch("events",drag.id,{event_date:nd}).catch(console.error);
        }
      }
      setDrag(null);setDragTip(null);
    };
    window.addEventListener("mousemove",mv);window.addEventListener("mouseup",up);
    return()=>{window.removeEventListener("mousemove",mv);window.removeEventListener("mouseup",up);};
  },[drag,projDays]);

  const todayPct=datePct(TODAY,pS,pE);
  const Grid=()=>(
    <>
      {months.map(({pct},i)=><div key={i} style={{position:"absolute",left:`${pct}%`,top:0,bottom:0,width:1,background:C.divider,pointerEvents:"none"}}/>)}
      <div style={{position:"absolute",left:`${todayPct}%`,top:0,bottom:0,width:1.5,background:C.accent,opacity:0.8,pointerEvents:"none",zIndex:4}}/>
    </>
  );

  // Build groups based on groupBy mode
  const groups = useMemo(()=>{
    if(groupBy==="phase"){
      return projects.map(ph=>({
        key: String(ph.id),
        label: ph.name,
        color: pc(ph.id),
        headerExtra: ()=>{
          const bL=datePct(ph.start,pS,pE),bW=datePct(ph.end,pS,pE)-bL;
          return <div style={{position:"absolute",left:`${bL}%`,width:`${bW}%`,height:6,background:pc(ph.id),borderRadius:3,opacity:0.25,zIndex:1}}/>;
        },
        onHeaderClick: ()=>setPeek({type:"project",id:ph.id}),
        rows: tasks.filter(t=>t.project_id===ph.id && !t.parent_task_id && (!hideComplete || t.status!=="complete")),
        taskColor: t=>t.status==="complete"?C.faint:pc(ph.id),
      }));
    }
    if(groupBy==="assignee"){
      const assignees=[...new Set(tasks.map(t=>t.assignee))].sort();
      return assignees.map(a=>({
        key: a,
        label: a,
        color: null,
        headerExtra: ()=>null,
        onHeaderClick: null,
        rows: [...tasks.filter(t=>t.assignee===a && (!hideComplete || t.status!=="complete") && t.start && t.end).sort((x,y)=>toMs(x.start)-toMs(y.start)), ...tasks.filter(t=>t.assignee===a && (!hideComplete || t.status!=="complete") && !t.start)],
        taskColor: t=>t.status==="complete"?C.faint:pc(t.project_id),
      }));
    }
    // "all" — single flat group, sorted by start
    return [{
      key:"all",
      label:"All tasks",
      color:null,
      headerExtra:()=>null,
      onHeaderClick:null,
      rows:[...tasks.filter(t=>(!hideComplete || t.status!=="complete") && t.start&&t.end).sort((a,b)=>toMs(a.start)-toMs(b.start)), ...tasks.filter(t=>(!hideComplete || t.status!=="complete") && !t.start)],
      taskColor:t=>t.status==="complete"?C.faint:pc(t.project_id),
    }];
  },[groupBy,tasks,projects,hideComplete]);

  const colLabel = groupBy==="phase"?"Phase / task" : groupBy==="assignee"?"Assignee / task" : "Task";

  // Cash flow data using same date axis as gantt (pS → pE)
  const cashFlow = useMemo(()=>{
    const ins = (proceeds||[]).filter(p=>p.received_date).map(p=>({date:p.received_date, amount:parseFloat(p.amount)||0})).sort((a,b)=>a.date.localeCompare(b.date));
    const outs = tasks.filter(t=>taskTotalAct(t,tasks)>0 && t.end && !t.parent_task_id).map(t=>({date:t.end, amount:taskTotalAct(t,tasks)})).sort((a,b)=>a.date.localeCompare(b.date));
    const proj = tasks.filter(t=>taskTotalEst(t,tasks)>0 && t.end && !t.parent_task_id).map(t=>({date:t.end, amount:taskTotalEst(t,tasks)})).sort((a,b)=>a.date.localeCompare(b.date));
    const buildCum = (events) => {
      const pts = [{date:pS, val:0}]; let cum=0;
      events.forEach(e=>{ if(e.date>=pS && e.date<=pE){ cum+=e.amount; pts.push({date:e.date,val:cum}); } else if(e.date<pS){ cum+=e.amount; pts[0].val=cum; } });
      pts.push({date:pE, val:cum});
      return pts;
    };
    const cIn=buildCum(ins), cOut=buildCum(outs), cProj=buildCum(proj);
    const yMax = Math.max(cIn[cIn.length-1].val, cProj[cProj.length-1].val, cOut[cOut.length-1].val, 1000) * 1.15;
    // Drawdown: proceeds balance minus cumulative costs at each date
    const allDates = [...new Set([...ins.map(e=>e.date),...outs.map(e=>e.date),...proj.map(e=>e.date),pS,pE])].sort();
    const valAt = (series,d) => { for(let i=series.length-1;i>=0;i--){ if(series[i].date<=d) return series[i].val; } return 0; };
    const ddActual = allDates.map(d=>({date:d, val:valAt(cIn,d)-valAt(cOut,d)}));
    const ddBudget = allDates.map(d=>({date:d, val:valAt(cIn,d)-valAt(cProj,d)}));
    const ddMin = Math.min(...ddActual.map(p=>p.val),...ddBudget.map(p=>p.val),0);
    const ddMax = Math.max(...ddActual.map(p=>p.val),...ddBudget.map(p=>p.val),cIn[cIn.length-1].val);
    const ddYMax = Math.max(Math.abs(ddMin), ddMax, 1000) * 1.15;
    return {cIn, cOut, cProj, yMax, ddActual, ddBudget, ddMin, ddYMax};
  },[proceeds, tasks, pS, pE]);

  // Interpolate value at date
  const cfValAt = (series, date) => { for(let i=series.length-1;i>=0;i--){ if(series[i].date<=date) return series[i].val; } return 0; };

  // Cash flow summary at today
  const cfInNow = cfValAt(cashFlow.cIn, TODAY);
  const cfOutNow = cfValAt(cashFlow.cOut, TODAY);
  const cfProjNow = cfValAt(cashFlow.cProj, TODAY);
  const ddActualNow = cfInNow - cfOutNow;
  const ddBudgetNow = cfInNow - cfProjNow;

  return (
    <div style={{padding:"28px 40px",userSelect:"none",cursor:drag?(drag.type==="resize"?"ew-resize":"grabbing"):"default"}}>
      {/* Drag date tooltip */}
      {dragTip&&<div style={{position:"fixed",left:dragTip.x+12,top:dragTip.y-32,background:C.text,color:C.bg,fontSize:11,fontWeight:600,padding:"4px 10px",borderRadius:6,pointerEvents:"none",zIndex:9999,whiteSpace:"nowrap",boxShadow:"0 2px 8px rgba(0,0,0,0.2)"}}>{dragTip.text}</div>}
      {/* Header row */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
        <div style={{display:"flex",alignItems:"baseline",gap:12}}>
          <h2 style={{fontSize:20,fontWeight:700,color:C.text,letterSpacing:"-0.3px"}}>Timeline</h2>
          <span style={{fontSize:12,color:C.faint}}>Drag to move · right edge to resize</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <button onClick={panLeft} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:5,padding:"3px 8px",fontSize:13,cursor:"pointer",color:C.muted}}>‹</button>
          {zoomPresets.map(z=>(
            <button key={z.l} onClick={z.fn} style={{padding:"3px 10px",fontSize:11,fontWeight:500,borderRadius:5,cursor:"pointer",border:`1px solid ${C.border}`,background:C.surface,color:C.muted}}>{z.l}</button>
          ))}
          <button onClick={panRight} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:5,padding:"3px 8px",fontSize:13,cursor:"pointer",color:C.muted}}>›</button>
          <div style={{width:1,height:16,background:C.divider,margin:"0 4px"}}/>
          <input type="date" value={pS} onChange={e=>e.target.value&&setRange(e.target.value,pE)} style={{border:`1px solid ${C.border}`,borderRadius:5,padding:"3px 8px",fontSize:11,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}/>
          <span style={{fontSize:11,color:C.faint}}>→</span>
          <input type="date" value={pE} onChange={e=>e.target.value&&setRange(pS,e.target.value)} style={{border:`1px solid ${C.border}`,borderRadius:5,padding:"3px 8px",fontSize:11,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}/>
        </div>
      </div>

      <div ref={containerRef} style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:"hidden",background:C.surface,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
        {/* Month header */}
        <div style={{display:"flex",borderBottom:`1px solid ${C.border}`,background:C.bg}}>
          <div style={{width:LCOL,flexShrink:0,padding:"10px 20px",borderRight:`1px solid ${C.border}`}}>
            <span style={{fontSize:11,color:C.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.04em"}}>{colLabel}</span>
          </div>
          <div style={{flex:1,position:"relative",height:36}}>
            {months.map(({label,pct},i)=>(
              <div key={i} style={{position:"absolute",left:`${pct}%`,top:0,bottom:0,display:"flex",alignItems:"center",paddingLeft:8}}>
                <span style={{fontSize:10,color:C.muted,fontWeight:500,whiteSpace:"nowrap"}}>{label}</span>
              </div>
            ))}
            <div style={{position:"absolute",left:`${todayPct}%`,top:0,bottom:0,width:1.5,background:C.accent,opacity:0.6}}/>
          </div>
        </div>

        {/* ── Proceeds rows at top ─────────────────────────── */}
        <div style={{borderBottom:`1px solid ${C.border}`}}>
          <div onClick={()=>setShowProceeds(s=>!s)} style={{display:"flex",alignItems:"center",height:36,background:C.bg,cursor:"pointer"}}>
            <div style={{width:LCOL,flexShrink:0,padding:"0 20px",borderRight:`1px solid ${C.border}`,height:"100%",display:"flex",alignItems:"center",gap:8}}>
              <svg width="10" height="10" viewBox="0 0 10 10" style={{transform:showProceeds?"rotate(90deg)":"rotate(0)",transition:"transform 0.15s",flexShrink:0}}>
                <path d="M3 1.5L7 5L3 8.5" stroke={C.muted} strokeWidth="1.5" fill="none" strokeLinecap="round"/>
              </svg>
              <div style={{width:8,height:8,borderRadius:2,background:C.green,flexShrink:0}}/>
              <span style={{fontSize:12,fontWeight:600,color:C.text}}>Proceeds</span>
              <span style={{fontSize:11,color:C.green,fontWeight:600,marginLeft:"auto",flexShrink:0,fontVariantNumeric:"tabular-nums"}}>{fmtM((proceeds||[]).reduce((s,p)=>s+(parseFloat(p.amount)||0),0))}</span>
              {showProceeds&&<>
                <button onClick={e=>{e.stopPropagation();sortProceeds("date");}} title="Sort by date" style={{marginLeft:8,background:"none",border:`1px solid ${C.border}`,borderRadius:3,cursor:"pointer",padding:"1px 5px",fontSize:10,color:C.muted,lineHeight:1.4}}>&#8693;</button>
                <button onClick={e=>{e.stopPropagation();sortProceeds("alpha");}} title="Sort A-Z" style={{background:"none",border:`1px solid ${C.border}`,borderRadius:3,cursor:"pointer",padding:"1px 5px",fontSize:10,color:C.muted,lineHeight:1.4}}>A&#8595;</button>
              </>}
            </div>
            <div style={{flex:1,position:"relative",height:"100%",display:"flex",alignItems:"center"}}>
              <Grid/>
              {!showProceeds&&(proceeds||[]).filter(p=>p.received_date).map(p=>{
                const pctX=datePct(p.received_date,pS,pE);
                const hovered=hoverProceedId===p.id;
                return <div key={p.id}
                  onClick={e=>e.stopPropagation()}
                  onMouseEnter={e=>{e.stopPropagation();setHoverProceedId(p.id);}}
                  onMouseLeave={e=>{e.stopPropagation();setHoverProceedId(null);}}
                  style={{position:"absolute",left:`${pctX}%`,top:"50%",transform:"translate(-50%,-50%)",width:hovered?11:8,height:hovered?11:8,borderRadius:"50%",background:C.green,zIndex:hovered?10:3,border:"1.5px solid white",cursor:"default",boxShadow:hovered?`0 0 0 2px ${C.green}66`:`0 0 0 1px ${C.green}44`,transition:"all 0.1s"}}>
                  {hovered&&<div onClick={e=>e.stopPropagation()} style={{position:"absolute",left:"50%",bottom:"calc(100% + 8px)",transform:"translateX(-50%)",background:C.text,color:"white",fontSize:11,padding:"4px 10px",borderRadius:5,whiteSpace:"nowrap",pointerEvents:"none",zIndex:20,boxShadow:"0 2px 8px rgba(0,0,0,0.15)"}}>
                    <span style={{fontWeight:600}}>{p.label}</span>
                    <span style={{opacity:0.7}}> · {fmtD(p.received_date)} · {fmtM(parseFloat(p.amount)||0)}</span>
                  </div>}
                </div>;
              })}
            </div>
          </div>
          {showProceeds&&<>
            {(proceeds||[]).map(p=>{
              const pctX = p.received_date ? datePct(p.received_date,pS,pE) : null;
              const active = drag?.kind==="proceed"&&drag.id===p.id;
              return (
                <div key={p.id} style={{display:"flex",alignItems:"center",height:32,borderTop:`1px solid ${C.divider}`,position:"relative",zIndex:0}}>
                  <div onClick={()=>setPeek({type:"proceed",id:p.id})} style={{width:LCOL,flexShrink:0,padding:"0 16px 0 36px",borderRight:`1px solid ${C.border}`,height:"100%",display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}
                    onMouseEnter={e=>{const s=e.currentTarget.querySelector('.pl');if(s)s.style.color=C.accent;}}
                    onMouseLeave={e=>{const s=e.currentTarget.querySelector('.pl');if(s)s.style.color=C.text;}}>
                    <div style={{width:6,height:6,borderRadius:"50%",background:C.green,flexShrink:0}}/>
                    <span className="pl" style={{fontSize:12,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{p.label}</span>
                    <span style={{fontSize:11,color:C.green,fontWeight:600,fontVariantNumeric:"tabular-nums",flexShrink:0}}>{fmtM(parseFloat(p.amount)||0)}</span>
                  </div>
                  <div style={{flex:1,position:"relative",height:"100%",display:"flex",alignItems:"center",overflow:"hidden"}}>
                    <Grid/>
                    {pctX!=null&&(
                      <>
                        <div onMouseDown={e=>onDownProceed(e,p.id)} style={{position:"absolute",left:`${pctX}%`,top:0,width:24,height:"100%",transform:"translateX(-50%)",cursor:"grab",zIndex:5,display:"flex",alignItems:"center",justifyContent:"center"}}>
                          <div style={{width:12,height:12,borderRadius:"50%",background:C.green,border:"2px solid white",boxShadow:active?`0 0 0 3px ${C.green}66`:"0 0 0 1px "+C.green+"44",opacity:active?0.7:1,pointerEvents:"none"}}/>
                        </div>
                        <div style={{position:"absolute",left:`${pctX}%`,top:1,transform:"translateX(-50%)",fontSize:9,color:C.green,fontWeight:600,whiteSpace:"nowrap",pointerEvents:"none",zIndex:4}}>{fmtD(p.received_date)}</div>
                      </>
                    )}
                    {pctX==null&&<span onMouseDown={e=>onDownProceed(e,p.id)} style={{position:"absolute",left:8,fontSize:9,color:C.faint,fontWeight:500,cursor:"grab"}}>no date · drag to place</span>}
                  </div>
                </div>
              );
            })}
          {/* Add proceed row */}
          {!showAddProceed&&(
            <div onClick={()=>setShowAddProceed(true)} style={{display:"flex",alignItems:"center",height:32,borderTop:`1px solid ${C.divider}`,cursor:"pointer"}}
              onMouseEnter={e=>e.currentTarget.style.background=C.hover} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <div style={{width:LCOL,flexShrink:0,padding:"0 16px 0 36px",borderRight:`1px solid ${C.border}`,height:"100%",display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:12,color:C.faint,fontWeight:500}}>+ Add proceed</span>
              </div>
              <div style={{flex:1,position:"relative",height:"100%"}}><Grid/></div>
            </div>
          )}
          {showAddProceed&&(
            <div style={{display:"flex",alignItems:"center",height:38,borderTop:`1px solid ${C.divider}`,background:C.bg}}>
              <div style={{width:LCOL,flexShrink:0,padding:"0 16px 0 36px",borderRight:`1px solid ${C.border}`,height:"100%",display:"flex",alignItems:"center",gap:6}}>
                <input autoFocus value={newProceed.label} onChange={e=>setNewProceed(f=>({...f,label:e.target.value}))} placeholder="Source / label"
                  style={{flex:1,border:`1px solid ${C.border}`,borderRadius:5,padding:"5px 10px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none",minWidth:0}}
                  onKeyDown={e=>{
                    if(e.key==="Escape"){setShowAddProceed(false);return;}
                    if(e.key==="Enter"&&newProceed.label.trim()&&newProceed.amount){
                      const row={label:newProceed.label.trim(),amount:parseFloat(newProceed.amount)||0,received_date:newProceed.received_date||null,notes:newProceed.type||""};
                      sbInsertRow("proceeds",row).then(rows=>{if(rows?.[0])setProceeds(prev=>[...prev,rows[0]]);setNewProceed({label:"",amount:"",received_date:TODAY,type:"contribution"});setShowAddProceed(false);}).catch(console.error);
                    }}}/>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:6,padding:"0 12px",flex:1}}>
                <div style={{display:"flex",alignItems:"center",gap:2}}>
                  <span style={{fontSize:11,color:C.muted}}>$</span>
                  <input value={newProceed.amount} onChange={e=>setNewProceed(f=>({...f,amount:e.target.value}))} placeholder="0" type="number"
                    style={{width:70,border:`1px solid ${C.border}`,borderRadius:4,padding:"4px 6px",fontSize:11,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}/>
                </div>
                <input type="date" value={newProceed.received_date} onChange={e=>setNewProceed(f=>({...f,received_date:e.target.value}))}
                  style={{border:`1px solid ${C.border}`,borderRadius:4,padding:"4px 6px",fontSize:11,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}/>
                <select value={newProceed.type} onChange={e=>setNewProceed(f=>({...f,type:e.target.value}))}
                  style={{border:`1px solid ${C.border}`,borderRadius:4,padding:"4px 6px",fontSize:11,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}>
                  <option value="contribution">Contribution</option>
                  <option value="paycheck">Paycheck</option>
                  <option value="sale">Property sale</option>
                  <option value="credit">Seller credit</option>
                  <option value="other">Other</option>
                </select>
                <button onClick={()=>{
                  if(!newProceed.label.trim()||!newProceed.amount) return;
                  const row={label:newProceed.label.trim(),amount:parseFloat(newProceed.amount)||0,received_date:newProceed.received_date||null,notes:newProceed.type||""};
                  sbInsertRow("proceeds",row).then(rows=>{if(rows?.[0])setProceeds(prev=>[...prev,rows[0]]);setNewProceed({label:"",amount:"",received_date:TODAY,type:"contribution"});setShowAddProceed(false);}).catch(console.error);
                }} style={{background:C.green,color:"white",border:"none",borderRadius:4,padding:"4px 10px",fontSize:11,fontWeight:600,cursor:"pointer"}}>Add</button>
                <button onClick={()=>setShowAddProceed(false)} style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:C.faint}}>Cancel</button>
              </div>
            </div>
          )}
          </>}
        </div>

        {/* ── Inline Cash Flow chart ─────────────────────────── */}
        <div style={{borderBottom:`2px solid ${C.border}`}}>
          <div style={{display:"flex",alignItems:"center",height:36,background:C.bg}}>
            <div onClick={()=>setShowCashFlow(s=>!s)} style={{width:LCOL,flexShrink:0,padding:"0 20px",borderRight:`1px solid ${C.border}`,height:"100%",display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}>
              <svg width="10" height="10" viewBox="0 0 10 10" style={{transform:showCashFlow?"rotate(90deg)":"rotate(0)",transition:"transform 0.15s"}}>
                <path d="M3 1.5L7 5L3 8.5" stroke={C.muted} strokeWidth="1.5" fill="none" strokeLinecap="round"/>
              </svg>
              <span style={{fontSize:12,fontWeight:600,color:C.text}}>Cash Flow</span>
            </div>
            <div style={{flex:1,display:"flex",alignItems:"center",gap:12,padding:"0 16px"}}>
              <span style={{fontSize:12,color:C.green,fontWeight:600,fontVariantNumeric:"tabular-nums"}}>In {fmtM(cfInNow)}</span>
              <span style={{fontSize:12,color:"#C0392B",fontWeight:600,fontVariantNumeric:"tabular-nums"}}>Out {fmtM(cfOutNow)}</span>
              <span style={{fontSize:12,color:cfInNow-cfOutNow>=0?C.green:"#C0392B",fontWeight:600,fontVariantNumeric:"tabular-nums"}}>Net {fmtM(cfInNow-cfOutNow)}</span>
              {showDrawdown&&<span style={{fontSize:12,color:ddBudgetNow>=0?C.accent:"#C0392B",fontWeight:600,fontVariantNumeric:"tabular-nums"}}>Budget bal {fmtM(ddBudgetNow)}</span>}
              <label onClick={e=>e.stopPropagation()} style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:5,cursor:"pointer",fontSize:11,color:showDrawdown?C.accent:C.muted,fontWeight:500}}>
                <input type="checkbox" checked={showDrawdown} onChange={e=>setShowDrawdown(e.target.checked)} style={{accentColor:C.accent,width:13,height:13,cursor:"pointer"}}/>
                Draw down
              </label>
            </div>
          </div>
          {showCashFlow&&(
            <div style={{display:"flex",height:160}}>
              <div style={{width:LCOL,flexShrink:0,borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",justifyContent:"space-between",padding:"10px 16px 10px 36px"}}>
                <span style={{fontSize:11,color:C.muted,fontWeight:500,fontVariantNumeric:"tabular-nums"}}>{cashFlow.yMax>=1000?`$${Math.round(cashFlow.yMax/1000)}k`:`$${Math.round(cashFlow.yMax)}`}</span>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:14,height:2.5,background:C.green,borderRadius:1,flexShrink:0}}/><span style={{fontSize:12,color:C.muted}}>Proceeds</span></div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:14,height:2.5,background:"#C0392B",borderRadius:1,flexShrink:0}}/><span style={{fontSize:12,color:C.muted}}>Actual</span></div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:14,height:2.5,background:C.muted,borderRadius:1,borderTop:"1.5px dashed",flexShrink:0}}/><span style={{fontSize:12,color:C.muted}}>Projected</span></div>
                  {showDrawdown&&<>
                    <div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:14,height:2.5,background:C.accent,borderRadius:1,flexShrink:0}}/><span style={{fontSize:12,color:C.muted}}>Balance</span></div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:14,height:2.5,background:C.accent,borderRadius:1,opacity:0.5,borderTop:"1.5px dashed",flexShrink:0}}/><span style={{fontSize:12,color:C.muted}}>Budget bal</span></div>
                  </>}
                </div>
                <span style={{fontSize:11,color:C.muted}}>$0</span>
              </div>
              <div style={{flex:1,position:"relative",overflow:"hidden"}}>
                {months.map(({pct},i)=><div key={i} style={{position:"absolute",left:`${pct}%`,top:0,bottom:0,width:1,background:C.divider,pointerEvents:"none"}}/>)}
                <div style={{position:"absolute",left:`${todayPct}%`,top:0,bottom:0,width:1.5,background:C.accent,opacity:0.8,pointerEvents:"none",zIndex:4}}/>
                <canvas ref={el=>{
                  if(!el) return;
                  const ctx=el.getContext("2d");
                  const w=el.parentElement.clientWidth, h=160;
                  el.width=w*2;el.height=h*2;ctx.scale(2,2);
                  el.style.width=w+"px";el.style.height=h+"px";
                  ctx.clearRect(0,0,w,h);
                  const sx=d=>((toMs(d)-toMs(pS))/(toMs(pE)-toMs(pS)))*w;
                  const yMax=cashFlow.yMax||1;
                  const sy=v=>h-(v/yMax)*h;
                  // Proceeds fill
                  ctx.beginPath();
                  ctx.moveTo(sx(cashFlow.cIn[0].date),h);
                  cashFlow.cIn.forEach((p,i)=>{
                    if(i>0) ctx.lineTo(sx(p.date),sy(cashFlow.cIn[i-1].val));
                    ctx.lineTo(sx(p.date),sy(p.val));
                  });
                  ctx.lineTo(sx(cashFlow.cIn[cashFlow.cIn.length-1].date),h);
                  ctx.closePath();
                  ctx.fillStyle="rgba(46,160,67,0.08)";ctx.fill();
                  // Step lines for cumulative flows
                  const drawStep=(series,color,lw,dash)=>{
                    ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=lw;ctx.setLineDash(dash||[]);
                    series.forEach((p,i)=>{
                      if(i===0){ctx.moveTo(sx(p.date),sy(p.val));}
                      else{ctx.lineTo(sx(p.date),sy(series[i-1].val));ctx.lineTo(sx(p.date),sy(p.val));}
                    });
                    ctx.stroke();ctx.setLineDash([]);
                  };
                  drawStep(cashFlow.cIn,C.green,2);
                  drawStep(cashFlow.cOut,"#C0392B",2);
                  drawStep(cashFlow.cProj,C.muted,1.5,[6,4]);
                  // Draw down overlay
                  if(showDrawdown){
                    const drawLine=(series,color,lw,dash)=>{
                      ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=lw;ctx.setLineDash(dash||[]);
                      series.forEach((p,i)=>{if(i===0)ctx.moveTo(sx(p.date),sy(p.val));else ctx.lineTo(sx(p.date),sy(p.val));});
                      ctx.stroke();ctx.setLineDash([]);
                    };
                    drawLine(cashFlow.ddActual,C.accent,2.5);
                    drawLine(cashFlow.ddBudget,C.accent,1.5,[6,4]);
                  }
                }} style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",pointerEvents:"none"}}/>
              </div>
            </div>
          )}
        </div>

        {/* ── Events rows ─────────────────────────────────────── */}
        <div style={{borderBottom:`1px solid ${C.border}`}}>
          <div onClick={()=>setShowEvents(s=>!s)} style={{display:"flex",alignItems:"center",height:36,background:C.bg,cursor:"pointer"}}>
            <div style={{width:LCOL,flexShrink:0,padding:"0 20px",borderRight:`1px solid ${C.border}`,height:"100%",display:"flex",alignItems:"center",gap:8}}>
              <svg width="10" height="10" viewBox="0 0 10 10" style={{transform:showEvents?"rotate(90deg)":"rotate(0)",transition:"transform 0.15s",flexShrink:0}}>
                <path d="M3 1.5L7 5L3 8.5" stroke={C.muted} strokeWidth="1.5" fill="none" strokeLinecap="round"/>
              </svg>
              <div style={{width:8,height:8,borderRadius:2,background:"#9B59B6",flexShrink:0}}/>
              <span style={{fontSize:12,fontWeight:600,color:C.text}}>Events</span>
              <span style={{fontSize:11,color:C.faint,marginLeft:"auto",flexShrink:0}}>{(events||[]).length}</span>
              {showEvents&&<>
                <button onClick={e=>{e.stopPropagation();sortEvents("date");}} title="Sort by date" style={{marginLeft:8,background:"none",border:`1px solid ${C.border}`,borderRadius:3,cursor:"pointer",padding:"1px 5px",fontSize:10,color:C.muted,lineHeight:1.4}}>&#8693;</button>
                <button onClick={e=>{e.stopPropagation();sortEvents("alpha");}} title="Sort A-Z" style={{background:"none",border:`1px solid ${C.border}`,borderRadius:3,cursor:"pointer",padding:"1px 5px",fontSize:10,color:C.muted,lineHeight:1.4}}>A&#8595;</button>
              </>}
            </div>
            <div style={{flex:1,position:"relative",height:"100%",display:"flex",alignItems:"center"}}>
              <Grid/>
              {!showEvents&&(events||[]).filter(ev=>ev.date).map(ev=>{
                const pctX=datePct(ev.date,pS,pE);
                const col=eventColor(ev.type);
                const hovered=hoverEventId===ev.id;
                return <div key={ev.id}
                  onClick={e=>e.stopPropagation()}
                  onMouseEnter={e=>{e.stopPropagation();setHoverEventId(ev.id);}}
                  onMouseLeave={e=>{e.stopPropagation();setHoverEventId(null);}}
                  style={{position:"absolute",left:`${pctX}%`,top:"50%",transform:"translate(-50%,-50%) rotate(45deg)",width:hovered?10:8,height:hovered?10:8,borderRadius:1.5,background:col,zIndex:hovered?10:3,border:"1.5px solid white",cursor:"default",boxShadow:hovered?`0 0 0 2px ${col}66`:`0 0 0 1px ${col}44`,transition:"all 0.1s"}}>
                  {hovered&&<div onClick={e=>e.stopPropagation()} style={{position:"absolute",left:"50%",bottom:"calc(100% + 8px)",transform:"translateX(-50%) rotate(-45deg)",background:C.text,color:"white",fontSize:11,padding:"4px 10px",borderRadius:5,whiteSpace:"nowrap",pointerEvents:"none",zIndex:20,boxShadow:"0 2px 8px rgba(0,0,0,0.15)"}}>
                    <span style={{fontWeight:600}}>{ev.title}</span>
                    <span style={{opacity:0.7}}> · {fmtD(ev.date)} · {eventLabel(ev.type)}</span>
                  </div>}
                </div>;
              })}
            </div>
          </div>
          {showEvents&&<>
          {(events||[]).map(ev=>{
            const pctX = ev.date ? datePct(ev.date,pS,pE) : null;
            const col = eventColor(ev.type);
            const active = drag?.kind==="event"&&drag.id===ev.id;
            return (
              <div key={ev.id} style={{display:"flex",alignItems:"center",height:32,borderTop:`1px solid ${C.divider}`,position:"relative",zIndex:0}}>
                <div onClick={()=>setPeek({type:"event",id:ev.id})} style={{width:LCOL,flexShrink:0,padding:"0 16px 0 36px",borderRight:`1px solid ${C.border}`,height:"100%",display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}
                  onMouseEnter={e=>{const s=e.currentTarget.querySelector('.el');if(s)s.style.color=C.accent;}}
                  onMouseLeave={e=>{const s=e.currentTarget.querySelector('.el');if(s)s.style.color=ev.done?C.faint:C.text;}}>
                  <div style={{width:7,height:7,borderRadius:1,background:col,flexShrink:0,transform:"rotate(45deg)"}}/>
                  <span className="el" style={{fontSize:12,color:ev.done?C.faint:C.text,textDecoration:ev.done?"line-through":"none",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{ev.title}</span>
                  <span style={{fontSize:10,color:col,fontWeight:500,flexShrink:0}}>{eventLabel(ev.type)}</span>
                </div>
                <div style={{flex:1,position:"relative",height:"100%",display:"flex",alignItems:"center",overflow:"hidden"}}>
                  <Grid/>
                  {pctX!=null&&(
                    <>
                      <div onMouseDown={e=>onDownEvent(e,ev.id)} style={{position:"absolute",left:`${pctX}%`,top:0,width:24,height:"100%",transform:"translateX(-50%)",cursor:"grab",zIndex:5,display:"flex",alignItems:"center",justifyContent:"center"}}>
                        <div style={{width:9,height:9,borderRadius:2,background:col,border:"2px solid white",boxShadow:active?`0 0 0 3px ${col}66`:`0 0 0 1px ${col}44`,opacity:active?0.7:1,pointerEvents:"none",transform:"rotate(45deg)"}}/>
                      </div>
                      <div style={{position:"absolute",left:`${pctX}%`,top:1,transform:"translateX(-50%)",fontSize:9,color:col,fontWeight:600,whiteSpace:"nowrap",pointerEvents:"none",zIndex:4}}>{fmtD(ev.date)}</div>
                    </>
                  )}
                  {pctX==null&&<span onMouseDown={e=>onDownEvent(e,ev.id)} style={{position:"absolute",left:8,fontSize:9,color:C.faint,fontWeight:500,cursor:"grab"}}>no date · drag to place</span>}
                </div>
              </div>
            );
          })}
          {/* Add event row */}
          {!showAddEvent&&(
            <div onClick={()=>setShowAddEvent(true)} style={{display:"flex",alignItems:"center",height:32,borderTop:`1px solid ${C.divider}`,cursor:"pointer"}}
              onMouseEnter={e=>e.currentTarget.style.background=C.hover} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <div style={{width:LCOL,flexShrink:0,padding:"0 16px 0 36px",borderRight:`1px solid ${C.border}`,height:"100%",display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:12,color:C.faint,fontWeight:500}}>+ Add event</span>
              </div>
              <div style={{flex:1,position:"relative",height:"100%"}}><Grid/></div>
            </div>
          )}
          {showAddEvent&&(
            <div style={{display:"flex",alignItems:"center",height:38,borderTop:`1px solid ${C.divider}`,background:C.bg}}>
              <div style={{width:LCOL,flexShrink:0,padding:"0 16px 0 36px",borderRight:`1px solid ${C.border}`,height:"100%",display:"flex",alignItems:"center",gap:6}}>
                <input autoFocus value={newEvent.title} onChange={e=>setNewEvent(f=>({...f,title:e.target.value}))} placeholder="Event title"
                  style={{flex:1,border:`1px solid ${C.border}`,borderRadius:5,padding:"5px 10px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none",minWidth:0}}
                  onKeyDown={e=>{
                    if(e.key==="Escape"){setShowAddEvent(false);return;}
                    if(e.key==="Enter"&&newEvent.title.trim()){
                      const row={title:newEvent.title.trim(),event_date:newEvent.event_date,event_type:newEvent.event_type,notes:"",done:false};
                      sbInsertRow("events",row).then(rows=>{if(rows?.[0])setEvents(prev=>[...prev,mapEvent(rows[0])]);setNewEvent({title:"",event_date:TODAY,event_type:"other"});setShowAddEvent(false);}).catch(console.error);
                    }}}/>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:6,padding:"0 12px",flex:1}}>
                <input type="date" value={newEvent.event_date} onChange={e=>setNewEvent(f=>({...f,event_date:e.target.value}))}
                  style={{border:`1px solid ${C.border}`,borderRadius:4,padding:"4px 6px",fontSize:11,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}/>
                <select value={newEvent.event_type} onChange={e=>setNewEvent(f=>({...f,event_type:e.target.value}))}
                  style={{border:`1px solid ${C.border}`,borderRadius:4,padding:"4px 6px",fontSize:11,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}>
                  {EVENT_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <button onClick={()=>{
                  if(!newEvent.title.trim()) return;
                  const row={title:newEvent.title.trim(),event_date:newEvent.event_date,event_type:newEvent.event_type,notes:"",done:false};
                  sbInsertRow("events",row).then(rows=>{if(rows?.[0])setEvents(prev=>[...prev,mapEvent(rows[0])]);setNewEvent({title:"",event_date:TODAY,event_type:"other"});setShowAddEvent(false);}).catch(console.error);
                }} style={{background:C.accent,color:"white",border:"none",borderRadius:4,padding:"4px 10px",fontSize:11,fontWeight:600,cursor:"pointer"}}>Add</button>
                <button onClick={()=>setShowAddEvent(false)} style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:C.faint}}>Cancel</button>
              </div>
            </div>
          )}
          </>}
        </div>

        {/* ── Task controls ────────────────────────────────────── */}
        <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 20px",background:C.bg,borderBottom:`1px solid ${C.border}`}}>
          <span style={{fontSize:11,color:C.muted,fontWeight:600,marginRight:2,textTransform:"uppercase",letterSpacing:"0.04em"}}>Group by</span>
          {[{id:"phase",label:"Project"},{id:"assignee",label:"Assignee"},{id:"all",label:"All"}].map(opt=>(
            <button key={opt.id} onClick={()=>setGroupBy(opt.id)} style={{
              padding:"5px 14px",fontSize:12,fontWeight:500,borderRadius:6,cursor:"pointer",
              border:`1px solid ${groupBy===opt.id?C.accent:C.border}`,
              background:groupBy===opt.id?C.accentBg:C.surface,
              color:groupBy===opt.id?C.accent:C.muted,
              transition:"all 0.15s",
            }}>{opt.label}</button>
          ))}
          <label style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer",fontSize:11,color:hideComplete?C.accent:C.muted,fontWeight:500,marginLeft:12}}>
            <input type="checkbox" checked={hideComplete} onChange={e=>setHideComplete(e.target.checked)} style={{accentColor:C.accent,width:13,height:13,cursor:"pointer"}}/>
            Hide done
          </label>
        </div>

        {/* ── Task groups ─────────────────────────────────────── */}
        {groups.map((grp,gi)=>(
          <div key={grp.key} style={{borderBottom:gi<groups.length-1?`1px solid ${C.border}`:"none"}}>
            {groupBy!=="all"&&(
              <div style={{display:"flex",alignItems:"center",height:40,background:C.bg,cursor:"pointer"}} onClick={()=>toggleGroup(grp.key)}>
                <div
                  style={{width:LCOL,flexShrink:0,padding:"0 20px",borderRight:`1px solid ${C.border}`,height:"100%",display:"flex",alignItems:"center",gap:9}}
                  onMouseEnter={e=>e.currentTarget.style.background=C.hover}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" style={{transform:collapsedGroups[grp.key]?"rotate(0)":"rotate(90deg)",transition:"transform 0.15s",flexShrink:0}}>
                    <path d="M3 1.5L7 5L3 8.5" stroke={C.muted} strokeWidth="1.5" fill="none" strokeLinecap="round"/>
                  </svg>
                  {grp.color
                    ? <div style={{width:8,height:8,borderRadius:2,background:grp.color,flexShrink:0}}/>
                    : <Avatar name={grp.label} size={20}/>
                  }
                  <span onClick={e=>{e.stopPropagation();if(grp.onHeaderClick)grp.onHeaderClick();}} style={{fontSize:13,fontWeight:600,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",cursor:grp.onHeaderClick?"pointer":"default"}}>{grp.label}</span>
                  <span style={{fontSize:11,color:C.faint,marginLeft:"auto",flexShrink:0}}>{grp.rows.length}</span>
                </div>
                <div style={{flex:1,position:"relative",height:"100%",display:"flex",alignItems:"center"}}>
                  <Grid/>
                  {grp.headerExtra()}
                </div>
              </div>
            )}

            {!collapsedGroups[grp.key]&&grp.rows.map(t=>{
              const undated=!t.start||!t.end;
              const dispStart=t.start||TODAY, dispEnd=t.end||addDays(TODAY,7);
              const tL=datePct(dispStart,pS,pE), tW=Math.max(datePct(dispEnd,pS,pE)-tL, undated?1.5:0.4);
              const done=t.status==="complete",active=drag?.id===t.id;
              const col=grp.taskColor(t);
              const indent = groupBy==="all" ? 16 : 30;
              const subs = tasks.filter(s=>s.parent_task_id===t.id);
              const hasSubs = subs.length>0;
              const isExp = expandedTlTasks.has(t.id);
              return (
                <Fragment key={t.id}>
                <div style={{display:"flex",alignItems:"center",height:34,borderTop:`1px solid ${C.divider}`}}>
                  <div style={{width:LCOL,flexShrink:0,padding:`0 16px 0 ${indent+6}px`,borderRight:`1px solid ${C.border}`,height:"100%",display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}
                    onMouseEnter={e=>e.currentTarget.querySelector('.tl-name').style.color=C.accent}
                    onMouseLeave={e=>e.currentTarget.querySelector('.tl-name').style.color=done?C.muted:undated?C.faint:C.text}>
                    {hasSubs?(
                      <button onClick={e=>{e.stopPropagation();toggleTlExpand(t.id);}} style={{background:"none",border:"none",cursor:"pointer",padding:0,display:"flex",alignItems:"center",flexShrink:0,width:14,justifyContent:"center"}}>
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{transform:isExp?"rotate(90deg)":"rotate(0deg)",transition:"transform 0.15s"}}><path d="M3 1.5l3.5 3.5-3.5 3.5" stroke={C.muted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </button>
                    ):(
                      <div onClick={()=>setPeek({type:"task",id:t.id})} style={{width:14,height:14,borderRadius:4,flexShrink:0,border:`1.5px solid ${done?C.accent:C.faint}`,background:done?C.accent:"transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>
                        {done&&<svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1.5 4L3.5 6L6.5 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </div>
                    )}
                    {groupBy!=="phase"&&<div style={{width:7,height:7,borderRadius:"50%",background:pc(t.project_id),flexShrink:0}}/>}
                    <span className="tl-name" onClick={()=>setPeek({type:"task",id:t.id})} style={{fontSize:12,color:done?C.muted:undated?C.faint:C.text,textDecoration:done?"line-through":"none",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</span>
                    {hasSubs&&<span style={{fontSize:10,color:C.faint}}>{subs.filter(s=>s.status==="complete").length}/{subs.length}</span>}
                    {groupBy==="phase"&&<Avatar name={t.assignee} size={16}/>}
                  </div>
                  <div style={{flex:1,position:"relative",height:"100%",display:"flex",alignItems:"center",overflow:"visible"}}>
                    <Grid/>
                    <div onMouseDown={e=>onDown(e,t.id,"move")}
                      onMouseEnter={()=>setHoverTaskId(t.id)} onMouseLeave={()=>setHoverTaskId(null)}
                      style={{
                      position:"absolute",left:`${tL}%`,width:`${tW}%`,height:20,
                      background:undated?"transparent":col,
                      border:undated?`1.5px dashed ${col}`:"none",
                      borderRadius:3,
                      opacity:active?0.65:(done?0.35:undated?0.7:0.8),
                      zIndex:hoverTaskId===t.id?3:2,display:"flex",alignItems:"center",paddingLeft:6,overflow:"hidden",
                      cursor:active&&drag?.type==="move"?"grabbing":"grab",
                      boxShadow:active?`0 0 0 2px ${col}44`:"none"
                    }}>
                      {!undated&&tW>5&&<span style={{fontSize:10,color:"white",fontWeight:600,whiteSpace:"nowrap",pointerEvents:"none"}}>{fmtD(t.start)}</span>}
                      {!undated&&(taskTotalAct(t,tasks)>0||taskTotalEst(t,tasks)>0)&&tW>10&&<span style={{fontSize:9,color:"rgba(255,255,255,0.8)",fontWeight:500,whiteSpace:"nowrap",pointerEvents:"none",marginLeft:"auto",paddingRight:14}}>{fmtM(taskTotalAct(t,tasks)>0?taskTotalAct(t,tasks):taskTotalEst(t,tasks))}</span>}
                      {undated&&<span style={{fontSize:10,color:col,fontWeight:600,whiteSpace:"nowrap",pointerEvents:"none",paddingLeft:2}}>no date</span>}
                      {!undated&&<div onMouseDown={e=>onDown(e,t.id,"resize")} style={{position:"absolute",right:0,top:0,bottom:0,width:8,cursor:"ew-resize",display:"flex",alignItems:"center",justifyContent:"center"}}>
                        <div style={{width:1.5,height:"50%",background:"rgba(255,255,255,0.6)",borderRadius:1}}/>
                      </div>}
                    </div>
                    {hoverTaskId===t.id&&!active&&(taskTotalEst(t,tasks)>0||taskTotalAct(t,tasks)>0)&&tW<=10&&(
                      <div style={{position:"absolute",left:`${tL+tW/2}%`,top:-6,transform:"translateX(-50%)",background:C.text,color:"white",fontSize:11,padding:"3px 10px",borderRadius:4,whiteSpace:"nowrap",pointerEvents:"none",zIndex:20,fontVariantNumeric:"tabular-nums",boxShadow:"0 2px 8px rgba(0,0,0,0.15)"}}>
                        {taskTotalAct(t,tasks)>0?`${fmtM(taskTotalAct(t,tasks))} actual`:`${fmtM(taskTotalEst(t,tasks))} est`}
                      </div>
                    )}
                    {active&&<div style={{position:"absolute",left:`${tL}%`,top:-26,background:C.text,color:"white",fontSize:11,padding:"3px 8px",borderRadius:4,whiteSpace:"nowrap",pointerEvents:"none",zIndex:20,fontVariantNumeric:"tabular-nums"}}>{fmtD(dispStart)} → {fmtD(dispEnd)} · {daysBetween(dispStart,dispEnd)}d</div>}
                  </div>
                </div>
                {isExp&&subs.map(st=>{
                  const sUndated=!st.start||!st.end;
                  const sStart=st.start||TODAY, sEnd=st.end||addDays(TODAY,3);
                  const sL=datePct(sStart,pS,pE), sW=Math.max(datePct(sEnd,pS,pE)-sL, sUndated?1:0.3);
                  const sDone=st.status==="complete";
                  return (
                    <div key={st.id} style={{display:"flex",alignItems:"center",height:28,borderTop:`1px solid ${C.divider}`,background:C.bg}}>
                      <div onClick={()=>setPeek({type:"task",id:st.id})} style={{width:LCOL,flexShrink:0,padding:`0 16px 0 ${indent+24}px`,borderRight:`1px solid ${C.border}`,height:"100%",display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}
                        onMouseEnter={e=>{const n=e.currentTarget.querySelector('.st-name');if(n)n.style.color=C.accent;}}
                        onMouseLeave={e=>{const n=e.currentTarget.querySelector('.st-name');if(n)n.style.color=sDone?C.muted:C.faint;}}>
                        <svg width="10" height="10" viewBox="0 0 10 10" style={{flexShrink:0,opacity:0.3}}><path d="M2 0v6h6" stroke={C.muted} strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>
                        <div style={{width:12,height:12,borderRadius:3,flexShrink:0,border:`1.5px solid ${sDone?C.green:C.faint}`,background:sDone?C.green:"transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>
                          {sDone&&<svg width="7" height="7" viewBox="0 0 8 8" fill="none"><path d="M1.5 4L3.5 6L6.5 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        </div>
                        <span className="st-name" style={{fontSize:11,color:sDone?C.muted:C.faint,textDecoration:sDone?"line-through":"none",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{st.title}</span>
                      </div>
                      <div style={{flex:1,position:"relative",height:"100%",display:"flex",alignItems:"center"}}>
                        <Grid/>
                        {!sUndated&&<div style={{position:"absolute",left:`${sL}%`,width:`${sW}%`,height:14,background:col,borderRadius:2,opacity:sDone?0.25:0.45}}/>}
                      </div>
                    </div>
                  );
                })}
                </Fragment>
              );
            })}
            {/* Add task row */}
            {!collapsedGroups[grp.key]&&addingTaskGroup!==grp.key&&(
              <div onClick={()=>{setAddingTaskGroup(grp.key);setNewTaskTitle("");}} style={{display:"flex",alignItems:"center",height:32,borderTop:`1px solid ${C.divider}`,cursor:"pointer"}}
                onMouseEnter={e=>e.currentTarget.style.background=C.hover} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <div style={{width:LCOL,flexShrink:0,padding:`0 16px 0 ${groupBy==="all"?22:36}px`,borderRight:`1px solid ${C.border}`,height:"100%",display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:12,color:C.faint,fontWeight:500}}>+ Add task</span>
                </div>
                <div style={{flex:1,position:"relative",height:"100%"}}><Grid/></div>
              </div>
            )}
            {!collapsedGroups[grp.key]&&addingTaskGroup===grp.key&&(
              <div style={{display:"flex",alignItems:"center",height:36,borderTop:`1px solid ${C.divider}`,background:C.bg}}>
                <div style={{width:LCOL,flexShrink:0,padding:`0 16px 0 ${groupBy==="all"?22:36}px`,borderRight:`1px solid ${C.border}`,height:"100%",display:"flex",alignItems:"center",gap:6}}>
                  <input autoFocus value={newTaskTitle} onChange={e=>setNewTaskTitle(e.target.value)} placeholder="Task title"
                    style={{flex:1,border:`1px solid ${C.border}`,borderRadius:5,padding:"5px 10px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none",minWidth:0}}
                    onKeyDown={e=>{
                      if(e.key==="Escape"){setAddingTaskGroup(null);return;}
                      if(e.key==="Enter"&&newTaskTitle.trim()){
                        const projectId = groupBy==="phase" ? parseInt(grp.key) : (projects[0]?.id||1);
                        const assignee = groupBy==="assignee" ? grp.key : "";
                        const row={title:newTaskTitle.trim(),phase_id:projectId,assignee,start_date:null,end_date:null,status:"todo",notes:"",sort_order:0};
                        sbInsertRow("tasks",row).then(rows=>{
                          if(rows?.[0]){const r=rows[0];setTasks(prev=>[...prev,{id:r.id,title:r.title,project_id:r.phase_id||projectId,assignee:r.assignee||assignee,start:r.start_date||null,end:r.end_date||null,status:r.status||"todo",notes:r.notes||"",price:0,actual_cost:0,photos:[],parent_task_id:null}]);}
                          setNewTaskTitle("");
                        }).catch(console.error);
                      }}}/>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:6,padding:"0 12px",flex:1}}>
                  <button onClick={()=>{
                    if(!newTaskTitle.trim()) return;
                    const projectId = groupBy==="phase" ? parseInt(grp.key) : (projects[0]?.id||1);
                    const assignee = groupBy==="assignee" ? grp.key : "";
                    const row={title:newTaskTitle.trim(),phase_id:projectId,assignee,start_date:null,end_date:null,status:"todo",notes:"",sort_order:0};
                    sbInsertRow("tasks",row).then(rows=>{
                      if(rows?.[0]){const r=rows[0];setTasks(prev=>[...prev,{id:r.id,title:r.title,project_id:r.phase_id||projectId,assignee:r.assignee||assignee,start:r.start_date||null,end:r.end_date||null,status:r.status||"todo",notes:r.notes||"",price:0,actual_cost:0,photos:[],parent_task_id:null}]);}
                      setNewTaskTitle("");
                    }).catch(console.error);
                  }} style={{background:C.accent,color:"white",border:"none",borderRadius:4,padding:"4px 10px",fontSize:11,fontWeight:600,cursor:"pointer"}}>Add</button>
                  <button onClick={()=>setAddingTaskGroup(null)} style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:C.faint}}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        ))}
        {/* Add project row (phase grouping only) */}
        {groupBy==="phase"&&!showAddProject&&(
          <div onClick={()=>{setShowAddProject(true);setNewProjectName("");}} style={{display:"flex",alignItems:"center",height:34,borderTop:`1px solid ${C.border}`,cursor:"pointer"}}
            onMouseEnter={e=>e.currentTarget.style.background=C.hover} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
            <div style={{width:LCOL,flexShrink:0,padding:"0 20px",borderRight:`1px solid ${C.border}`,height:"100%",display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:12,color:C.faint,fontWeight:500}}>+ Add project</span>
            </div>
            <div style={{flex:1,position:"relative",height:"100%"}}><Grid/></div>
          </div>
        )}
        {groupBy==="phase"&&showAddProject&&(
          <div style={{display:"flex",alignItems:"center",height:40,borderTop:`1px solid ${C.border}`,background:C.bg}}>
            <div style={{width:LCOL,flexShrink:0,padding:"0 20px",borderRight:`1px solid ${C.border}`,height:"100%",display:"flex",alignItems:"center",gap:6}}>
              <input autoFocus value={newProjectName} onChange={e=>setNewProjectName(e.target.value)} placeholder="Project name"
                style={{flex:1,border:`1px solid ${C.border}`,borderRadius:5,padding:"5px 10px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none",minWidth:0}}
                onKeyDown={e=>{
                  if(e.key==="Escape"){setShowAddProject(false);return;}
                  if(e.key==="Enter"&&newProjectName.trim()){
                    const dbProject={name:newProjectName.trim(),status:"planning",target_budget:0,contingency:0,start_date:PROJECT.start,end_date:PROJECT.end,notes:"",sort_order:projects.length};
                    sbInsertRow("projects",dbProject).then(rows=>{
                      if(rows?.[0]) setProjects(prev=>[...prev,mapProject(rows[0])]);
                      setNewProjectName("");setShowAddProject(false);
                    }).catch(console.error);
                  }}}/>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:6,padding:"0 12px",flex:1}}>
              <button onClick={()=>{
                if(!newProjectName.trim()) return;
                const dbProject={name:newProjectName.trim(),status:"planning",target_budget:0,contingency:0,start_date:PROJECT.start,end_date:PROJECT.end,notes:"",sort_order:projects.length};
                sbInsertRow("projects",dbProject).then(rows=>{
                  if(rows?.[0]) setProjects(prev=>[...prev,mapProject(rows[0])]);
                  setNewProjectName("");setShowAddProject(false);
                }).catch(console.error);
              }} style={{background:C.accent,color:"white",border:"none",borderRadius:4,padding:"4px 10px",fontSize:11,fontWeight:600,cursor:"pointer"}}>Add</button>
              <button onClick={()=>setShowAddProject(false)} style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:C.faint}}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Side peek panels ─────────────────────────────────── */}
      {peek?.type==="task"&&<PeekPanel taskId={peek.id} tasks={tasks} setTasks={setTasks} projects={projects} team={team} quotes={quotes} onClose={()=>setPeek(null)} onNavigate={onNavigate}/>}
      {peek?.type==="proceed"&&<ProceedPeek id={peek.id} proceeds={proceeds} setProceeds={setProceeds} onClose={()=>setPeek(null)}/>}
      {peek?.type==="event"&&<EventPeek id={peek.id} events={events} setEvents={setEvents} onClose={()=>setPeek(null)}/>}
      {peek?.type==="project"&&<ProjectPeek id={peek.id} projects={projects} setProjects={setProjects} tasks={tasks} expenses={expenses} onClose={()=>setPeek(null)} onNavigate={onNavigate}/>}
    </div>
  );
}

function PeekPanel({taskId,tasks,setTasks,projects,team,quotes,onClose,onNavigate}){
  const t=tasks.find(x=>x.id===taskId);
  const ph=t?projects.find(p=>p.id===t.project_id):null;
  const [dirty,setDirty]=useState(false);
  const [saved,setSaved]=useState(false);
  const [saving,setSaving]=useState(false);
  const savedTimer=useRef(null);

  const updateT=(fn)=>{setTasks(prev=>prev.map(x=>x.id===taskId?fn(x):x));setDirty(true);setSaved(false);};

  const save=()=>{
    const cur=tasks.find(x=>x.id===taskId);if(!cur)return;
    setSaving(true);
    sbPatch("tasks",taskId,{
      status:cur.status,assignee:cur.assignee||"",start_date:cur.start||null,end_date:cur.end||null,
      price:cur.price||0,actual_cost:cur.actual_cost||null,notes:cur.notes||"",materials:cur.materials||[],
    }).then(()=>{
      setDirty(false);setSaved(true);setSaving(false);
      if(savedTimer.current)clearTimeout(savedTimer.current);
      savedTimer.current=setTimeout(()=>setSaved(false),2000);
    }).catch(e=>{console.error(e);setSaving(false);});
  };

  if(!t) return null;
  return (
    <Fragment>
      <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.2)",zIndex:50}}/>
      <div style={{position:"fixed",top:0,right:0,bottom:0,width:480,background:C.bg,zIndex:51,boxShadow:"-4px 0 24px rgba(0,0,0,0.12)",display:"flex",flexDirection:"column",overflow:"hidden"}}>
        {/* Header */}
        <div style={{padding:"20px 24px 16px",borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div onClick={()=>{const ns=t.status==="complete"?"todo":"complete";updateT(x=>({...x,status:ns}));}}
                style={{width:22,height:22,borderRadius:6,border:`2px solid ${t.status==="complete"?C.green:C.faint}`,background:t.status==="complete"?C.green:"transparent",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}>
                {t.status==="complete"&&<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </div>
              <h3 style={{fontSize:16,fontWeight:700,color:C.text,margin:0}}>{t.title}</h3>
            </div>
            <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:C.muted,padding:"4px 8px"}}>✕</button>
          </div>
          {ph&&<div style={{display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:7,height:7,borderRadius:2,background:pc(ph.id)}}/>
            <span style={{fontSize:12,color:C.muted}}>{ph.name}</span>
          </div>}
        </div>
        {/* Body */}
        <div style={{flex:1,overflowY:"auto",padding:"20px 24px"}}>
          <div style={{marginBottom:20}}>
            <p style={{fontSize:11,color:C.muted,fontWeight:500,marginBottom:6}}>Status</p>
            <div style={{display:"flex",gap:4}}>
              {["todo","in_progress","complete"].map(s=>(
                <button key={s} onClick={()=>updateT(x=>({...x,status:s}))}
                  style={{padding:"5px 12px",fontSize:11,fontWeight:500,borderRadius:5,cursor:"pointer",border:`1px solid ${t.status===s?C.accent:C.border}`,background:t.status===s?C.accentBg:C.surface,color:t.status===s?C.accent:C.muted}}>
                  {s==="todo"?"To do":s==="in_progress"?"In progress":"Done"}
                </button>
              ))}
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"100px 1fr",gap:"12px 16px",marginBottom:20}}>
            <span style={{fontSize:11,color:C.muted,fontWeight:500,paddingTop:6}}>Assignee</span>
            <select value={t.assignee||""} onChange={e=>updateT(x=>({...x,assignee:e.target.value}))}
              style={{border:`1px solid ${C.border}`,borderRadius:5,padding:"6px 10px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}>
              <option value="">Unassigned</option>
              {(team||[]).map(m=><option key={m.id} value={m.name}>{m.name}</option>)}
            </select>
            <span style={{fontSize:11,color:C.muted,fontWeight:500,paddingTop:6}}>Start date</span>
            <input type="date" value={t.start||""} onChange={e=>updateT(x=>({...x,start:e.target.value}))}
              style={{border:`1px solid ${C.border}`,borderRadius:5,padding:"6px 10px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}/>
            <span style={{fontSize:11,color:C.muted,fontWeight:500,paddingTop:6}}>End date</span>
            <input type="date" value={t.end||""} onChange={e=>updateT(x=>({...x,end:e.target.value}))}
              style={{border:`1px solid ${C.border}`,borderRadius:5,padding:"6px 10px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}/>
            <span style={{fontSize:11,color:C.muted,fontWeight:500,paddingTop:6}}>Estimated</span>
            <div style={{display:"flex",alignItems:"center",gap:4}}>
              <span style={{fontSize:12,color:C.muted}}>$</span>
              <input type="number" value={t.price||""} onChange={e=>updateT(x=>({...x,price:parseFloat(e.target.value)||0}))}
                style={{flex:1,border:`1px solid ${C.border}`,borderRadius:5,padding:"6px 10px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}/>
            </div>
            <span style={{fontSize:11,color:C.muted,fontWeight:500,paddingTop:6}}>Actual cost</span>
            <div style={{display:"flex",alignItems:"center",gap:4}}>
              <span style={{fontSize:12,color:C.muted}}>$</span>
              <input type="number" value={t.actual_cost||""} onChange={e=>updateT(x=>({...x,actual_cost:parseFloat(e.target.value)||null}))}
                style={{flex:1,border:`1px solid ${C.border}`,borderRadius:5,padding:"6px 10px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}/>
            </div>
          </div>
          {t.price>0&&t.actual_cost>0&&(()=>{
            const v=t.price-t.actual_cost;
            return <div style={{padding:"8px 12px",borderRadius:6,background:v>=0?"#dff6dd":"#fde8e8",marginBottom:20,fontSize:12,fontWeight:600,color:v>=0?"#1a7f37":"#c33"}}>
              {v>=0?"Under":"Over"} budget by {fmtM(Math.abs(v))}
            </div>;
          })()}
          <div style={{marginBottom:20}}>
            <p style={{fontSize:11,color:C.muted,fontWeight:500,marginBottom:6}}>Notes</p>
            <textarea value={t.notes||""} onChange={e=>updateT(x=>({...x,notes:e.target.value}))}
              placeholder="Add notes..." rows={4}
              style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:5,padding:"8px 10px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none",resize:"vertical"}}/>
          </div>
          {/* Materials */}
          <div style={{marginBottom:20}}>
            <p style={{fontSize:11,color:C.muted,fontWeight:500,marginBottom:8}}>Materials</p>
            {(t.materials||[]).map((m,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
                <input value={m.name||""} placeholder="Item" onChange={e=>{const mats=[...(t.materials||[])];mats[i]={...mats[i],name:e.target.value};updateT(x=>({...x,materials:mats}));}}
                  style={{flex:1,border:`1px solid ${C.border}`,borderRadius:5,padding:"5px 8px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none",minWidth:0}}/>
                <input value={m.qty||""} placeholder="Qty" type="number" onChange={e=>{const mats=[...(t.materials||[])];mats[i]={...mats[i],qty:e.target.value};updateT(x=>({...x,materials:mats}));}}
                  style={{width:50,border:`1px solid ${C.border}`,borderRadius:5,padding:"5px 6px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none",textAlign:"center"}}/>
                <input value={m.unit||""} placeholder="Unit" onChange={e=>{const mats=[...(t.materials||[])];mats[i]={...mats[i],unit:e.target.value};updateT(x=>({...x,materials:mats}));}}
                  style={{width:50,border:`1px solid ${C.border}`,borderRadius:5,padding:"5px 6px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}/>
                <div style={{display:"flex",alignItems:"center",gap:2}}>
                  <span style={{fontSize:11,color:C.muted}}>$</span>
                  <input value={m.cost||""} placeholder="0" type="number" onChange={e=>{const mats=[...(t.materials||[])];mats[i]={...mats[i],cost:e.target.value};updateT(x=>({...x,materials:mats}));}}
                    style={{width:60,border:`1px solid ${C.border}`,borderRadius:5,padding:"5px 6px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}/>
                </div>
                <button onClick={()=>{const mats=[...(t.materials||[])];mats.splice(i,1);updateT(x=>({...x,materials:mats}));}}
                  style={{background:"none",border:"none",cursor:"pointer",fontSize:14,color:C.faint,padding:"2px 4px",lineHeight:1}}>×</button>
              </div>
            ))}
            {(t.materials||[]).length>0&&(()=>{
              const total=(t.materials||[]).reduce((s,m)=>s+(parseFloat(m.cost)||0)*(parseFloat(m.qty)||1),0);
              return total>0?<div style={{fontSize:11,color:C.muted,fontWeight:500,marginBottom:6,paddingLeft:2}}>Total: {fmtM(total)}</div>:null;
            })()}
            <button onClick={()=>updateT(x=>({...x,materials:[...(x.materials||[]),{name:"",qty:"",unit:"",cost:""}]}))}
              style={{fontSize:12,color:C.accent,background:"none",border:"none",cursor:"pointer",padding:0,fontWeight:500}}>+ Add material</button>
          </div>
          <div style={{display:"flex",gap:8}}>
            <Btn onClick={()=>{onClose();onNavigate("project",t.project_id,t.id);}}>Open full page</Btn>
          </div>
        </div>
        {/* Footer save bar */}
        <div style={{padding:"12px 24px",borderTop:`1px solid ${C.border}`,flexShrink:0,display:"flex",alignItems:"center",gap:10,background:C.surface}}>
          <button onClick={save} disabled={!dirty||saving}
            style={{padding:"8px 20px",fontSize:13,fontWeight:600,borderRadius:6,cursor:dirty?"pointer":"default",
              border:"none",background:dirty?C.accent:C.border,color:dirty?"white":C.muted,
              opacity:saving?0.6:1,transition:"all 0.15s"}}>
            {saving?"Saving...":"Save"}
          </button>
          {saved&&<span style={{fontSize:12,color:C.green,fontWeight:500,display:"flex",alignItems:"center",gap:4}}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 5" stroke={C.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Saved
          </span>}
          {dirty&&!saved&&<span style={{fontSize:11,color:C.muted}}>Unsaved changes</span>}
        </div>
      </div>
    </Fragment>
  );
}

function PeekShell({onClose,title,icon,color,children,footer}){
  return (
    <Fragment>
      <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.2)",zIndex:50}}/>
      <div style={{position:"fixed",top:0,right:0,bottom:0,width:480,background:C.bg,zIndex:51,boxShadow:"-4px 0 24px rgba(0,0,0,0.12)",display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{padding:"20px 24px 16px",borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              {icon}
              <h3 style={{fontSize:16,fontWeight:700,color:color||C.text,margin:0}}>{title}</h3>
            </div>
            <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:C.muted,padding:"4px 8px"}}>✕</button>
          </div>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"20px 24px"}}>{children}</div>
        {footer&&<div style={{padding:"12px 24px",borderTop:`1px solid ${C.border}`,flexShrink:0,display:"flex",alignItems:"center",gap:10,background:C.surface}}>{footer}</div>}
      </div>
    </Fragment>
  );
}

function ProceedPeek({id,proceeds,setProceeds,onClose}){
  const p=(proceeds||[]).find(x=>x.id===id);
  const [dirty,setDirty]=useState(false);
  const [saved,setSaved]=useState(false);
  const [saving,setSaving]=useState(false);
  const savedTimer=useRef(null);
  const update=(fn)=>{setProceeds(prev=>prev.map(x=>x.id===id?fn(x):x));setDirty(true);setSaved(false);};
  const save=()=>{
    const cur=(proceeds||[]).find(x=>x.id===id);if(!cur)return;
    setSaving(true);
    sbPatch("proceeds",id,{label:cur.label,amount:parseFloat(cur.amount)||0,received_date:cur.received_date||null,notes:cur.notes||""})
      .then(()=>{setDirty(false);setSaved(true);setSaving(false);if(savedTimer.current)clearTimeout(savedTimer.current);savedTimer.current=setTimeout(()=>setSaved(false),2000);})
      .catch(e=>{console.error(e);setSaving(false);});
  };
  if(!p) return null;
  return (
    <PeekShell onClose={onClose} title={p.label}
      icon={<div style={{width:10,height:10,borderRadius:"50%",background:C.green}}/>}
      color={C.green}
      footer={<>
        <button onClick={save} disabled={!dirty||saving} style={{padding:"8px 20px",fontSize:13,fontWeight:600,borderRadius:6,cursor:dirty?"pointer":"default",border:"none",background:dirty?C.accent:C.border,color:dirty?"white":C.muted,opacity:saving?0.6:1,transition:"all 0.15s"}}>{saving?"Saving...":"Save"}</button>
        {saved&&<span style={{fontSize:12,color:C.green,fontWeight:500}}>Saved</span>}
        {dirty&&!saved&&<span style={{fontSize:11,color:C.muted}}>Unsaved changes</span>}
      </>}>
      <div style={{display:"grid",gridTemplateColumns:"100px 1fr",gap:"12px 16px",marginBottom:20}}>
        <span style={{fontSize:11,color:C.muted,fontWeight:500,paddingTop:6}}>Label</span>
        <input value={p.label||""} onChange={e=>update(x=>({...x,label:e.target.value}))}
          style={{border:`1px solid ${C.border}`,borderRadius:5,padding:"6px 10px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}/>
        <span style={{fontSize:11,color:C.muted,fontWeight:500,paddingTop:6}}>Amount</span>
        <div style={{display:"flex",alignItems:"center",gap:4}}>
          <span style={{fontSize:12,color:C.muted}}>$</span>
          <input type="number" value={p.amount||""} onChange={e=>update(x=>({...x,amount:e.target.value}))}
            style={{flex:1,border:`1px solid ${C.border}`,borderRadius:5,padding:"6px 10px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}/>
        </div>
        <span style={{fontSize:11,color:C.muted,fontWeight:500,paddingTop:6}}>Date</span>
        <input type="date" value={p.received_date||""} onChange={e=>update(x=>({...x,received_date:e.target.value}))}
          style={{border:`1px solid ${C.border}`,borderRadius:5,padding:"6px 10px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}/>
        <span style={{fontSize:11,color:C.muted,fontWeight:500,paddingTop:6}}>Type</span>
        <span style={{fontSize:12,color:C.text,paddingTop:6}}>{p.notes||"—"}</span>
      </div>
      <div>
        <p style={{fontSize:11,color:C.muted,fontWeight:500,marginBottom:6}}>Notes</p>
        <textarea value={p.notes||""} onChange={e=>update(x=>({...x,notes:e.target.value}))} placeholder="Add notes..." rows={3}
          style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:5,padding:"8px 10px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none",resize:"vertical"}}/>
      </div>
    </PeekShell>
  );
}

function EventPeek({id,events,setEvents,onClose}){
  const ev=(events||[]).find(x=>x.id===id);
  const [dirty,setDirty]=useState(false);
  const [saved,setSaved]=useState(false);
  const [saving,setSaving]=useState(false);
  const savedTimer=useRef(null);
  const update=(fn)=>{setEvents(prev=>prev.map(x=>x.id===id?fn(x):x));setDirty(true);setSaved(false);};
  const save=()=>{
    const cur=(events||[]).find(x=>x.id===id);if(!cur)return;
    setSaving(true);
    sbPatch("events",id,{title:cur.title,event_date:cur.date||cur.event_date||null,event_type:cur.type||cur.event_type||"other",notes:cur.notes||"",done:!!cur.done})
      .then(()=>{setDirty(false);setSaved(true);setSaving(false);if(savedTimer.current)clearTimeout(savedTimer.current);savedTimer.current=setTimeout(()=>setSaved(false),2000);})
      .catch(e=>{console.error(e);setSaving(false);});
  };
  if(!ev) return null;
  const col=eventColor(ev.type);
  return (
    <PeekShell onClose={onClose} title={ev.title}
      icon={<div style={{width:10,height:10,borderRadius:2,background:col,transform:"rotate(45deg)"}}/>}
      color={col}
      footer={<>
        <button onClick={save} disabled={!dirty||saving} style={{padding:"8px 20px",fontSize:13,fontWeight:600,borderRadius:6,cursor:dirty?"pointer":"default",border:"none",background:dirty?C.accent:C.border,color:dirty?"white":C.muted,opacity:saving?0.6:1,transition:"all 0.15s"}}>{saving?"Saving...":"Save"}</button>
        {saved&&<span style={{fontSize:12,color:C.green,fontWeight:500}}>Saved</span>}
        {dirty&&!saved&&<span style={{fontSize:11,color:C.muted}}>Unsaved changes</span>}
      </>}>
      <div style={{marginBottom:20}}>
        <div onClick={()=>update(x=>({...x,done:!x.done}))}
          style={{display:"inline-flex",alignItems:"center",gap:8,padding:"6px 14px",borderRadius:6,cursor:"pointer",background:ev.done?C.greenBg:C.surface,border:`1px solid ${ev.done?C.green:C.border}`}}>
          <div style={{width:16,height:16,borderRadius:4,border:`2px solid ${ev.done?C.green:C.faint}`,background:ev.done?C.green:"transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>
            {ev.done&&<svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
          </div>
          <span style={{fontSize:12,fontWeight:500,color:ev.done?C.green:C.muted}}>{ev.done?"Done":"Mark done"}</span>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"100px 1fr",gap:"12px 16px",marginBottom:20}}>
        <span style={{fontSize:11,color:C.muted,fontWeight:500,paddingTop:6}}>Title</span>
        <input value={ev.title||""} onChange={e=>update(x=>({...x,title:e.target.value}))}
          style={{border:`1px solid ${C.border}`,borderRadius:5,padding:"6px 10px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}/>
        <span style={{fontSize:11,color:C.muted,fontWeight:500,paddingTop:6}}>Date</span>
        <input type="date" value={ev.date||""} onChange={e=>update(x=>({...x,date:e.target.value,event_date:e.target.value}))}
          style={{border:`1px solid ${C.border}`,borderRadius:5,padding:"6px 10px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}/>
        <span style={{fontSize:11,color:C.muted,fontWeight:500,paddingTop:6}}>Type</span>
        <select value={ev.type||"other"} onChange={e=>update(x=>({...x,type:e.target.value,event_type:e.target.value}))}
          style={{border:`1px solid ${C.border}`,borderRadius:5,padding:"6px 10px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}>
          {EVENT_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>
      <div>
        <p style={{fontSize:11,color:C.muted,fontWeight:500,marginBottom:6}}>Notes</p>
        <textarea value={ev.notes||""} onChange={e=>update(x=>({...x,notes:e.target.value}))} placeholder="Add notes..." rows={3}
          style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:5,padding:"8px 10px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none",resize:"vertical"}}/>
      </div>
    </PeekShell>
  );
}

function ProjectPeek({id,projects,setProjects,tasks,expenses,onClose,onNavigate}){
  const p=projects.find(x=>x.id===id);
  const [dirty,setDirty]=useState(false);
  const [saved,setSaved]=useState(false);
  const [saving,setSaving]=useState(false);
  const savedTimer=useRef(null);
  const update=(fn)=>{setProjects(prev=>prev.map(x=>x.id===id?fn(x):x));setDirty(true);setSaved(false);};
  const save=()=>{
    const cur=projects.find(x=>x.id===id);if(!cur)return;
    setSaving(true);
    sbPatch("projects",id,{name:cur.name,target_budget:cur.target_budget||0,start_date:cur.start||null,end_date:cur.end||null,status:cur.status||"planning",notes:cur.notes||""})
      .then(()=>{setDirty(false);setSaved(true);setSaving(false);if(savedTimer.current)clearTimeout(savedTimer.current);savedTimer.current=setTimeout(()=>setSaved(false),2000);})
      .catch(e=>{console.error(e);setSaving(false);});
  };
  if(!p) return null;
  const pTasks=tasks.filter(t=>t.project_id===id);
  const done=pTasks.filter(t=>t.status==="complete").length;
  const spent=expenses.filter(e=>e.phase_id===id).reduce((s,e)=>s+(e.amount||0),0);
  const taskCost=pTasks.reduce((s,t)=>s+(taskTotalAct(t,tasks)||taskTotalEst(t,tasks)||0),0);
  return (
    <PeekShell onClose={onClose} title={p.name}
      icon={<div style={{width:10,height:10,borderRadius:2,background:pc(id)}}/>}
      color={pc(id)}
      footer={<>
        <button onClick={save} disabled={!dirty||saving} style={{padding:"8px 20px",fontSize:13,fontWeight:600,borderRadius:6,cursor:dirty?"pointer":"default",border:"none",background:dirty?C.accent:C.border,color:dirty?"white":C.muted,opacity:saving?0.6:1,transition:"all 0.15s"}}>{saving?"Saving...":"Save"}</button>
        {saved&&<span style={{fontSize:12,color:C.green,fontWeight:500}}>Saved</span>}
        {dirty&&!saved&&<span style={{fontSize:11,color:C.muted}}>Unsaved changes</span>}
        <button onClick={()=>{onClose();onNavigate("project",id);}} style={{marginLeft:"auto",padding:"8px 16px",fontSize:12,fontWeight:500,borderRadius:6,cursor:"pointer",border:`1px solid ${C.border}`,background:C.surface,color:C.text}}>Open full page</button>
      </>}>
      {/* Summary */}
      <div style={{display:"flex",gap:12,marginBottom:20}}>
        <div style={{flex:1,padding:"10px 14px",borderRadius:6,background:C.surface,border:`1px solid ${C.border}`}}>
          <div style={{fontSize:10,color:C.muted,fontWeight:500,marginBottom:2}}>Tasks</div>
          <div style={{fontSize:16,fontWeight:700,color:C.text}}>{done}/{pTasks.length}</div>
        </div>
        <div style={{flex:1,padding:"10px 14px",borderRadius:6,background:C.surface,border:`1px solid ${C.border}`}}>
          <div style={{fontSize:10,color:C.muted,fontWeight:500,marginBottom:2}}>Budget</div>
          <div style={{fontSize:16,fontWeight:700,color:C.text}}>{fmtM(p.target_budget||0)}</div>
        </div>
        <div style={{flex:1,padding:"10px 14px",borderRadius:6,background:C.surface,border:`1px solid ${C.border}`}}>
          <div style={{fontSize:10,color:C.muted,fontWeight:500,marginBottom:2}}>Spent</div>
          <div style={{fontSize:16,fontWeight:700,color:spent>(p.target_budget||0)?"#C0392B":C.text}}>{fmtM(spent+taskCost)}</div>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"100px 1fr",gap:"12px 16px",marginBottom:20}}>
        <span style={{fontSize:11,color:C.muted,fontWeight:500,paddingTop:6}}>Name</span>
        <input value={p.name||""} onChange={e=>update(x=>({...x,name:e.target.value}))}
          style={{border:`1px solid ${C.border}`,borderRadius:5,padding:"6px 10px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}/>
        <span style={{fontSize:11,color:C.muted,fontWeight:500,paddingTop:6}}>Status</span>
        <select value={p.status||"planning"} onChange={e=>update(x=>({...x,status:e.target.value}))}
          style={{border:`1px solid ${C.border}`,borderRadius:5,padding:"6px 10px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}>
          {["planning","active","complete","on_hold"].map(s=><option key={s} value={s}>{s.replace("_"," ")}</option>)}
        </select>
        <span style={{fontSize:11,color:C.muted,fontWeight:500,paddingTop:6}}>Budget</span>
        <div style={{display:"flex",alignItems:"center",gap:4}}>
          <span style={{fontSize:12,color:C.muted}}>$</span>
          <input type="number" value={p.target_budget||""} onChange={e=>update(x=>({...x,target_budget:parseFloat(e.target.value)||0,budget:parseFloat(e.target.value)||0}))}
            style={{flex:1,border:`1px solid ${C.border}`,borderRadius:5,padding:"6px 10px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}/>
        </div>
        <span style={{fontSize:11,color:C.muted,fontWeight:500,paddingTop:6}}>Start</span>
        <input type="date" value={p.start||""} onChange={e=>update(x=>({...x,start:e.target.value}))}
          style={{border:`1px solid ${C.border}`,borderRadius:5,padding:"6px 10px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}/>
        <span style={{fontSize:11,color:C.muted,fontWeight:500,paddingTop:6}}>End</span>
        <input type="date" value={p.end||""} onChange={e=>update(x=>({...x,end:e.target.value}))}
          style={{border:`1px solid ${C.border}`,borderRadius:5,padding:"6px 10px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}/>
      </div>
      <div>
        <p style={{fontSize:11,color:C.muted,fontWeight:500,marginBottom:6}}>Notes</p>
        <textarea value={p.notes||""} onChange={e=>update(x=>({...x,notes:e.target.value}))} placeholder="Add notes..." rows={4}
          style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:5,padding:"8px 10px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none",resize:"vertical"}}/>
      </div>
    </PeekShell>
  );
}

// ── WEEKLY ─────────────────────────────────────────────────────────────────
function WeeklyView({tasks,setTasks,projects,onNavigate}) {
  const[dragId,setDragId]=useState(null);const[overWeek,setOverWeek]=useState(null);
  const grouped=useMemo(()=>{const sorted=[...tasks].sort((a,b)=>toMs(a.end)-toMs(b.end));const weeks={};sorted.forEach(t=>{const d=new Date(t.end+"T12:00:00");const mon=new Date(d);mon.setDate(d.getDate()-((d.getDay()+6)%7));const key=mon.toISOString().split("T")[0];if(!weeks[key])weeks[key]=[];weeks[key].push(t);});return Object.entries(weeks).sort(([a],[b])=>a.localeCompare(b));},[tasks]);
  const onDragStart=(e,id)=>{setDragId(id);const img=new Image();img.src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";e.dataTransfer.setDragImage(img,0,0);};
  const onDrop=ws=>{if(!dragId)return;const t=tasks.find(x=>x.id===dragId);if(!t||!t.start||!t.end)return;const dur=daysBetween(t.start,t.end);const ne=addDays(ws,5);setTasks(prev=>prev.map(x=>x.id===dragId?{...x,start:addDays(ne,-dur),end:ne}:x));setDragId(null);setOverWeek(null);};
  return (
    <div style={{padding:"32px 40px",userSelect:dragId?"none":"auto"}}>
      <div style={{display:"flex",alignItems:"baseline",gap:14,marginBottom:22}}><h2 style={{fontSize:18,fontWeight:700,color:C.text,letterSpacing:"-0.2px"}}>Weekly</h2><span style={{fontSize:12,color:C.muted}}>Drag to reschedule · click to open</span></div>
      {grouped.map(([ws,wt])=>{const d=new Date(ws+"T12:00:00");const we=new Date(d);we.setDate(d.getDate()+6);const isPast=we<new Date(TODAY+"T12:00:00");const isOver=overWeek===ws;
        return (
          <div key={ws} onDragOver={e=>{e.preventDefault();setOverWeek(ws);}} onDragLeave={()=>setOverWeek(null)} onDrop={()=>onDrop(ws)} style={{marginBottom:20}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8,padding:"5px 10px",background:isOver?C.accentBg:"transparent",borderRadius:6,border:isOver?`1px dashed ${C.accent}`:"1px dashed transparent",transition:"all 0.15s"}}>
              <span style={{fontSize:12,fontWeight:600,color:isPast?C.faint:C.text,fontVariantNumeric:"tabular-nums"}}>{d.toLocaleDateString("en-US",{month:"short",day:"numeric"})} — {we.toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span>
              {isOver&&dragId&&<span style={{fontSize:11,color:C.accent,fontWeight:600}}>Drop here</span>}
              <div style={{flex:1}}/><span style={{fontSize:11,color:C.muted}}>{wt.length} task{wt.length!==1?"s":""}</span>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:8,paddingLeft:10}}>
              {wt.map(t=>{const ph=projects.find(p=>p.id===t.project_id);const done=t.status==="complete";const isMe=dragId===t.id;
                return (
                  <div key={t.id} draggable onDragStart={e=>onDragStart(e,t.id)} onDragEnd={()=>{setDragId(null);setOverWeek(null);}} onClick={()=>onNavigate("project",t.project_id,t.id)}
                    style={{background:C.surface,border:`1px solid ${isMe?C.accent:C.border}`,borderRadius:6,padding:"10px 12px",display:"flex",gap:10,alignItems:"flex-start",cursor:"grab",opacity:isMe?0.35:1,transition:"opacity 0.15s,border-color 0.15s"}}
                    onMouseEnter={e=>!dragId&&(e.currentTarget.style.borderColor=C.faint)} onMouseLeave={e=>e.currentTarget.style.borderColor=isMe?C.accent:C.border}
                  >
                    <div style={{marginTop:1,width:14,height:14,borderRadius:3,flexShrink:0,border:`1.5px solid ${done?C.accent:C.faint}`,background:done?C.accent:"transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>{done&&<svg width="7" height="7" viewBox="0 0 8 8" fill="none"><path d="M1.5 4L3.5 6L6.5 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <p style={{fontSize:13,color:done?C.muted:C.text,textDecoration:done?"line-through":"none",lineHeight:1.35,marginBottom:5}}>{t.title}</p>
                      <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                        <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,color:C.muted}}><div style={{width:6,height:6,borderRadius:"50%",background:pc(t.project_id)}}/>{ph?.name}</span>
                        <Avatar name={t.assignee}/>
                        {t.photos.length>0&&<span style={{fontSize:11,color:C.muted}}>📷{t.photos.length}</span>}
                      </div>
                    </div>
                    <Chip status={t.status}/>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── QUOTES VIEW ───────────────────────────────────────────────────────────
function QuotesView({quotes, projects, tasks, setQuotes, setTasks, updateQuote, onNavigate}) {
  const [filterProject, setFilterProject] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [expandedId, setExpandedId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newForm, setNewForm] = useState({project_id:"", task_id:""});

  const filtered = useMemo(()=>{
    return quotes.filter(q=>{
      if(filterProject!=="all" && String(q.project_id)!==String(filterProject)) return false;
      if(filterStatus==="pending" && q.awarded_to) return false;
      if(filterStatus==="awarded" && !q.awarded_to) return false;
      return true;
    });
  },[quotes, filterProject, filterStatus]);

  const grouped = useMemo(()=>{
    return projects.map(p=>({
      key:p.id, label:p.name, color:pc(p.id),
      items:filtered.filter(q=>q.project_id===p.id),
    })).filter(g=>g.items.length>0);
  },[filtered, projects]);

  const newFormTasks = useMemo(()=>{
    if(!newForm.project_id) return [];
    return tasks.filter(t=>t.project_id===parseInt(newForm.project_id) && !t.parent_task_id);
  },[newForm.project_id, tasks]);

  const createQuote = () => {
    if(!newForm.project_id) return;
    const pid = parseInt(newForm.project_id);
    const tid = newForm.task_id ? parseInt(newForm.task_id) : null;
    const newQ = {
      id:uid(), project_id:pid, task_id:tid, awarded_to:null, notes:"",
      contractors:[
        {id:uid(),name:"Contractor 1",phone:"",email:"",sort_order:0},
        {id:uid(),name:"Contractor 2",phone:"",email:"",sort_order:1},
      ],
      items:[
        {id:uid(),label:"Labor",amounts:{}},
        {id:uid(),label:"Materials",amounts:{}},
      ],
    };
    updateQuote(null, null, newQ);
    setNewForm({project_id:"",task_id:""});
    setShowAdd(false);
  };

  const quoteTotal = (q, cId) => q.items.reduce((s,item)=>s+(item.amounts[cId]||0),0);
  const quoteTotalRange = (q) => {
    if(!q.contractors.length) return {min:0,max:0};
    const totals = q.contractors.map(c=>quoteTotal(q,c.id));
    return {min:Math.min(...totals), max:Math.max(...totals)};
  };

  const handleAward = (q, total) => {
    if(total!==null && q.task_id){
      setTasks(prev=>prev.map(t=>t.id===q.task_id?{...t,price:total}:t));
      sbPatch("tasks",q.task_id,{price:total}).catch(console.error);
    }
  };

  const deleteQuote = (id) => {
    setQuotes(prev=>prev.filter(q=>q.id!==id));
    sbDel("quotes", id).catch(console.error);
    if(expandedId===id) setExpandedId(null);
  };

  return (
    <div style={{padding:"32px 40px",maxWidth:1000}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
        <h2 style={{fontSize:18,fontWeight:700,color:C.text,letterSpacing:"-0.2px"}}>Quotes</h2>
        <Btn variant="primary" onClick={()=>setShowAdd(s=>!s)}>{showAdd?"Cancel":"+ New quote"}</Btn>
      </div>

      {/* Filters */}
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
        <div style={{display:"flex",gap:4}}>
          {[{v:"all",l:"All"},{v:"pending",l:"Pending"},{v:"awarded",l:"Awarded"}].map(f=>(
            <button key={f.v} onClick={()=>setFilterStatus(f.v)} style={{padding:"4px 10px",fontSize:11,fontWeight:500,borderRadius:5,cursor:"pointer",border:`1px solid ${filterStatus===f.v?C.accent:C.border}`,background:filterStatus===f.v?C.accentBg:C.surface,color:filterStatus===f.v?C.accent:C.muted}}>{f.l}</button>
          ))}
        </div>
        <select value={filterProject} onChange={e=>setFilterProject(e.target.value)}
          style={{border:`1px solid ${C.border}`,borderRadius:5,padding:"4px 10px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}>
          <option value="all">All projects</option>
          {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <span style={{fontSize:12,color:C.muted,marginLeft:4}}>{filtered.length} quote{filtered.length!==1?"s":""}</span>
      </div>

      {/* New quote form */}
      {showAdd&&(
        <div style={{border:`1px solid ${C.border}`,borderRadius:8,background:C.surface,padding:20,marginBottom:20}}>
          <p style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:14}}>New quote comparison</p>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
            <div>
              <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Project *</p>
              <select value={newForm.project_id} onChange={e=>setNewForm(f=>({...f,project_id:e.target.value,task_id:""}))}
                style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:5,padding:"7px 10px",fontSize:13,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}>
                <option value="">Select project…</option>
                {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Link to task (optional)</p>
              <select value={newForm.task_id} onChange={e=>setNewForm(f=>({...f,task_id:e.target.value}))}
                disabled={!newForm.project_id}
                style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:5,padding:"7px 10px",fontSize:13,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none",opacity:newForm.project_id?1:0.5}}>
                <option value="">No task — project level</option>
                {newFormTasks.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </div>
          </div>
          <p style={{fontSize:11,color:C.faint,marginBottom:12}}>Starts with 2 contractors and Labor/Materials line items. Add more after creating.</p>
          <div style={{display:"flex",gap:8}}>
            <Btn variant="primary" onClick={createQuote} style={{opacity:newForm.project_id?1:0.5}}>Create quote</Btn>
            <Btn onClick={()=>setShowAdd(false)}>Cancel</Btn>
          </div>
        </div>
      )}

      {/* Quote list grouped by project */}
      {grouped.map(grp=>(
        <div key={grp.key} style={{marginBottom:20}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
            <div style={{width:8,height:8,borderRadius:2,background:grp.color}}/>
            <span style={{fontSize:12,fontWeight:600,color:C.text,cursor:"pointer"}} onClick={()=>onNavigate("project",grp.key)}>{grp.label}</span>
            <span style={{fontSize:11,color:C.faint}}>{grp.items.length}</span>
          </div>
          <div style={{border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden",background:C.surface}}>
            {grp.items.map((q,qi)=>{
              const linkedTask = q.task_id ? tasks.find(t=>t.id===q.task_id) : null;
              const awardedContractor = q.awarded_to ? q.contractors.find(c=>c.id===q.awarded_to) : null;
              const awardedTotal = q.awarded_to ? quoteTotal(q, q.awarded_to) : 0;
              const range = quoteTotalRange(q);
              const isExpanded = expandedId===q.id;

              return (
                <div key={q.id} style={{borderBottom:qi<grp.items.length-1?`1px solid ${C.divider}`:"none"}}>
                  {/* Summary row */}
                  <div onClick={()=>setExpandedId(isExpanded?null:q.id)}
                    style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",cursor:"pointer"}}
                    onMouseEnter={e=>e.currentTarget.style.background=C.hover}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    {/* Expand indicator */}
                    <svg width="10" height="10" viewBox="0 0 10 10" style={{transform:isExpanded?"rotate(90deg)":"rotate(0)",transition:"transform 0.15s",flexShrink:0}}>
                      <path d="M3 1.5L7 5L3 8.5" stroke={C.muted} strokeWidth="1.5" fill="none" strokeLinecap="round"/>
                    </svg>
                    {/* Label */}
                    <div style={{flex:1,minWidth:0}}>
                      <p style={{fontSize:13,fontWeight:500,color:C.text}}>
                        {linkedTask ? linkedTask.title : "Project-level quote"}
                      </p>
                      <div style={{display:"flex",gap:8,marginTop:2,alignItems:"center"}}>
                        <span style={{fontSize:11,color:C.muted}}>{q.contractors.length} contractor{q.contractors.length!==1?"s":""}</span>
                        <span style={{fontSize:11,color:C.muted}}>·</span>
                        <span style={{fontSize:11,color:C.muted}}>{q.items.length} line item{q.items.length!==1?"s":""}</span>
                        {range.max>0&&<>
                          <span style={{fontSize:11,color:C.muted}}>·</span>
                          <span style={{fontSize:11,color:C.text,fontWeight:500,fontVariantNumeric:"tabular-nums"}}>{fmtM(range.min)} – {fmtM(range.max)}</span>
                        </>}
                      </div>
                    </div>
                    {/* Status */}
                    {awardedContractor ? (
                      <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                        <span style={{fontSize:11,color:C.green,background:C.greenBg,padding:"3px 10px",borderRadius:4,fontWeight:600}}>
                          ✓ {awardedContractor.name} · {fmtM(awardedTotal)}
                        </span>
                      </div>
                    ) : (
                      <span style={{fontSize:11,color:C.muted,background:C.bg,padding:"3px 10px",borderRadius:4,fontWeight:500,flexShrink:0}}>Pending</span>
                    )}
                    {/* Link indicator */}
                    {linkedTask&&<span style={{fontSize:10,color:C.faint,flexShrink:0}} title="Linked to task">🔗</span>}
                  </div>

                  {/* Expanded: full quote comparison */}
                  {isExpanded&&(
                    <div style={{padding:"0 16px 16px",borderTop:`1px solid ${C.divider}`}}>
                      <div style={{padding:"12px 0 8px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                        {/* Link/unlink task */}
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontSize:11,color:C.muted,fontWeight:500}}>Linked task:</span>
                          <select value={q.task_id||""} onChange={e=>{
                            const tid=e.target.value?parseInt(e.target.value):null;
                            setQuotes(prev=>prev.map(x=>x.id===q.id?{...x,task_id:tid}:x));
                            sbPatch("quotes",q.id,{task_id:tid}).catch(console.error);
                          }} style={{border:`1px solid ${C.border}`,borderRadius:5,padding:"4px 8px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}>
                            <option value="">None</option>
                            {tasks.filter(t=>t.project_id===q.project_id&&!t.parent_task_id).map(t=><option key={t.id} value={t.id}>{t.title}</option>)}
                          </select>
                        </div>
                        <Btn variant="danger" onClick={()=>deleteQuote(q.id)} style={{fontSize:11}}>Delete quote</Btn>
                      </div>
                      <QuoteComparison
                        quote={q}
                        phaseName={linkedTask?linkedTask.title:grp.label}
                        onUpdate={fn=>updateQuote(q.id,fn)}
                        onAward={total=>handleAward(q, total)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {filtered.length===0&&!showAdd&&(
        <div style={{border:`1px solid ${C.border}`,borderRadius:8,padding:40,textAlign:"center",color:C.muted,fontSize:13,background:C.surface}}>
          {quotes.length===0?"No quotes yet. Create your first one above.":"No quotes match this filter."}
        </div>
      )}
    </div>
  );
}

// ── CASH FLOW CHART ────────────────────────────────────────────────────────
function CashFlowChart({proceeds, tasks, projects, onNavigate}) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [chartW, setChartW] = useState(760);
  const [cursorDate, setCursorDate] = useState(TODAY);
  const [dragging, setDragging] = useState(false);

  // Responsive width
  useEffect(()=>{
    const el = containerRef.current; if(!el) return;
    const ro = new ResizeObserver(entries=>{
      for(const e of entries) setChartW(Math.max(400, e.contentRect.width));
    });
    ro.observe(el);
    return ()=>ro.disconnect();
  },[]);

  const pad = {top:28, right:24, bottom:44, left:68};
  const H = 280;
  const innerW = chartW - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  // Build unified timeline events sorted by date
  const {cashInSeries, cashOutSeries, projectedSeries, dateMin, dateMax, yMax, months} = useMemo(()=>{
    // Collect all dated events
    const ins = (proceeds||[]).filter(p=>p.received_date).map(p=>({date:p.received_date, amount:parseFloat(p.amount)||0, label:p.label})).sort((a,b)=>a.date.localeCompare(b.date));
    // Actual spend: tasks with actual_cost, placed at task end date
    const outs = tasks.filter(t=>t.actual_cost>0 && t.end).map(t=>({date:t.end, amount:t.actual_cost, label:t.title})).sort((a,b)=>a.date.localeCompare(b.date));
    // Projected spend: tasks with price, placed at task end date (includes future)
    const proj = tasks.filter(t=>t.price>0 && t.end).map(t=>({date:t.end, amount:t.price, label:t.title})).sort((a,b)=>a.date.localeCompare(b.date));

    // Date range: earliest event to latest event, padded by 30 days
    const allDates = [...ins.map(e=>e.date), ...outs.map(e=>e.date), ...proj.map(e=>e.date), TODAY];
    if(!allDates.length) return {cashInSeries:[],cashOutSeries:[],projectedSeries:[],dateMin:TODAY,dateMax:addDays(TODAY,180),yMax:1000,months:[]};
    const dMin = allDates.reduce((a,b)=>a<b?a:b);
    const dMax = addDays(allDates.reduce((a,b)=>a>b?a:b), 30);

    // Build cumulative step series
    const buildCum = (events) => {
      const pts = [{date:dMin, val:0}];
      let cum = 0;
      events.forEach(e=>{ cum += e.amount; pts.push({date:e.date, val:cum}); });
      pts.push({date:dMax, val:cum});
      return pts;
    };
    const cIn = buildCum(ins);
    const cOut = buildCum(outs);
    const cProj = buildCum(proj);

    const yM = Math.max(cIn[cIn.length-1].val, cProj[cProj.length-1].val, cOut[cOut.length-1].val, 1000) * 1.15;

    // Month ticks
    const ms = [];
    const s = new Date(dMin+"T12:00:00"), e = new Date(dMax+"T12:00:00");
    let c = new Date(s.getFullYear(), s.getMonth(), 1);
    while(c <= e) {
      const iso = `${c.getFullYear()}-${String(c.getMonth()+1).padStart(2,"0")}-01`;
      ms.push({label:c.toLocaleDateString("en-US",{month:"short"}), date:iso});
      c = new Date(c.getFullYear(), c.getMonth()+1, 1);
    }

    return {cashInSeries:cIn, cashOutSeries:cOut, projectedSeries:cProj, dateMin:dMin, dateMax:dMax, yMax:yM, months:ms};
  },[proceeds, tasks]);

  const sx = d => pad.left + ((toMs(d)-toMs(dateMin))/(toMs(dateMax)-toMs(dateMin))) * innerW;
  const sy = v => pad.top + innerH - (v/yMax)*innerH;
  const dateFromX = x => {
    const pct = Math.max(0, Math.min(1, (x - pad.left) / innerW));
    return toISO(toMs(dateMin) + pct * (toMs(dateMax)-toMs(dateMin)));
  };

  // Step path for cumulative series (horizontal then vertical)
  const stepPath = (series) => {
    if(!series.length) return "";
    let d = `M${sx(series[0].date)},${sy(series[0].val)}`;
    for(let i=1;i<series.length;i++){
      d += ` H${sx(series[i].date)} V${sy(series[i].val)}`;
    }
    return d;
  };

  // Area path (for fill)
  const stepArea = (series) => {
    if(!series.length) return "";
    let d = `M${sx(series[0].date)},${sy(0)}`;
    d += ` V${sy(series[0].val)}`;
    for(let i=1;i<series.length;i++){
      d += ` H${sx(series[i].date)} V${sy(series[i].val)}`;
    }
    d += ` V${sy(0)} Z`;
    return d;
  };

  // Interpolate cumulative value at a given date
  const valAt = (series, date) => {
    if(!series.length) return 0;
    for(let i=series.length-1; i>=0; i--){
      if(series[i].date <= date) return series[i].val;
    }
    return 0;
  };

  const cursorIn = valAt(cashInSeries, cursorDate);
  const cursorOut = valAt(cashOutSeries, cursorDate);
  const cursorProj = valAt(projectedSeries, cursorDate);
  const cursorNet = cursorIn - cursorOut;

  // Y-axis ticks
  const yTicks = useMemo(()=>{
    const step = Math.pow(10, Math.floor(Math.log10(yMax||1000)));
    const nice = yMax < step*2 ? step/2 : yMax < step*5 ? step : step*2;
    const ticks = [];
    for(let v=0; v<=yMax; v+=nice) ticks.push(v);
    return ticks;
  },[yMax]);

  // Drag handlers
  const onMouseDown = (e) => {
    e.preventDefault();
    setDragging(true);
    const rect = svgRef.current.getBoundingClientRect();
    setCursorDate(dateFromX(e.clientX - rect.left));
  };

  useEffect(()=>{
    if(!dragging) return;
    const mv = e => {
      const rect = svgRef.current?.getBoundingClientRect();
      if(rect) setCursorDate(dateFromX(e.clientX - rect.left));
    };
    const up = () => setDragging(false);
    window.addEventListener("mousemove", mv);
    window.addEventListener("mouseup", up);
    return ()=>{ window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); };
  },[dragging]);

  const cursorX = sx(cursorDate);

  return (
    <div>
      {/* Cursor readout */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:1,border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden",background:C.border,marginBottom:16}}>
        {[
          {l:fmtFull(cursorDate), v:"", sub:"cursor date", color:C.text, isDate:true},
          {l:"Cash In",        v:fmtM(cursorIn),   color:C.green},
          {l:"Cash Out",       v:fmtM(cursorOut),   color:"#C0392B"},
          {l:"Net Position",   v:fmtM(cursorNet),   color:cursorNet>=0?C.green:"#C0392B"},
          {l:"Projected Out",  v:fmtM(cursorProj),  color:C.muted},
        ].map(({l,v,sub,color,isDate})=>(
          <div key={l} style={{background:C.surface,padding:"12px 14px"}}>
            {isDate ? <>
              <p style={{fontSize:11,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>As of</p>
              <p style={{fontSize:16,fontWeight:700,color,fontVariantNumeric:"tabular-nums"}}>{l}</p>
              <p style={{fontSize:10,color:C.faint,marginTop:2}}>drag the chart to scrub</p>
            </> : <>
              <p style={{fontSize:11,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>{l}</p>
              <p style={{fontSize:16,fontWeight:700,color,fontVariantNumeric:"tabular-nums"}}>{v}</p>
            </>}
          </div>
        ))}
      </div>

      {/* SVG Chart */}
      <div ref={containerRef} style={{border:`1px solid ${C.border}`,borderRadius:8,background:C.surface,overflow:"hidden",cursor:dragging?"ew-resize":"crosshair",userSelect:"none"}}>
        <svg ref={svgRef} width={chartW} height={H} onMouseDown={onMouseDown} style={{display:"block"}}>
          {/* Y grid + labels */}
          {yTicks.map(v=>(
            <g key={v}>
              <line x1={pad.left} x2={chartW-pad.right} y1={sy(v)} y2={sy(v)} stroke={C.divider} strokeWidth={1}/>
              <text x={pad.left-8} y={sy(v)+4} textAnchor="end" fill={C.muted} fontSize={10} fontFamily="-apple-system,sans-serif">{v>=1000?`${Math.round(v/1000)}k`:v}</text>
            </g>
          ))}
          {/* Month grid + labels */}
          {months.map(m=>(
            <g key={m.date}>
              <line x1={sx(m.date)} x2={sx(m.date)} y1={pad.top} y2={H-pad.bottom} stroke={C.divider} strokeWidth={1}/>
              <text x={sx(m.date)+4} y={H-pad.bottom+16} fill={C.muted} fontSize={10} fontFamily="-apple-system,sans-serif">{m.label}</text>
            </g>
          ))}

          {/* Proceeds area (green fill) */}
          <path d={stepArea(cashInSeries)} fill={C.green} opacity={0.1}/>
          <path d={stepPath(cashInSeries)} fill="none" stroke={C.green} strokeWidth={2}/>

          {/* Actual spend line (red) */}
          <path d={stepPath(cashOutSeries)} fill="none" stroke="#C0392B" strokeWidth={2}/>

          {/* Projected spend line (dashed) */}
          <path d={stepPath(projectedSeries)} fill="none" stroke={C.muted} strokeWidth={1.5} strokeDasharray="6,4"/>

          {/* Today marker */}
          <line x1={sx(TODAY)} x2={sx(TODAY)} y1={pad.top} y2={H-pad.bottom} stroke={C.accent} strokeWidth={1.5} strokeDasharray="4,3" opacity={0.6}/>
          <text x={sx(TODAY)} y={pad.top-6} textAnchor="middle" fill={C.accent} fontSize={9} fontWeight="600" fontFamily="-apple-system,sans-serif">TODAY</text>

          {/* Cursor line */}
          <line x1={cursorX} x2={cursorX} y1={pad.top} y2={H-pad.bottom} stroke={C.text} strokeWidth={1.5} opacity={0.7}/>
          {/* Cursor handle */}
          <circle cx={cursorX} cy={pad.top} r={6} fill={C.text} stroke={C.surface} strokeWidth={2} style={{cursor:"ew-resize"}}/>
          {/* Intersection dots */}
          <circle cx={cursorX} cy={sy(cursorIn)} r={4} fill={C.green} stroke={C.surface} strokeWidth={1.5}/>
          <circle cx={cursorX} cy={sy(cursorOut)} r={4} fill="#C0392B" stroke={C.surface} strokeWidth={1.5}/>

          {/* Legend */}
          <g transform={`translate(${pad.left+8},${pad.top+8})`}>
            <line x1={0} x2={16} y1={0} y2={0} stroke={C.green} strokeWidth={2}/><text x={20} y={4} fill={C.muted} fontSize={10} fontFamily="-apple-system,sans-serif">Proceeds</text>
            <line x1={80} x2={96} y1={0} y2={0} stroke="#C0392B" strokeWidth={2}/><text x={100} y={4} fill={C.muted} fontSize={10} fontFamily="-apple-system,sans-serif">Actual</text>
            <line x1={148} x2={164} y1={0} y2={0} stroke={C.muted} strokeWidth={1.5} strokeDasharray="4,3"/><text x={168} y={4} fill={C.muted} fontSize={10} fontFamily="-apple-system,sans-serif">Projected</text>
          </g>
        </svg>
      </div>
    </div>
  );
}

// ── TASK BUDGET TABLE (P&L) ───────────────────────────────────────────────
function TaskBudgetTable({projects, phases, tasks, onNavigate}) {
  const [expandedProjects, setExpandedProjects] = useState(new Set());
  const toggleProject = id => setExpandedProjects(prev=>{const s=new Set(prev); s.has(id)?s.delete(id):s.add(id); return s;});

  // Group by phase → project → tasks
  const phaseGroups = useMemo(()=>{
    return phases.map(fa=>{
      const faProjects = projects.filter(p=>String(p.phase_id)===String(fa.id));
      const projRows = faProjects.map(p=>{
        const pTasks = tasks.filter(t=>t.project_id===p.id && !t.parent_task_id);
        const projected = pTasks.reduce((s,t)=>s+(taskTotalEst(t,tasks)||0),0) + (p.contingency||0);
        const actual = pTasks.reduce((s,t)=>s+(taskTotalAct(t,tasks)||0),0);
        return {project:p, tasks:pTasks, projected, actual, variance:projected-actual};
      });
      const totalProjected = projRows.reduce((s,r)=>s+r.projected,0);
      const totalActual = projRows.reduce((s,r)=>s+r.actual,0);
      return {phase:fa, projRows, totalProjected, totalActual, totalVariance:totalProjected-totalActual};
    });
  },[phases, projects, tasks]);

  const ungroupedProjects = projects.filter(p=>!p.phase_id||!phases.find(fa=>String(fa.id)===String(p.phase_id)));
  const ungroupedRows = ungroupedProjects.map(p=>{
    const pTasks = tasks.filter(t=>t.project_id===p.id && !t.parent_task_id);
    const projected = pTasks.reduce((s,t)=>s+(taskTotalEst(t,tasks)||0),0) + (p.contingency||0);
    const actual = pTasks.reduce((s,t)=>s+(taskTotalAct(t,tasks)||0),0);
    return {project:p, tasks:pTasks, projected, actual, variance:projected-actual};
  });

  const varColor = v => v>0?C.green:v<0?"#C0392B":C.muted;
  const varLabel = v => v>0?"Under":v<0?"Over":"On budget";

  const TH = ({children,align="left",width}) => (
    <th style={{padding:"8px 12px",textAlign:align,fontSize:10,fontWeight:600,color:C.muted,textTransform:"uppercase",letterSpacing:"0.06em",borderBottom:`1px solid ${C.border}`,background:C.bg,width}}>{children}</th>
  );

  const renderProjectBlock = (row, i, total) => {
    const expanded = expandedProjects.has(row.project.id);
    return (
      <tbody key={row.project.id}>
        {/* Project row */}
        <tr onClick={()=>toggleProject(row.project.id)} style={{cursor:"pointer"}}
          onMouseEnter={e=>e.currentTarget.style.background=C.hover}
          onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
          <td style={{padding:"10px 12px",borderBottom:`1px solid ${C.divider}`}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <svg width="10" height="10" viewBox="0 0 10 10" style={{transform:expanded?"rotate(90deg)":"rotate(0)",transition:"transform 0.15s",flexShrink:0}}>
                <path d="M3 1.5L7 5L3 8.5" stroke={C.muted} strokeWidth="1.5" fill="none" strokeLinecap="round"/>
              </svg>
              <div style={{width:7,height:7,borderRadius:2,background:pc(row.project.id),flexShrink:0}}/>
              <span style={{fontSize:13,fontWeight:600,color:C.text}}>{row.project.name}</span>
              <span style={{fontSize:11,color:C.faint,marginLeft:4}}>{row.tasks.length} tasks</span>
            </div>
          </td>
          <td style={{padding:"10px 12px",textAlign:"right",borderBottom:`1px solid ${C.divider}`,fontSize:13,fontWeight:600,color:C.text,fontVariantNumeric:"tabular-nums"}}>{row.projected>0?fmtM(row.projected):"—"}</td>
          <td style={{padding:"10px 12px",textAlign:"right",borderBottom:`1px solid ${C.divider}`,fontSize:13,fontWeight:600,color:row.actual>0?C.text:C.faint,fontVariantNumeric:"tabular-nums"}}>{row.actual>0?fmtM(row.actual):"—"}</td>
          <td style={{padding:"10px 12px",textAlign:"right",borderBottom:`1px solid ${C.divider}`,fontSize:13,fontWeight:600,color:varColor(row.variance),fontVariantNumeric:"tabular-nums"}}>{row.actual>0?(row.variance>=0?"+":"")+fmtM(row.variance):"—"}</td>
          <td style={{padding:"10px 12px",textAlign:"center",borderBottom:`1px solid ${C.divider}`}}>
            {row.actual>0&&<span style={{fontSize:10,fontWeight:600,color:varColor(row.variance),background:row.variance>=0?C.greenBg:"#FDF1F1",padding:"2px 8px",borderRadius:4}}>{varLabel(row.variance)}</span>}
          </td>
        </tr>
        {/* Task rows (expanded) */}
        {expanded&&row.tasks.map((t,ti)=>{
          const tv = (t.price||0)-(t.actual_cost||0);
          return (
            <tr key={t.id}
              onClick={()=>onNavigate("project",row.project.id,t.id)}
              style={{cursor:"pointer"}}
              onMouseEnter={e=>e.currentTarget.style.background=C.hover}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <td style={{padding:"8px 12px 8px 48px",borderBottom:`1px solid ${C.divider}`,fontSize:13,color:t.status==="complete"?C.muted:C.text,textDecoration:t.status==="complete"?"line-through":"none"}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:13,height:13,borderRadius:3,flexShrink:0,border:`1.5px solid ${t.status==="complete"?C.green:C.faint}`,background:t.status==="complete"?C.green:"transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>
                    {t.status==="complete"&&<svg width="7" height="7" viewBox="0 0 8 8" fill="none"><path d="M1.5 4L3.5 6L6.5 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </div>
                  {t.title}
                  {t.assignee&&<span style={{fontSize:11,color:C.faint,marginLeft:4}}>· {t.assignee}</span>}
                </div>
              </td>
              <td style={{padding:"8px 12px",textAlign:"right",borderBottom:`1px solid ${C.divider}`,fontSize:12,color:C.text,fontVariantNumeric:"tabular-nums"}}>{t.price>0?fmtM(t.price):"—"}</td>
              <td style={{padding:"8px 12px",textAlign:"right",borderBottom:`1px solid ${C.divider}`,fontSize:12,color:t.actual_cost>0?C.text:C.faint,fontVariantNumeric:"tabular-nums"}}>{t.actual_cost>0?fmtM(t.actual_cost):"—"}</td>
              <td style={{padding:"8px 12px",textAlign:"right",borderBottom:`1px solid ${C.divider}`,fontSize:12,color:t.actual_cost>0?varColor(tv):C.faint,fontVariantNumeric:"tabular-nums"}}>{t.actual_cost>0?(tv>=0?"+":"")+fmtM(tv):"—"}</td>
              <td style={{padding:"8px 12px",textAlign:"center",borderBottom:`1px solid ${C.divider}`}}>
                {t.actual_cost>0&&<span style={{fontSize:9,fontWeight:600,color:varColor(tv)}}>{varLabel(tv)}</span>}
              </td>
            </tr>
          );
        })}
        {/* Contingency row */}
        {expanded&&(row.project.contingency||0)>0&&(
          <tr>
            <td style={{padding:"8px 12px 8px 48px",borderBottom:`1px solid ${C.divider}`,fontSize:12,color:C.muted,fontStyle:"italic"}}>Contingency</td>
            <td style={{padding:"8px 12px",textAlign:"right",borderBottom:`1px solid ${C.divider}`,fontSize:12,color:C.muted,fontVariantNumeric:"tabular-nums"}}>{fmtM(row.project.contingency)}</td>
            <td style={{padding:"8px 12px",borderBottom:`1px solid ${C.divider}`}}/>
            <td style={{padding:"8px 12px",borderBottom:`1px solid ${C.divider}`}}/>
            <td style={{padding:"8px 12px",borderBottom:`1px solid ${C.divider}`}}/>
          </tr>
        )}
      </tbody>
    );
  };

  return (
    <div style={{border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden",background:C.surface}}>
      <table style={{width:"100%",borderCollapse:"collapse"}}>
        <thead>
          <tr>
            <TH width="40%">Item</TH>
            <TH align="right" width="15%">Estimated</TH>
            <TH align="right" width="15%">Actual</TH>
            <TH align="right" width="15%">Variance</TH>
            <TH align="center" width="15%">Status</TH>
          </tr>
        </thead>
        {phaseGroups.map(({phase,projRows,totalProjected,totalActual,totalVariance})=>(
          <Fragment key={phase.id}>
            {/* Phase header */}
            <tbody>
              <tr style={{background:C.bg}}>
                <td colSpan={5} style={{padding:"10px 12px",borderBottom:`1px solid ${C.border}`}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <div style={{width:8,height:8,borderRadius:2,background:C.phase[phases.indexOf(phase)%C.phase.length]}}/>
                    <span style={{fontSize:12,fontWeight:700,color:C.text,textTransform:"uppercase",letterSpacing:"0.04em"}}>{phase.name}</span>
                    <span style={{fontSize:11,color:C.muted,marginLeft:"auto",fontVariantNumeric:"tabular-nums"}}>
                      Est {fmtM(totalProjected)} · Actual {totalActual>0?fmtM(totalActual):"—"} · Var <span style={{color:varColor(totalVariance)}}>{totalActual>0?(totalVariance>=0?"+":"")+fmtM(totalVariance):"—"}</span>
                    </span>
                  </div>
                </td>
              </tr>
            </tbody>
            {projRows.map((r,i)=>renderProjectBlock(r,i,projRows.length))}
          </Fragment>
        ))}
        {ungroupedRows.length>0&&<>
          <tbody>
            <tr style={{background:C.bg}}>
              <td colSpan={5} style={{padding:"10px 12px",borderBottom:`1px solid ${C.border}`}}>
                <span style={{fontSize:12,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:"0.04em"}}>Unassigned</span>
              </td>
            </tr>
          </tbody>
          {ungroupedRows.map((r,i)=>renderProjectBlock(r,i,ungroupedRows.length))}
        </>}
        {/* Grand total */}
        <tbody>
          <tr style={{background:C.bg,borderTop:`2px solid ${C.border}`}}>
            <td style={{padding:"12px 12px",fontSize:14,fontWeight:700,color:C.text}}>Total</td>
            <td style={{padding:"12px 12px",textAlign:"right",fontSize:14,fontWeight:700,color:C.text,fontVariantNumeric:"tabular-nums"}}>{fmtM(phaseGroups.reduce((s,g)=>s+g.totalProjected,0)+ungroupedRows.reduce((s,r)=>s+r.projected,0))}</td>
            <td style={{padding:"12px 12px",textAlign:"right",fontSize:14,fontWeight:700,color:C.text,fontVariantNumeric:"tabular-nums"}}>{(()=>{const a=phaseGroups.reduce((s,g)=>s+g.totalActual,0)+ungroupedRows.reduce((s,r)=>s+r.actual,0);return a>0?fmtM(a):"—";})()}</td>
            <td style={{padding:"12px 12px",textAlign:"right",fontSize:14,fontWeight:700,fontVariantNumeric:"tabular-nums"}}>{(()=>{const a=phaseGroups.reduce((s,g)=>s+g.totalActual,0)+ungroupedRows.reduce((s,r)=>s+r.actual,0);if(!a)return"—";const v=phaseGroups.reduce((s,g)=>s+g.totalVariance,0)+ungroupedRows.reduce((s,r)=>s+r.variance,0);return <span style={{color:varColor(v)}}>{(v>=0?"+":"")+fmtM(v)}</span>;})()}</td>
            <td style={{padding:"12px 12px"}}/>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── TASKS GRID ────────────────────────────────────────────────────────────
function TasksGrid({tasks, setTasks, projects, setProjects, onNavigate, team, setTeam}) {
  const [filter, setFilter] = useState("all");
  const [groupBy, setGroupBy] = useState("project");
  const [addMode, setAddMode] = useState(null); // null | "single" | "dump"
  const [addForm, setAddForm] = useState({title:"",project_id:"",assignee:""});
  const [dumpText, setDumpText] = useState("");
  const [dumpProject, setDumpProject] = useState("");
  const [selected, setSelected] = useState(new Set()); // task ids for bulk edit
  const [bulkForm, setBulkForm] = useState({project_id:"",assignee:"",start:"",end:""});
  const [newProjectName, setNewProjectName] = useState("");
  const [showNewProject, setShowNewProject] = useState(false);
  const [newAssigneeName, setNewAssigneeName] = useState("");
  const [showNewAssignee, setShowNewAssignee] = useState(false);
  const addRef = useRef(null);
  const dumpRef = useRef(null);
  const newProjRef = useRef(null);
  const newAssignRef = useRef(null);

  const [expandedTasks, setExpandedTasks] = useState(new Set());
  const toggleExpand = id => setExpandedTasks(prev=>{const s=new Set(prev);if(s.has(id))s.delete(id);else s.add(id);return s;});
  const [bulkMode, setBulkMode] = useState(false);
  const toggleBulkMode = () => { setBulkMode(p=>!p); setSelected(new Set()); };

  // ── Drag & drop ──
  const [dragId, setDragId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // {type:"group",key} or {type:"task",id}
  const dragRef = useRef(null);

  const onDragStart = (e, taskId) => {
    setDragId(taskId);
    dragRef.current = taskId;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(taskId));
    requestAnimationFrame(()=>e.target.style.opacity="0.4");
  };
  const onDragEnd = (e) => {
    e.target.style.opacity="1";
    setDragId(null);
    setDropTarget(null);
    dragRef.current = null;
  };
  const onDropGroup = (e, groupKey) => {
    e.preventDefault();
    setDropTarget(null);
    const tid = dragRef.current;
    if(!tid) return;
    if(groupBy==="project"){
      const pid = groupKey==="none"?null:parseInt(groupKey);
      setTasks(prev=>prev.map(t=>t.id===tid?{...t,project_id:pid}:t));
      sbPatch("tasks",tid,{project_id:pid}).catch(console.error);
    } else if(groupBy==="assignee"){
      const assignee = groupKey==="Unassigned"||groupKey===""?"":groupKey;
      setTasks(prev=>prev.map(t=>t.id===tid?{...t,assignee}:t));
      sbPatch("tasks",tid,{assignee}).catch(console.error);
    } else if(groupBy==="status"){
      setTasks(prev=>prev.map(t=>t.id===tid?{...t,status:groupKey}:t));
      sbPatch("tasks",tid,{status:groupKey}).catch(console.error);
    }
  };
  const onDropTask = (e, targetId) => {
    e.preventDefault(); e.stopPropagation();
    setDropTarget(null);
    const tid = dragRef.current;
    if(!tid || tid===targetId) return;
    // make dragged task a subtask of the target
    const target = tasks.find(t=>t.id===targetId);
    if(!target || target.parent_task_id) return; // don't nest subtasks under subtasks
    setTasks(prev=>prev.map(t=>t.id===tid?{...t,parent_task_id:targetId,project_id:target.project_id}:t));
    sbPatch("tasks",tid,{parent_task_id:targetId,project_id:target.project_id}).catch(console.error);
  };

  useEffect(()=>{ if(addMode==="single" && addRef.current) addRef.current.focus(); },[addMode]);
  useEffect(()=>{ if(addMode==="dump" && dumpRef.current) dumpRef.current.focus(); },[addMode]);
  useEffect(()=>{ if(showNewProject && newProjRef.current) newProjRef.current.focus(); },[showNewProject]);
  useEffect(()=>{ if(showNewAssignee && newAssignRef.current) newAssignRef.current.focus(); },[showNewAssignee]);

  const filtered = tasks.filter(t=>{
    if(t.parent_task_id) return false;
    if(filter==="all") return true;
    return t.status===filter;
  });

  const groups = useMemo(()=>{
    if(groupBy==="project"){
      const grouped = projects.map(p=>({key:String(p.id), label:p.name, color:pc(p.id), items:filtered.filter(t=>t.project_id===p.id)})).filter(g=>g.items.length>0);
      const unassigned = filtered.filter(t=>!t.project_id);
      if(unassigned.length) grouped.push({key:"none",label:"No project",color:C.faint,items:unassigned});
      return grouped;
    }
    if(groupBy==="assignee"){
      const assignees=[...new Set(filtered.map(t=>t.assignee))].sort();
      return assignees.map(a=>({key:a, label:a||"Unassigned", color:null, items:filtered.filter(t=>t.assignee===a)}));
    }
    return [{key:"todo",label:"To do",color:C.faint,items:filtered.filter(t=>t.status==="todo")},
            {key:"in_progress",label:"In progress",color:C.accent,items:filtered.filter(t=>t.status==="in_progress")},
            {key:"complete",label:"Done",color:C.green,items:filtered.filter(t=>t.status==="complete")}].filter(g=>g.items.length>0);
  },[filtered,groupBy,projects]);

  const toggleDone = (id) => {
    setTasks(prev=>prev.map(t=>t.id===id?{...t,status:t.status==="complete"?"todo":"complete"}:t));
    const t=tasks.find(x=>x.id===id);
    if(t) sbPatch("tasks",id,{status:t.status==="complete"?"todo":"complete"}).catch(console.error);
  };

  const toggleSelect = (id) => setSelected(prev=>{const s=new Set(prev);if(s.has(id))s.delete(id);else s.add(id);return s;});
  const selectAll = () => {if(selected.size===filtered.length)setSelected(new Set());else setSelected(new Set(filtered.map(t=>t.id)));};

  // Single task add
  const submitAdd = async () => {
    const title = addForm.title.trim();
    if(!title) return;
    let projectId = addForm.project_id ? parseInt(addForm.project_id) : null;
    let assignee = addForm.assignee || "";
    if(showNewProject && newProjectName.trim()) {
      try {
        const rows = await sbInsertRow("projects",{name:newProjectName.trim(),status:"planning",target_budget:0,start_date:null,end_date:null,notes:"",sort_order:projects.length});
        if(rows?.[0]){const p=mapProject(rows[0]);setProjects(prev=>[...prev,p]);projectId=p.id;}
        setNewProjectName("");setShowNewProject(false);
      } catch(e){alert("Failed to create project: "+e.message);return;}
    }
    if(showNewAssignee && newAssigneeName.trim()) {
      try {
        const rows = await sbInsertRow("team_members",{name:newAssigneeName.trim()});
        if(rows?.[0]){setTeam(prev=>[...prev,rows[0]]);assignee=newAssigneeName.trim();}
        setNewAssigneeName("");setShowNewAssignee(false);
      } catch(e){console.error(e);}
    }
    const dbTask = {project_id:projectId, title, assignee, start_date:TODAY, end_date:TODAY, status:"todo", notes:"", sort_order:0};
    setAddForm({title:"",project_id:projectId?String(projectId):"",assignee:""});
    try {
      const rows = await sbInsertRow("tasks", dbTask);
      if(rows?.[0]) setTasks(prev=>[...prev, mapTask(rows[0])]);
    } catch(err){alert("Failed: "+err.message);}
  };

  // Brain dump — one task per line, no project required
  const submitDump = async () => {
    const lines = dumpText.split("\n").map(l=>l.trim()).filter(Boolean);
    if(!lines.length) return;
    const newTasks = [];
    for(const title of lines) {
      try {
        const rows = await sbInsertRow("tasks", {title, project_id:dumpProject?parseInt(dumpProject):null, assignee:"", start_date:TODAY, end_date:TODAY, status:"todo", notes:"", sort_order:0});
        if(rows?.[0]) newTasks.push(mapTask(rows[0]));
      } catch(e){console.error("Brain dump insert failed:",e);alert("Brain dump error: "+e.message);}
    }
    if(newTasks.length) {
      setTasks(prev=>[...prev,...newTasks]);
      // Auto-select the new tasks for bulk edit
      setSelected(new Set(newTasks.map(t=>t.id)));
    }
    setDumpText("");setDumpProject("");setAddMode(null);
  };

  // Bulk edit apply
  const applyBulk = () => {
    if(selected.size===0) return;
    const patch = {};
    if(bulkForm.project_id) patch.project_id = parseInt(bulkForm.project_id);
    if(bulkForm.assignee) patch.assignee = bulkForm.assignee;
    if(bulkForm.start) patch.start_date = bulkForm.start;
    if(bulkForm.end) patch.end_date = bulkForm.end;
    if(!Object.keys(patch).length) return;
    const localPatch = {};
    if(patch.project_id) localPatch.project_id = patch.project_id;
    if(patch.assignee !== undefined) localPatch.assignee = patch.assignee;
    if(patch.start_date) localPatch.start = patch.start_date;
    if(patch.end_date) localPatch.end = patch.end_date;
    setTasks(prev=>prev.map(t=>selected.has(t.id)?{...t,...localPatch}:t));
    selected.forEach(id=>sbPatch("tasks",id,patch).catch(console.error));
    setSelected(new Set());
    setBulkForm({project_id:"",assignee:"",start:"",end:""});
  };

  const bulkDelete = () => {
    if(!selected.size || !confirm(`Delete ${selected.size} task(s)?`)) return;
    setTasks(prev=>prev.filter(t=>!selected.has(t.id)));
    selected.forEach(id=>sbDel("tasks",id).catch(console.error));
    setSelected(new Set());
  };

  const inputSt = {border:`1px solid ${C.border}`,borderRadius:5,padding:"7px 10px",fontSize:13,color:C.text,background:C.bg,fontFamily:"inherit",outline:"none"};
  const selSt = {border:`1px solid ${C.border}`,borderRadius:5,padding:"7px 10px",fontSize:13,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"};

  return (
    <div style={{padding:"32px 40px",maxWidth:960}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
        <h2 style={{fontSize:18,fontWeight:700,color:C.text,letterSpacing:"-0.2px"}}>Tasks</h2>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{display:"flex",gap:4}}>
            {[{v:"all",l:"All"},{v:"todo",l:"To do"},{v:"in_progress",l:"Active"},{v:"complete",l:"Done"}].map(f=>(
              <button key={f.v} onClick={()=>setFilter(f.v)} style={{padding:"4px 10px",fontSize:11,fontWeight:500,borderRadius:5,cursor:"pointer",border:`1px solid ${filter===f.v?C.accent:C.border}`,background:filter===f.v?C.accentBg:C.surface,color:filter===f.v?C.accent:C.muted}}>{f.l}</button>
            ))}
          </div>
          <div style={{width:1,height:16,background:C.divider}}/>
          <div style={{display:"flex",alignItems:"center",gap:4}}>
            <span style={{fontSize:11,color:C.muted,fontWeight:500}}>Group</span>
            {[{v:"project",l:"Project"},{v:"assignee",l:"Assignee"},{v:"status",l:"Status"}].map(g=>(
              <button key={g.v} onClick={()=>setGroupBy(g.v)} style={{padding:"4px 10px",fontSize:11,fontWeight:500,borderRadius:5,cursor:"pointer",border:`1px solid ${groupBy===g.v?C.accent:C.border}`,background:groupBy===g.v?C.accentBg:C.surface,color:groupBy===g.v?C.accent:C.muted}}>{g.l}</button>
            ))}
          </div>
          <div style={{width:1,height:16,background:C.divider}}/>
          <Btn variant={addMode==="dump"?"primary":"default"} onClick={()=>setAddMode(m=>m==="dump"?null:"dump")}>Brain dump</Btn>
          <Btn variant={addMode==="single"?"primary":"default"} onClick={()=>setAddMode(m=>m==="single"?null:"single")}>{addMode==="single"?"Cancel":"+ Add task"}</Btn>
        </div>
      </div>

      {/* Brain dump textarea */}
      {addMode==="dump"&&(
        <div style={{border:`1px solid ${C.accent}`,borderRadius:8,background:C.surface,padding:16,marginBottom:16}}>
          <p style={{fontSize:12,fontWeight:600,color:C.text,marginBottom:6}}>Brain dump</p>
          <p style={{fontSize:11,color:C.muted,marginBottom:10}}>Type one task per line. Assign a project now or leave uncategorized.</p>
          <div style={{marginBottom:10}}>
            <select value={dumpProject} onChange={e=>setDumpProject(e.target.value)}
              style={{border:`1px solid ${C.border}`,borderRadius:5,padding:"6px 10px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none",appearance:"none",minWidth:200}}>
              <option value="">No project (uncategorized)</option>
              {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <textarea ref={dumpRef} value={dumpText} onChange={e=>setDumpText(e.target.value)}
            placeholder={"Buy drywall\nSchedule electrician\nGet permit for plumbing\nOrder kitchen cabinets\nCall roofer for quote"}
            rows={8}
            style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:5,padding:"10px 12px",fontSize:13,color:C.text,background:C.bg,fontFamily:"inherit",outline:"none",resize:"vertical",lineHeight:"1.7"}}
            onFocus={e=>e.target.style.borderColor=C.accent} onBlur={e=>e.target.style.borderColor=C.border}/>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:10}}>
            <span style={{fontSize:11,color:C.muted}}>{dumpText.split("\n").filter(l=>l.trim()).length} task(s)</span>
            <div style={{display:"flex",gap:8}}>
              <Btn onClick={()=>{setDumpText("");setAddMode(null);}}>Cancel</Btn>
              <Btn variant="primary" onClick={submitDump}>Create all</Btn>
            </div>
          </div>
        </div>
      )}

      {/* Single task add form */}
      {addMode==="single"&&(
        <div style={{border:`1px solid ${C.border}`,borderRadius:8,background:C.surface,padding:16,marginBottom:16}}>
          <div style={{display:"flex",alignItems:"flex-end",gap:10}}>
            <div style={{flex:1}}>
              <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Task name</p>
              <input ref={addRef} value={addForm.title} onChange={e=>setAddForm(f=>({...f,title:e.target.value}))}
                placeholder="What needs to be done?"
                onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();submitAdd();}if(e.key==="Escape")setAddMode(null);}}
                style={{...inputSt,width:"100%"}}
                onFocus={e=>e.target.style.borderColor=C.accent} onBlur={e=>e.target.style.borderColor=C.border}/>
            </div>
            <div style={{width:180}}>
              <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Project</p>
              {showNewProject ? (
                <div style={{display:"flex",gap:4}}>
                  <input ref={newProjRef} value={newProjectName} onChange={e=>setNewProjectName(e.target.value)}
                    placeholder="New project name"
                    onKeyDown={e=>{
                      if(e.key==="Enter"){
                        e.preventDefault();
                        const name=newProjectName.trim(); if(!name){setShowNewProject(false);return;}
                        sbInsertRow("projects",{name,status:"planning",target_budget:0,start_date:null,end_date:null,notes:"",sort_order:projects.length}).then(rows=>{
                          if(rows?.[0]){const p=mapProject(rows[0]);setProjects(prev=>[...prev,p]);setAddForm(f=>({...f,project_id:String(p.id)}));}
                          setNewProjectName("");setShowNewProject(false);
                        }).catch(console.error);
                      }
                      if(e.key==="Escape"){setShowNewProject(false);setNewProjectName("");}
                    }}
                    style={{flex:1,border:`1px solid ${C.accent}`,borderRadius:5,padding:"7px 8px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}/>
                  <button onClick={()=>{setShowNewProject(false);setNewProjectName("");}} style={{background:"none",border:"none",cursor:"pointer",color:C.faint,fontSize:14}}>✕</button>
                </div>
              ) : (
                <select value={addForm.project_id} onChange={e=>{
                  if(e.target.value==="__new__"){setShowNewProject(true);return;}
                  setAddForm(f=>({...f,project_id:e.target.value}));
                }} style={{...selSt,width:"100%"}}>
                  <option value="">None</option>
                  {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                  <option value="__new__">+ Create new project</option>
                </select>
              )}
            </div>
            <div style={{width:160}}>
              <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Assignee</p>
              {showNewAssignee ? (
                <div style={{display:"flex",gap:4}}>
                  <input ref={newAssignRef} value={newAssigneeName} onChange={e=>setNewAssigneeName(e.target.value)}
                    placeholder="Name"
                    onKeyDown={e=>{
                      if(e.key==="Enter"){
                        e.preventDefault();
                        const name=newAssigneeName.trim(); if(!name){setShowNewAssignee(false);return;}
                        sbInsertRow("team_members",{name}).then(rows=>{
                          if(rows?.[0]){setTeam(prev=>[...prev,rows[0]]);setAddForm(f=>({...f,assignee:name}));}
                          setNewAssigneeName("");setShowNewAssignee(false);
                        }).catch(console.error);
                      }
                      if(e.key==="Escape"){setShowNewAssignee(false);setNewAssigneeName("");}
                    }}
                    style={{flex:1,border:`1px solid ${C.accent}`,borderRadius:5,padding:"7px 8px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}/>
                  <button onClick={()=>{setShowNewAssignee(false);setNewAssigneeName("");}} style={{background:"none",border:"none",cursor:"pointer",color:C.faint,fontSize:14}}>✕</button>
                </div>
              ) : (
                <select value={addForm.assignee} onChange={e=>{
                  if(e.target.value==="__new__"){setShowNewAssignee(true);return;}
                  setAddForm(f=>({...f,assignee:e.target.value}));
                }} style={{...selSt,width:"100%"}}>
                  <option value="">None</option>
                  {(team||[]).map(m=><option key={m.id} value={m.name}>{m.name}</option>)}
                  <option value="__new__">+ Add team member</option>
                </select>
              )}
            </div>
            <Btn variant="primary" onClick={submitAdd}>Add</Btn>
          </div>
        </div>
      )}

      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
        <p style={{fontSize:12,color:C.muted}}>
          {bulkMode&&selected.size>0
            ? `${selected.size} of ${filtered.length} selected`
            : `${filtered.length} task${filtered.length!==1?"s":""}`}
        </p>
        <button onClick={toggleBulkMode}
          style={{fontSize:11,fontWeight:500,padding:"3px 10px",borderRadius:5,cursor:"pointer",
            border:`1px solid ${bulkMode?C.accent:C.border}`,background:bulkMode?C.accentBg:"transparent",color:bulkMode?C.accent:C.muted}}>
          {bulkMode?"Exit bulk edit":"Bulk edit"}
        </button>
        {bulkMode&&filtered.length>0&&(
          <button onClick={selectAll} style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:C.accent,fontWeight:500}}>
            {selected.size===filtered.length?"Deselect all":"Select all"}
          </button>
        )}
      </div>

      {/* Bulk edit bar */}
      {bulkMode&&selected.size>0&&(
        <div style={{position:"sticky",top:0,zIndex:10,border:`1px solid ${C.accent}`,borderRadius:8,background:C.accentBg,padding:"12px 16px",marginBottom:16,display:"flex",alignItems:"flex-end",gap:10,flexWrap:"wrap"}}>
          <div style={{fontSize:13,fontWeight:600,color:C.accent,display:"flex",alignItems:"center",gap:6,minWidth:100}}>
            <span style={{background:C.accent,color:"#fff",borderRadius:10,padding:"2px 8px",fontSize:11,fontWeight:700}}>{selected.size}</span> selected
          </div>
          <div>
            <p style={{fontSize:10,color:C.muted,marginBottom:3,fontWeight:500}}>Project</p>
            <select value={bulkForm.project_id} onChange={e=>setBulkForm(f=>({...f,project_id:e.target.value}))}
              style={{...selSt,width:160,fontSize:12,padding:"5px 8px"}}>
              <option value="">— keep —</option>
              {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <p style={{fontSize:10,color:C.muted,marginBottom:3,fontWeight:500}}>Assignee</p>
            <select value={bulkForm.assignee} onChange={e=>setBulkForm(f=>({...f,assignee:e.target.value}))}
              style={{...selSt,width:140,fontSize:12,padding:"5px 8px"}}>
              <option value="">— keep —</option>
              {(team||[]).map(m=><option key={m.id} value={m.name}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <p style={{fontSize:10,color:C.muted,marginBottom:3,fontWeight:500}}>Start</p>
            <input type="date" value={bulkForm.start} onChange={e=>setBulkForm(f=>({...f,start:e.target.value}))}
              style={{...inputSt,width:130,fontSize:12,padding:"5px 8px"}}/>
          </div>
          <div>
            <p style={{fontSize:10,color:C.muted,marginBottom:3,fontWeight:500}}>End</p>
            <input type="date" value={bulkForm.end} onChange={e=>setBulkForm(f=>({...f,end:e.target.value}))}
              style={{...inputSt,width:130,fontSize:12,padding:"5px 8px"}}/>
          </div>
          <Btn variant="primary" onClick={applyBulk}>Apply</Btn>
          <button onClick={bulkDelete} style={{padding:"5px 10px",fontSize:11,fontWeight:500,borderRadius:5,cursor:"pointer",border:`1px solid #e5a0a0`,background:"#fef2f2",color:"#c33"}}>Delete</button>
          <button onClick={()=>setSelected(new Set())} style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:C.muted,textDecoration:"underline"}}>Clear</button>
        </div>
      )}

      {groups.map(grp=>{
        const isGroupDrop = dropTarget?.type==="group"&&dropTarget.key===grp.key;
        return (
        <div key={grp.key} style={{marginBottom:20}}
          onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect="move";setDropTarget({type:"group",key:grp.key});}}
          onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setDropTarget(prev=>prev?.type==="group"&&prev.key===grp.key?null:prev);}}
          onDrop={e=>onDropGroup(e,grp.key)}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
            {grp.color ? <div style={{width:8,height:8,borderRadius:2,background:grp.color}}/> : <Avatar name={grp.label} size={18}/>}
            <span style={{fontSize:12,fontWeight:600,color:C.text}}>{grp.label}</span>
            <span style={{fontSize:11,color:C.faint}}>{grp.items.length}</span>
          </div>
          <div style={{border:`1px solid ${isGroupDrop&&dragId?C.accent:C.border}`,borderRadius:8,overflow:"hidden",background:C.surface,transition:"border-color 0.15s"}}>
            {grp.items.map((t,i)=>{
              const ph=projects.find(p=>p.id===t.project_id);
              const isSel=selected.has(t.id);
              const isTaskDrop = dropTarget?.type==="task"&&dropTarget.id===t.id&&dragId!==t.id;
              const subs = tasks.filter(s=>s.parent_task_id===t.id);
              const isExpanded = expandedTasks.has(t.id);
              return (
                <Fragment key={t.id}>
                <div draggable onDragStart={e=>onDragStart(e,t.id)} onDragEnd={onDragEnd}
                  onDragOver={e=>{e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect="move";setDropTarget({type:"task",id:t.id});}}
                  onDragLeave={e=>{e.stopPropagation();setDropTarget(prev=>prev?.type==="task"&&prev.id===t.id?null:prev);}}
                  onDrop={e=>onDropTask(e,t.id)}
                  style={{display:"flex",alignItems:"center",gap:10,padding:"10px 16px",borderBottom:(i<grp.items.length-1||isExpanded)?`1px solid ${C.divider}`:"none",cursor:"grab",
                    background:isTaskDrop?C.accentBg:isSel?C.accentBg:"transparent",
                    borderLeft:isTaskDrop?`3px solid ${C.accent}`:"3px solid transparent",
                    transition:"background 0.1s, border-left 0.1s"}}
                  onMouseEnter={e=>{if(!isSel&&!isTaskDrop)e.currentTarget.style.background=C.hover;}} onMouseLeave={e=>{if(!isSel&&!isTaskDrop)e.currentTarget.style.background="transparent";}}>
                  <svg width="12" height="12" viewBox="0 0 12 12" style={{flexShrink:0,cursor:"grab",opacity:0.3}}><circle cx="4" cy="2" r="1" fill={C.muted}/><circle cx="8" cy="2" r="1" fill={C.muted}/><circle cx="4" cy="6" r="1" fill={C.muted}/><circle cx="8" cy="6" r="1" fill={C.muted}/><circle cx="4" cy="10" r="1" fill={C.muted}/><circle cx="8" cy="10" r="1" fill={C.muted}/></svg>
                  <div style={{width:16,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    {subs.length>0?(
                      <button onClick={e=>{e.stopPropagation();toggleExpand(t.id);}} style={{background:"none",border:"none",cursor:"pointer",padding:0,display:"flex",alignItems:"center"}}>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{transform:isExpanded?"rotate(90deg)":"rotate(0deg)",transition:"transform 0.15s"}}><path d="M6 4l4 4-4 4" stroke={C.muted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </button>
                    ):null}
                  </div>
                  {bulkMode&&(
                    <input type="checkbox" checked={isSel} onChange={()=>toggleSelect(t.id)}
                      style={{accentColor:C.accent,width:16,height:16,cursor:"pointer",flexShrink:0}} onClick={e=>e.stopPropagation()}/>
                  )}
                  <CheckBox done={t.status==="complete"} onClick={e=>{e.stopPropagation();toggleDone(t.id);}}/>
                  <div style={{flex:1,minWidth:0}} onClick={()=>onNavigate("project",t.project_id,t.id)}>
                    <p style={{fontSize:13,color:t.status==="complete"?C.muted:C.text,textDecoration:t.status==="complete"?"line-through":"none",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                      {t.title}
                      {subs.length>0&&<span style={{fontSize:11,color:C.faint,fontWeight:400,marginLeft:6}}>{subs.filter(s=>s.status==="complete").length}/{subs.length}</span>}
                    </p>
                    <div style={{display:"flex",gap:8,marginTop:2}}>
                      {groupBy!=="project"&&ph&&<span style={{fontSize:11,color:C.muted,display:"flex",alignItems:"center",gap:4}}><div style={{width:5,height:5,borderRadius:1,background:pc(ph.id)}}/>{ph.name}</span>}
                      {!ph&&!t.project_id&&<span style={{fontSize:11,color:C.faint,fontStyle:"italic"}}>No project</span>}
                      <span style={{fontSize:11,color:C.faint}}>{t.start?fmtD(t.start)+" → "+(t.end?fmtD(t.end):"…"):"No date"}</span>
                    </div>
                  </div>
                  {t.assignee&&<Avatar name={t.assignee} size={22}/>}
                  {taskTotalEst(t,tasks)>0&&<span style={{fontSize:11,color:C.muted,fontVariantNumeric:"tabular-nums"}}>{fmtM(taskTotalEst(t,tasks))}</span>}
                  <Chip status={t.status}/>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke={C.faint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
                {isExpanded&&subs.map((st,si)=>(
                  <div key={st.id} draggable onDragStart={e=>onDragStart(e,st.id)} onDragEnd={onDragEnd}
                    style={{display:"flex",alignItems:"center",gap:10,padding:"8px 16px 8px 52px",borderBottom:si<subs.length-1?`1px solid ${C.divider}`:(i<grp.items.length-1?`1px solid ${C.divider}`:"none"),background:C.bg,cursor:"grab"}}
                    onMouseEnter={e=>e.currentTarget.style.background=C.hover} onMouseLeave={e=>e.currentTarget.style.background=C.bg}>
                    <svg width="10" height="10" viewBox="0 0 10 10" style={{flexShrink:0,opacity:0.2}}><path d="M2 0v6h6" stroke={C.muted} strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>
                    <CheckBox done={st.status==="complete"} onClick={e=>{e.stopPropagation();toggleDone(st.id);}}/>
                    <span onClick={()=>onNavigate("project",st.project_id,st.id)} style={{flex:1,fontSize:12,color:st.status==="complete"?C.muted:C.text,textDecoration:st.status==="complete"?"line-through":"none",cursor:"pointer",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{st.title}</span>
                    {st.assignee&&<Avatar name={st.assignee} size={18}/>}
                    {(st.price||0)>0&&<span style={{fontSize:11,color:C.muted,fontVariantNumeric:"tabular-nums"}}>{fmtM(st.price)}</span>}
                    <Chip status={st.status}/>
                  </div>
                ))}
                </Fragment>
              );
            })}
            {grp.items.length===0&&dragId&&<div style={{padding:"20px 16px",textAlign:"center",fontSize:12,color:C.faint}}>Drop here</div>}
          </div>
        </div>
        );
      })}
      {filtered.length===0&&!addMode&&<div style={{border:`1px solid ${C.border}`,borderRadius:8,padding:32,textAlign:"center",color:C.muted,fontSize:13,background:C.surface}}>No tasks match this filter.</div>}
    </div>
  );
}

// ── TEAM ──────────────────────────────────────────────────────────────────
const sbInvite = (email) => sbFetch("/auth/v1/magiclink", {method:"POST", body:JSON.stringify({email})});

function TeamView({team, setTeam, tasks, projects}) {
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addRole, setAddRole] = useState("");
  const [addPhone, setAddPhone] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [sendInvite, setSendInvite] = useState(true);
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [inviting, setInviting] = useState(null); // member id currently sending invite
  const [toast, setToast] = useState(null);
  const addRef = useRef(null);
  useEffect(()=>{ if(showAdd && addRef.current) addRef.current.focus(); },[showAdd]);
  useEffect(()=>{ if(toast){ const t=setTimeout(()=>setToast(null),3000); return ()=>clearTimeout(t); } },[toast]);

  const submitAdd = async () => {
    const name = addName.trim();
    if(!name) return;
    const email = addEmail.trim();
    const row = {name, role:addRole.trim(), phone:addPhone.trim(), email, invited:false};
    try {
      const rows = await sbInsertRow("team_members", row);
      if(rows?.[0]) {
        const member = rows[0];
        // Send invite email if checkbox checked and email provided
        if(sendInvite && email) {
          try {
            await sbInvite(email);
            member.invited = true;
            member.invited_at = new Date().toISOString();
            sbPatch("team_members", member.id, {invited:true, invited_at:member.invited_at}).catch(console.error);
            setToast({type:"success", msg:`Invite sent to ${email}`});
          } catch(e) {
            setToast({type:"error", msg:`Added member but invite failed: ${e.message}`});
          }
        }
        setTeam(prev=>[...prev, member]);
      }
    } catch(err) { alert("Failed: "+err.message); return; }
    setAddName("");setAddRole("");setAddPhone("");setAddEmail("");setSendInvite(true);setShowAdd(false);
  };

  const resendInvite = async (m) => {
    if(!m.email) { setToast({type:"error", msg:"No email address — edit member to add one"}); return; }
    setInviting(m.id);
    try {
      await sbInvite(m.email);
      setTeam(prev=>prev.map(x=>x.id===m.id?{...x,invited:true,invited_at:new Date().toISOString()}:x));
      sbPatch("team_members", m.id, {invited:true, invited_at:new Date().toISOString()}).catch(console.error);
      setToast({type:"success", msg:`Invite sent to ${m.email}`});
    } catch(e) {
      setToast({type:"error", msg:`Invite failed: ${e.message}`});
    }
    setInviting(null);
  };

  const startEdit = (m) => { setEditId(m.id); setEditForm({name:m.name||"",role:m.role||"",phone:m.phone||"",email:m.email||""}); };
  const cancelEdit = () => { setEditId(null); setEditForm({}); };
  const saveEdit = (id) => {
    const data = {name:editForm.name.trim(),role:editForm.role.trim(),phone:editForm.phone.trim(),email:editForm.email.trim()};
    if(!data.name) return;
    setTeam(prev=>prev.map(m=>m.id===id?{...m,...data}:m));
    sbPatch("team_members",id,data).catch(console.error);
    setEditId(null);
  };
  const deleteMember = (id) => {
    if(!confirm("Remove this team member?")) return;
    setTeam(prev=>prev.filter(m=>m.id!==id));
    sbDel("team_members",id).catch(console.error);
  };

  const taskCounts = useMemo(()=>{
    const counts={};
    tasks.forEach(t=>{if(t.assignee) counts[t.assignee]=(counts[t.assignee]||0)+1;});
    return counts;
  },[tasks]);
  const activeCounts = useMemo(()=>{
    const counts={};
    tasks.forEach(t=>{if(t.assignee && t.status==="in_progress") counts[t.assignee]=(counts[t.assignee]||0)+1;});
    return counts;
  },[tasks]);

  const inputSt = {border:`1px solid ${C.border}`,borderRadius:5,padding:"7px 10px",fontSize:13,color:C.text,background:C.bg,fontFamily:"inherit",outline:"none"};
  const editInputSt = {border:`1px solid ${C.accent}`,borderRadius:4,padding:"4px 8px",fontSize:12,color:C.text,background:C.bg,fontFamily:"inherit",outline:"none"};

  return (
    <div style={{padding:"32px 40px",maxWidth:900}}>
      {/* Toast */}
      {toast&&(
        <div style={{position:"fixed",top:16,right:16,zIndex:999,padding:"10px 18px",borderRadius:8,fontSize:13,fontWeight:500,
          background:toast.type==="success"?"#dff6dd":"#fde8e8",color:toast.type==="success"?"#1a7f37":"#c33",
          border:`1px solid ${toast.type==="success"?"#a8e6a1":"#f5b7b7"}`,boxShadow:"0 2px 8px rgba(0,0,0,0.08)"}}>
          {toast.msg}
        </div>
      )}

      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
        <div>
          <h2 style={{fontSize:18,fontWeight:700,color:C.text,letterSpacing:"-0.2px"}}>Team</h2>
          <p style={{fontSize:12,color:C.muted,marginTop:4}}>Manage members and send invites to collaborate on the dashboard.</p>
        </div>
        <Btn variant="primary" onClick={()=>setShowAdd(s=>!s)}>{showAdd?"Cancel":"+ Add member"}</Btn>
      </div>

      {showAdd&&(
        <div style={{border:`1px solid ${C.border}`,borderRadius:8,background:C.surface,padding:16,marginBottom:16}}>
          <div style={{display:"flex",gap:10,alignItems:"flex-end",flexWrap:"wrap"}}>
            <div style={{flex:1,minWidth:160}}>
              <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Name *</p>
              <input ref={addRef} value={addName} onChange={e=>setAddName(e.target.value)}
                placeholder="Full name" onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();submitAdd();}if(e.key==="Escape")setShowAdd(false);}}
                style={{...inputSt,width:"100%"}}/>
            </div>
            <div style={{width:130}}>
              <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Role</p>
              <input value={addRole} onChange={e=>setAddRole(e.target.value)} placeholder="e.g. Contractor"
                style={{...inputSt,width:"100%"}}/>
            </div>
            <div style={{width:130}}>
              <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Phone</p>
              <input value={addPhone} onChange={e=>setAddPhone(e.target.value)} placeholder="555-0100"
                style={{...inputSt,width:"100%"}}/>
            </div>
            <div style={{width:200}}>
              <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Email</p>
              <input value={addEmail} onChange={e=>setAddEmail(e.target.value)} placeholder="email@example.com"
                style={{...inputSt,width:"100%"}}/>
            </div>
            <Btn variant="primary" onClick={submitAdd}>Add</Btn>
          </div>
          {addEmail.trim()&&(
            <label style={{display:"flex",alignItems:"center",gap:6,marginTop:10,fontSize:12,color:C.muted,cursor:"pointer"}}>
              <input type="checkbox" checked={sendInvite} onChange={e=>setSendInvite(e.target.checked)}
                style={{accentColor:C.accent}}/>
              Send invite email to join the dashboard
            </label>
          )}
        </div>
      )}

      <p style={{fontSize:12,color:C.muted,marginBottom:16}}>{team.length} member{team.length!==1?"s":""}</p>

      <div style={{border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden",background:C.surface}}>
        {/* Header */}
        <div style={{display:"grid",gridTemplateColumns:"40px 1fr 100px 120px 170px 70px 50px 90px 50px",gap:0,padding:"8px 16px",borderBottom:`1px solid ${C.divider}`,background:C.bg}}>
          <span/>
          {["Name","Role","Phone","Email","Tasks","Active","Status",""].map(h=>(
            <span key={h} style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:"uppercase",letterSpacing:"0.5px"}}>{h}</span>
          ))}
        </div>
        {team.length===0&&<div style={{padding:24,textAlign:"center",color:C.muted,fontSize:13}}>No team members yet.</div>}
        {team.map((m,i)=>{
          const isEditing = editId===m.id;
          const statusLabel = m.user_id ? "Joined" : m.invited ? "Invited" : m.email ? "Not invited" : "No email";
          const statusColor = m.user_id ? C.green : m.invited ? C.accent : C.faint;
          return (
            <div key={m.id} style={{display:"grid",gridTemplateColumns:"40px 1fr 100px 120px 170px 70px 50px 90px 50px",gap:0,padding:"10px 16px",borderBottom:i<team.length-1?`1px solid ${C.divider}`:"none",alignItems:"center"}}
              onMouseEnter={e=>e.currentTarget.style.background=C.hover} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <Avatar name={m.name} size={26}/>
              {isEditing ? (
                <Fragment>
                  <input value={editForm.name} onChange={e=>setEditForm(f=>({...f,name:e.target.value}))} onKeyDown={e=>{if(e.key==="Enter")saveEdit(m.id);if(e.key==="Escape")cancelEdit();}}
                    style={editInputSt}/>
                  <input value={editForm.role} onChange={e=>setEditForm(f=>({...f,role:e.target.value}))} onKeyDown={e=>{if(e.key==="Enter")saveEdit(m.id);if(e.key==="Escape")cancelEdit();}}
                    style={editInputSt}/>
                  <input value={editForm.phone} onChange={e=>setEditForm(f=>({...f,phone:e.target.value}))} onKeyDown={e=>{if(e.key==="Enter")saveEdit(m.id);if(e.key==="Escape")cancelEdit();}}
                    style={editInputSt}/>
                  <input value={editForm.email} onChange={e=>setEditForm(f=>({...f,email:e.target.value}))} onKeyDown={e=>{if(e.key==="Enter")saveEdit(m.id);if(e.key==="Escape")cancelEdit();}}
                    style={editInputSt}/>
                  <span style={{fontSize:12,color:C.muted}}>{taskCounts[m.name]||0}</span>
                  <span style={{fontSize:12,color:activeCounts[m.name]?C.accent:C.faint}}>{activeCounts[m.name]||0}</span>
                  <span style={{fontSize:11,color:statusColor}}>{statusLabel}</span>
                  <div style={{display:"flex",gap:4}}>
                    <button onClick={()=>saveEdit(m.id)} style={{background:"none",border:"none",cursor:"pointer",fontSize:14,color:C.green}} title="Save">✓</button>
                    <button onClick={cancelEdit} style={{background:"none",border:"none",cursor:"pointer",fontSize:14,color:C.faint}} title="Cancel">✕</button>
                  </div>
                </Fragment>
              ) : (
                <Fragment>
                  <span style={{fontSize:13,fontWeight:500,color:C.text}}>{m.name}</span>
                  <span style={{fontSize:12,color:C.muted}}>{m.role||"—"}</span>
                  <span style={{fontSize:12,color:C.muted}}>{m.phone||"—"}</span>
                  <span style={{fontSize:12,color:C.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.email||"—"}</span>
                  <span style={{fontSize:12,color:C.muted,fontVariantNumeric:"tabular-nums"}}>{taskCounts[m.name]||0}</span>
                  <span style={{fontSize:12,color:activeCounts[m.name]?C.accent:C.faint,fontVariantNumeric:"tabular-nums"}}>{activeCounts[m.name]||0}</span>
                  <div style={{display:"flex",alignItems:"center",gap:4}}>
                    {m.user_id ? (
                      <span style={{fontSize:11,color:C.green,fontWeight:500}}>Joined</span>
                    ) : m.email ? (
                      <button onClick={()=>resendInvite(m)} disabled={inviting===m.id}
                        style={{padding:"3px 8px",fontSize:11,fontWeight:500,borderRadius:4,cursor:"pointer",
                          border:`1px solid ${m.invited?C.border:C.accent}`,
                          background:m.invited?C.surface:C.accentBg,
                          color:m.invited?C.muted:C.accent,opacity:inviting===m.id?0.5:1}}>
                        {inviting===m.id?"Sending…":m.invited?"Resend":"Invite"}
                      </button>
                    ) : (
                      <span style={{fontSize:11,color:C.faint}}>No email</span>
                    )}
                  </div>
                  <div style={{display:"flex",gap:4}}>
                    <button onClick={()=>startEdit(m)} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:C.faint}} title="Edit">✎</button>
                    <button onClick={()=>deleteMember(m.id)} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:C.faint}} title="Delete">🗑</button>
                  </div>
                </Fragment>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── BUDGET ─────────────────────────────────────────────────────────────────
function BudgetView({projects, phases, expenses, tasks, proceeds, setProceeds, onNavigate}) {
  const [budgetTab, setBudgetTab] = useState("cashflow");
  const [showAddProceed, setShowAddProceed] = useState(false);
  const [proceedForm, setProceedForm] = useState({label:"",amount:"",received_date:"",type:"contribution"});
  const [savingProceed, setSavingProceed] = useState(false);

  const PROCEED_TYPES = [
    {value:"contribution",label:"Contribution"},
    {value:"paycheck",label:"Paycheck allocation"},
    {value:"sale",label:"Property sale"},
    {value:"credit",label:"Seller credit"},
    {value:"other",label:"Other"},
  ];

  // ── Totals ────────────────────────────────────────────────────────────────
  const totalProceeds = (proceeds||[]).reduce((s,p)=>s+(parseFloat(p.amount)||0), 0);
  const totalActual   = tasks.filter(t=>!t.parent_task_id).reduce((s,t)=>s+(taskTotalAct(t,tasks)||0), 0);
  const totalProjected = projects.reduce((s,p)=>{
    const taskCosts = tasks.filter(t=>t.project_id===p.id&&!t.parent_task_id).reduce((a,t)=>a+(taskTotalEst(t,tasks)||0),0);
    return s + taskCosts + (p.contingency||0);
  }, 0);
  const runningBalance = totalProceeds - totalActual;
  const runway = totalProceeds - totalProjected;

  const addProceed = () => {
    if(!proceedForm.label||!proceedForm.amount) return;
    setSavingProceed(true);
    const row = {label:proceedForm.label, amount:parseFloat(proceedForm.amount)||0, received_date:proceedForm.received_date||null, notes:proceedForm.type||""};
    sbInsertRow("proceeds", row).then(rows=>{
      if(rows?.[0]) setProceeds(prev=>[...prev,rows[0]]);
      setProceedForm({label:"",amount:"",received_date:"",type:"contribution"});
      setShowAddProceed(false);
    }).catch(console.error).finally(()=>setSavingProceed(false));
  };

  const deleteProceed = id => {
    setProceeds(prev=>prev.filter(p=>p.id!==id));
    sbDel("proceeds", id).catch(console.error);
  };

  const tabs = [{id:"cashflow",label:"Cash Flow"},{id:"pl",label:"P & L"},{id:"proceeds",label:"Proceeds"}];

  return (
    <div style={{padding:"32px 40px",maxWidth:1060}}>
      <h2 style={{fontSize:18,fontWeight:700,color:C.text,letterSpacing:"-0.2px",marginBottom:20}}>Budget</h2>

      {/* ── Summary cards ─────────────────────────────────────────────────── */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:1,border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden",background:C.border,marginBottom:20}}>
        {[
          {l:"Total Proceeds",  v:fmtM(totalProceeds),  sub:"money in",               color:C.green},
          {l:"Actual Spend",    v:fmtM(totalActual),    sub:"money out",               color:totalActual>0?"#C0392B":C.muted},
          {l:"Running Balance", v:fmtM(runningBalance), sub:"proceeds − actual",       color:runningBalance>=0?C.green:"#C0392B"},
          {l:"Projected Runway",v:fmtM(runway),         sub:"proceeds − projected",    color:runway>=0?C.muted:"#C0392B"},
        ].map(({l,v,sub,color})=>(
          <div key={l} style={{background:C.surface,padding:"16px 20px"}}>
            <p style={{fontSize:11,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>{l}</p>
            <p style={{fontSize:20,fontWeight:700,color,fontVariantNumeric:"tabular-nums"}}>{v}</p>
            <p style={{fontSize:11,color:C.faint,marginTop:3}}>{sub}</p>
          </div>
        ))}
      </div>

      {/* ── Tab bar ───────────────────────────────────────────────────────── */}
      <div style={{display:"flex",gap:2,borderBottom:`1px solid ${C.border}`,marginBottom:20}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setBudgetTab(t.id)} style={{padding:"8px 16px",fontSize:13,fontWeight:budgetTab===t.id?600:400,color:budgetTab===t.id?C.text:C.muted,background:"transparent",border:"none",borderBottom:`2px solid ${budgetTab===t.id?C.text:"transparent"}`,cursor:"pointer",marginBottom:-1}}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Cash Flow tab ─────────────────────────────────────────────────── */}
      {budgetTab==="cashflow"&&(
        <CashFlowChart proceeds={proceeds} tasks={tasks} projects={projects} onNavigate={onNavigate}/>
      )}

      {/* ── P&L tab ───────────────────────────────────────────────────────── */}
      {budgetTab==="pl"&&(
        <TaskBudgetTable projects={projects} phases={phases} tasks={tasks} onNavigate={onNavigate}/>
      )}

      {/* ── Proceeds tab ──────────────────────────────────────────────────── */}
      {budgetTab==="proceeds"&&(
        <div style={{maxWidth:640}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
            <p style={{fontSize:13,fontWeight:600,color:C.text}}>All Proceeds</p>
            <Btn variant="primary" onClick={()=>setShowAddProceed(s=>!s)}>{showAddProceed?"Cancel":"+ Add proceed"}</Btn>
          </div>

          {showAddProceed&&(
            <div style={{border:`1px solid ${C.border}`,borderRadius:8,background:C.surface,padding:18,marginBottom:14}}>
              <p style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:12}}>New proceed</p>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                <div>
                  <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Source / Label</p>
                  <Input value={proceedForm.label} onChange={v=>setProceedForm(f=>({...f,label:v}))} placeholder="e.g. March paycheck, Seller credit"/>
                </div>
                <div>
                  <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Amount ($)</p>
                  <Input value={proceedForm.amount} onChange={v=>setProceedForm(f=>({...f,amount:v}))} placeholder="0"/>
                </div>
                <div>
                  <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Date received</p>
                  <input type="date" value={proceedForm.received_date} onChange={e=>setProceedForm(f=>({...f,received_date:e.target.value}))}
                    style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:5,padding:"7px 10px",fontSize:13,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}/>
                </div>
                <div>
                  <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Type</p>
                  <select value={proceedForm.type} onChange={e=>setProceedForm(f=>({...f,type:e.target.value}))}
                    style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:5,padding:"7px 10px",fontSize:13,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none",appearance:"none"}}>
                    {PROCEED_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              </div>
              <Btn variant="primary" onClick={addProceed} style={{opacity:savingProceed?0.6:1}}>{savingProceed?"Saving...":"Add proceed"}</Btn>
            </div>
          )}

          {/* Proceeds timeline list */}
          <div style={{border:`1px solid ${C.border}`,borderRadius:8,background:C.surface,overflow:"hidden"}}>
            {(proceeds||[]).length===0&&!showAddProceed&&(
              <p style={{padding:"32px 16px",fontSize:13,color:C.faint,textAlign:"center"}}>No proceeds yet. Add your first one above.</p>
            )}
            {(()=>{
              const sorted = [...(proceeds||[])].sort((a,b)=>(a.received_date||"").localeCompare(b.received_date||"")||(a.id-b.id));
              let cumulative = 0;
              return sorted.map((p,i)=>{
                cumulative += parseFloat(p.amount)||0;
                return (
                  <div key={p.id} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 14px",borderBottom:i<sorted.length-1?`1px solid ${C.divider}`:"none"}}
                    onMouseEnter={e=>e.currentTarget.style.background=C.hover} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    {/* Date column */}
                    <div style={{width:56,flexShrink:0,textAlign:"center"}}>
                      {p.received_date ? <>
                        <p style={{fontSize:16,fontWeight:700,color:C.text,lineHeight:1,fontVariantNumeric:"tabular-nums"}}>{new Date(p.received_date+"T12:00:00").getDate()}</p>
                        <p style={{fontSize:10,color:C.muted,textTransform:"uppercase"}}>{new Date(p.received_date+"T12:00:00").toLocaleDateString("en-US",{month:"short",year:"2-digit"})}</p>
                      </> : <p style={{fontSize:11,color:C.faint}}>No date</p>}
                    </div>
                    {/* Color bar */}
                    <div style={{width:3,alignSelf:"stretch",background:C.green,borderRadius:2,flexShrink:0,minHeight:28}}/>
                    {/* Info */}
                    <div style={{flex:1,minWidth:0}}>
                      <p style={{fontSize:13,fontWeight:500,color:C.text}}>{p.label}</p>
                      {p.notes&&<p style={{fontSize:11,color:C.muted,marginTop:1}}>{PROCEED_TYPES.find(t=>t.value===p.notes)?.label||p.notes}</p>}
                    </div>
                    {/* Amount + running total */}
                    <div style={{textAlign:"right",flexShrink:0}}>
                      <p style={{fontSize:14,fontWeight:600,color:C.green,fontVariantNumeric:"tabular-nums"}}>{fmtM(parseFloat(p.amount)||0)}</p>
                      <p style={{fontSize:10,color:C.faint,fontVariantNumeric:"tabular-nums",marginTop:1}}>bal {fmtM(cumulative)}</p>
                    </div>
                    {/* Delete */}
                    <button onClick={()=>deleteProceed(p.id)}
                      style={{background:"none",border:"none",cursor:"pointer",color:C.faint,fontSize:12,padding:"0 2px",opacity:0,flexShrink:0}}
                      onMouseEnter={e=>e.target.style.opacity=1} onMouseLeave={e=>e.target.style.opacity=0}>✕</button>
                  </div>
                );
              });
            })()}
            {(proceeds||[]).length>0&&(
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 14px",borderTop:`2px solid ${C.border}`,background:C.bg}}>
                <span style={{fontSize:12,fontWeight:600,color:C.muted}}>Total Proceeds</span>
                <span style={{fontSize:16,fontWeight:700,color:C.green,fontVariantNumeric:"tabular-nums"}}>{fmtM(totalProceeds)}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── PHASES VIEW ────────────────────────────────────────────────────────────
// ── PHASES VIEW ──────────────────────────────────────────────────────────────
function PhasesView({phases, projects, onNavigate, onAddPhase, onUpdatePhase, onDeletePhase}) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({name:"",notes:""});
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({name:"",notes:""});
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // Compute date range for a phase from its child projects
  const phaseRange = (faId) => {
    const ps = projects.filter(p=>p.phase_id===faId&&p.start&&p.end);
    if(!ps.length) return {start:null,end:null};
    return {
      start: ps.reduce((min,p)=>p.start<min?p.start:min, ps[0].start),
      end:   ps.reduce((max,p)=>p.end>max?p.end:max,     ps[0].end),
    };
  };

  // Sort phases by computed start date
  const sortedPhases = [...phases].sort((a,b)=>{
    const ra = phaseRange(a.id); const rb = phaseRange(b.id);
    if(!ra.start && !rb.start) return 0;
    if(!ra.start) return 1;
    if(!rb.start) return -1;
    return ra.start < rb.start ? -1 : 1;
  });

  const addPhase = () => {
    if(!form.name) return;
    setSaving(true);
    sbInsertRow("phases", {name:form.name, notes:form.notes, sort_order:phases.length}).then(rows=>{
      if(rows?.[0]) onAddPhase(rows[0]);
      setForm({name:"",notes:""});
      setShowAdd(false);
    }).catch(console.error).finally(()=>setSaving(false));
  };

  const saveEdit = (id) => {
    onUpdatePhase(id, editForm);
    sbPatch("phases", id, {name:editForm.name, notes:editForm.notes}).catch(console.error);
    setEditId(null);
  };

  const doDelete = (id) => {
    onDeletePhase(id);
    sbDel("phases", id).catch(console.error);
    setConfirmDeleteId(null);
  };

  return (
    <div style={{padding:"32px 40px",maxWidth:800}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:24}}>
        <h2 style={{fontSize:18,fontWeight:700,color:C.text,letterSpacing:"-0.2px"}}>Phases</h2>
        <Btn variant="primary" onClick={()=>setShowAdd(s=>!s)}>+ Add phase</Btn>
      </div>

      {showAdd&&(
        <div style={{border:`1px solid ${C.border}`,borderRadius:8,background:C.surface,padding:20,marginBottom:24}}>
          <p style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:14}}>New phase</p>
          <div style={{marginBottom:10}}>
            <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Name</p>
            <Input value={form.name} onChange={v=>setForm(f=>({...f,name:v}))} placeholder="e.g. 2026 Renovation, Phase 1"/>
          </div>
          <div style={{marginBottom:14}}>
            <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Notes</p>
            <NoteField value={form.notes} onChange={v=>setForm(f=>({...f,notes:v}))} placeholder="Scope or context..." rows={2}/>
          </div>
          <div style={{display:"flex",gap:8}}>
            <Btn variant="primary" onClick={addPhase} style={{opacity:saving?0.6:1}}>{saving?"Saving...":"Add phase"}</Btn>
            <Btn onClick={()=>setShowAdd(false)}>Cancel</Btn>
          </div>
        </div>
      )}

      {phases.length===0&&!showAdd&&(
        <div style={{border:`1px solid ${C.border}`,borderRadius:8,padding:32,textAlign:"center",color:C.muted,fontSize:13,background:C.surface}}>
          No phases yet. Phases group your projects into broad timelines.
        </div>
      )}

      {sortedPhases.map(fa=>{
        const faProjects=projects.filter(p=>p.phase_id===fa.id);
        const totalBudget=faProjects.reduce((s,p)=>s+(p.target_budget||p.budget||0),0);
        return(
          <div key={fa.id} style={{border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden",background:C.surface,marginBottom:16}}>
            {editId===fa.id?(
              <div style={{padding:"14px 18px",background:C.bg,borderBottom:`1px solid ${C.divider}`}}>
                <div style={{marginBottom:10}}>
                  <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Name</p>
                  <Input value={editForm.name} onChange={v=>setEditForm(f=>({...f,name:v}))}/>
                </div>
                <div style={{marginBottom:10}}>
                  <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Notes</p>
                  <NoteField value={editForm.notes} onChange={v=>setEditForm(f=>({...f,notes:v}))} rows={2}/>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{display:"flex",gap:8}}>
                    <Btn variant="primary" onClick={()=>saveEdit(fa.id)}>Save</Btn>
                    <Btn onClick={()=>setEditId(null)}>Cancel</Btn>
                  </div>
                  {confirmDeleteId===fa.id
                    ? <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:12,color:"#9E3C3C"}}>Delete phase?</span>
                        <Btn variant="danger" onClick={()=>doDelete(fa.id)}>Yes, delete</Btn>
                        <Btn onClick={()=>setConfirmDeleteId(null)}>Cancel</Btn>
                      </div>
                    : <Btn variant="danger" onClick={()=>setConfirmDeleteId(fa.id)}>Delete phase</Btn>
                  }
                </div>
              </div>
            ):(
              <div style={{padding:"14px 18px",borderBottom:faProjects.length>0?`1px solid ${C.divider}`:"none",display:"flex",alignItems:"center",justifyContent:"space-between",background:C.bg}}>
                <div>
                  <p style={{fontSize:15,fontWeight:700,color:C.text}}>{fa.name}</p>
                  {(()=>{const r=phaseRange(fa.id);return r.start?<p style={{fontSize:12,color:C.muted,marginTop:1}}>{fmtD(r.start)} → {fmtD(r.end)}</p>:null;})()}
                  {fa.notes&&<p style={{fontSize:12,color:C.muted,marginTop:1}}>{fa.notes}</p>}
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:12,color:C.muted}}>{faProjects.length} project{faProjects.length!==1?"s":""} · {fmtM(totalBudget)} total</span>
                  <Btn onClick={()=>onNavigate("projects")} style={{fontSize:11}}>+ Add project</Btn>
                  <Btn onClick={()=>{setEditId(fa.id);setEditForm({name:fa.name,notes:fa.notes||""});setConfirmDeleteId(null);}}>Edit</Btn>
                </div>
              </div>
            )}
            {faProjects.map((pr,i)=>(
              <div key={pr.id} onClick={()=>onNavigate("project",pr.id)}
                style={{display:"flex",alignItems:"center",gap:14,padding:"12px 18px",borderBottom:i<faProjects.length-1?`1px solid ${C.divider}`:"none",cursor:"pointer"}}
                onMouseEnter={e=>e.currentTarget.style.background=C.hover}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <div style={{width:7,height:7,borderRadius:2,background:pc(pr.id),flexShrink:0}}/>
                <div style={{flex:1}}>
                  <p style={{fontSize:13,fontWeight:500,color:C.text}}>{pr.name}</p>
                  <p style={{fontSize:11,color:C.muted,marginTop:1}}>{fmtD(pr.start)} → {fmtD(pr.end)}</p>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke={C.faint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function ProjectsView({phases, projects, setProjects, tasks, expenses, onNavigate, onAddProject}) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({name:"",status:"planning",target_budget:"",contingency:"",start:"",end:"",notes:"",phase_id:""});
  const [saving, setSaving] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [bulkForm, setBulkForm] = useState({phase_id:"",status:"",start:"",end:""});
  const toggleBulkMode = () => { setBulkMode(p=>!p); setSelected(new Set()); };
  const toggleSelect = id => setSelected(prev=>{const s=new Set(prev);if(s.has(id))s.delete(id);else s.add(id);return s;});
  const selectAll = () => { if(selected.size===projects.length) setSelected(new Set()); else setSelected(new Set(projects.map(p=>p.id))); };

  const applyBulk = () => {
    const patch = {};
    if(bulkForm.phase_id) patch.phase_id = bulkForm.phase_id==="none"?null:parseInt(bulkForm.phase_id);
    if(bulkForm.status) patch.status = bulkForm.status;
    if(bulkForm.start) patch.start_date = bulkForm.start;
    if(bulkForm.end) patch.end_date = bulkForm.end;
    if(Object.keys(patch).length===0) return;
    const localPatch = {};
    if(patch.phase_id!==undefined) localPatch.phase_id = patch.phase_id;
    if(patch.status) localPatch.status = patch.status;
    if(patch.start_date) localPatch.start = patch.start_date;
    if(patch.end_date) localPatch.end = patch.end_date;
    setProjects(prev=>prev.map(p=>selected.has(p.id)?{...p,...localPatch}:p));
    selected.forEach(id=>sbPatch("projects",id,patch).catch(console.error));
    setSelected(new Set()); setBulkForm({phase_id:"",status:"",start:"",end:""});
  };
  const bulkDelete = () => {
    if(!confirm(`Delete ${selected.size} project(s)?`)) return;
    setProjects(prev=>prev.filter(p=>!selected.has(p.id)));
    selected.forEach(id=>sbDel("projects",id).catch(console.error));
    setSelected(new Set());
  };

  const selSt = {border:`1px solid ${C.border}`,borderRadius:5,padding:"5px 8px",fontSize:12,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"};
  const inputSt = {border:`1px solid ${C.border}`,borderRadius:5,padding:"5px 8px",fontSize:12,color:C.text,background:C.bg,fontFamily:"inherit",outline:"none"};

  const addProject = () => {
    if(!form.name) return;
    setSaving(true);
    const dbProject = {
      name:form.name, status:form.status, target_budget:parseInt(form.target_budget)||0, contingency:parseFloat(form.contingency)||0,
      start_date:form.start||null, end_date:form.end||null, notes:form.notes,
      phase_id:parseInt(form.phase_id)||null, sort_order:projects.length,
    };
    sbInsertRow("projects", dbProject).then(rows=>{
      if(rows?.[0]) onAddProject(mapProject(rows[0]));
      setForm({name:"",status:"planning",target_budget:"",contingency:"",start:"",end:"",notes:"",phase_id:""});
      setShowAdd(false);
    }).catch(console.error).finally(()=>setSaving(false));
  };

  // Group projects: those with a phase go under their phase, ungrouped ones at bottom
  const grouped = phases.map(fa=>({fa, items:projects.filter(p=>String(p.phase_id)===String(fa.id))}));
  const ungrouped = projects.filter(p=>!p.phase_id||!phases.find(fa=>String(fa.id)===String(p.phase_id)));

  const ProjectRow = ({pr, i, total}) => {
    const projectTasks=tasks.filter(t=>t.project_id===pr.id);
    const done=projectTasks.filter(t=>t.status==="complete").length;
    const isSel=selected.has(pr.id);
    return(
      <div onClick={()=>bulkMode?toggleSelect(pr.id):onNavigate("project",pr.id)}
        style={{display:"flex",alignItems:"center",gap:14,padding:"12px 18px",borderBottom:i<total-1?`1px solid ${C.divider}`:"none",cursor:"pointer",
          background:isSel?C.accentBg:"transparent"}}
        onMouseEnter={e=>{if(!isSel)e.currentTarget.style.background=C.hover;}}
        onMouseLeave={e=>{if(!isSel)e.currentTarget.style.background="transparent";}}>
        {bulkMode&&(
          <input type="checkbox" checked={isSel} onChange={()=>toggleSelect(pr.id)}
            style={{accentColor:C.accent,width:16,height:16,cursor:"pointer",flexShrink:0}} onClick={e=>e.stopPropagation()}/>
        )}
        <div style={{width:7,height:7,borderRadius:2,background:pc(pr.id),flexShrink:0}}/>
        <div style={{flex:1,minWidth:0}}>
          <p style={{fontSize:13,fontWeight:500,color:C.text}}>{pr.name}</p>
          <p style={{fontSize:11,color:C.muted,marginTop:1}}>{fmtD(pr.start)} → {fmtD(pr.end)}</p>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
          <span style={{fontSize:12,color:C.muted}}>{done}/{projectTasks.length} tasks</span>
          <span style={{fontSize:12,color:C.muted,fontVariantNumeric:"tabular-nums"}}>{fmtM(pr.target_budget||pr.budget||0)}</span>
          {!bulkMode&&<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke={C.faint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
        </div>
      </div>
    );
  };

  return (
    <div style={{padding:"32px 40px",maxWidth:800}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:24}}>
        <h2 style={{fontSize:18,fontWeight:700,color:C.text,letterSpacing:"-0.2px"}}>Projects</h2>
        <Btn variant="primary" onClick={()=>setShowAdd(s=>!s)}>+ Add project</Btn>
      </div>

      {/* Count bar + bulk toggle */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
        <span style={{fontSize:12,color:C.muted}}>
          {bulkMode?`${selected.size} of ${projects.length} selected`:`${projects.length} project${projects.length!==1?"s":""}`}
          {bulkMode&&selected.size<projects.length&&<span onClick={selectAll} style={{marginLeft:8,color:C.accent,cursor:"pointer"}}>Select all</span>}
          {bulkMode&&selected.size===projects.length&&selected.size>0&&<span onClick={selectAll} style={{marginLeft:8,color:C.accent,cursor:"pointer"}}>Deselect all</span>}
        </span>
        <Btn onClick={toggleBulkMode} style={{fontSize:11,padding:"4px 10px"}}>{bulkMode?"Exit bulk edit":"Bulk edit"}</Btn>
      </div>

      {/* Bulk edit bar */}
      {bulkMode&&selected.size>0&&(
        <div style={{border:`1px solid ${C.accent}`,borderRadius:8,background:C.accentBg,padding:"12px 16px",marginBottom:16,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <select value={bulkForm.phase_id} onChange={e=>setBulkForm(f=>({...f,phase_id:e.target.value}))} style={selSt}>
            <option value="">Phase…</option>
            <option value="none">No phase</option>
            {phases.map(fa=><option key={fa.id} value={fa.id}>{fa.name}</option>)}
          </select>
          <select value={bulkForm.status} onChange={e=>setBulkForm(f=>({...f,status:e.target.value}))} style={selSt}>
            <option value="">Status…</option>
            <option value="planning">Planning</option>
            <option value="active">Active</option>
            <option value="complete">Complete</option>
            <option value="on_hold">On hold</option>
          </select>
          <input type="date" value={bulkForm.start} onChange={e=>setBulkForm(f=>({...f,start:e.target.value}))} style={{...inputSt,width:130}} placeholder="Start"/>
          <input type="date" value={bulkForm.end} onChange={e=>setBulkForm(f=>({...f,end:e.target.value}))} style={{...inputSt,width:130}} placeholder="End"/>
          <Btn variant="primary" onClick={applyBulk} style={{fontSize:11,padding:"5px 12px"}}>Apply</Btn>
          <Btn onClick={bulkDelete} style={{fontSize:11,padding:"5px 12px",color:"#e55"}}>Delete</Btn>
          <span onClick={()=>{setSelected(new Set());setBulkForm({phase_id:"",status:"",start:"",end:""});}} style={{fontSize:11,color:C.muted,cursor:"pointer",marginLeft:4}}>Clear</span>
        </div>
      )}

      {showAdd&&(
        <div style={{border:`1px solid ${C.border}`,borderRadius:8,background:C.surface,padding:20,marginBottom:24}}>
          <p style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:14}}>New project</p>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
            <div style={{gridColumn:"1/-1"}}>
              <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Name</p>
              <Input value={form.name} onChange={v=>setForm(f=>({...f,name:v}))} placeholder="e.g. HVAC, Kitchen, Exterior"/>
            </div>
            <div>
              <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Phase</p>
              <select value={form.phase_id} onChange={e=>setForm(f=>({...f,phase_id:e.target.value}))}
                style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:5,padding:"7px 10px",fontSize:13,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none",appearance:"none"}}>
                <option value="">No phase</option>
                {phases.map(fa=><option key={fa.id} value={fa.id}>{fa.name}</option>)}
              </select>
            </div>
            <div>
              <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Status</p>
              <select value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}
                style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:5,padding:"7px 10px",fontSize:13,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none",appearance:"none"}}>
                <option value="planning">Planning</option>
                <option value="active">Active</option>
                <option value="complete">Complete</option>
                <option value="on_hold">On hold</option>
              </select>
            </div>
            <div>
              <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Target Budget ($)</p>
              <Input value={form.target_budget} onChange={v=>setForm(f=>({...f,target_budget:v}))} placeholder="0"/>
            </div>
            <div>
              <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Start date</p>
              <input type="date" value={form.start} onChange={e=>setForm(f=>({...f,start:e.target.value}))}
                style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:5,padding:"7px 10px",fontSize:13,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}/>
            </div>
            <div>
              <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>End date</p>
              <input type="date" value={form.end} onChange={e=>setForm(f=>({...f,end:e.target.value}))}
                style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:5,padding:"7px 10px",fontSize:13,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}/>
            </div>
          </div>
          <div style={{marginBottom:14}}>
            <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Notes</p>
            <NoteField value={form.notes} onChange={v=>setForm(f=>({...f,notes:v}))} placeholder="Scope, context..." rows={2}/>
          </div>
          <div style={{display:"flex",gap:8}}>
            <Btn variant="primary" onClick={addProject} style={{opacity:saving?0.6:1}}>{saving?"Saving...":"Add project"}</Btn>
            <Btn onClick={()=>setShowAdd(false)}>Cancel</Btn>
          </div>
        </div>
      )}

      {projects.length===0&&!showAdd&&(
        <div style={{border:`1px solid ${C.border}`,borderRadius:8,padding:32,textAlign:"center",color:C.muted,fontSize:13,background:C.surface}}>
          No projects yet. Add your first one above.
        </div>
      )}

      {grouped.map(({fa,items})=>items.length>0&&(
        <div key={fa.id} style={{marginBottom:20}}>
          <p style={{fontSize:10,fontWeight:600,color:C.faint,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8,paddingLeft:2}}>{fa.name}</p>
          <div style={{border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden",background:C.surface}}>
            {items.map((pr,i)=><ProjectRow key={pr.id} pr={pr} i={i} total={items.length}/>)}
          </div>
        </div>
      ))}

      {ungrouped.length>0&&(
        <div style={{marginBottom:20}}>
          {grouped.some(({items})=>items.length>0)&&<p style={{fontSize:10,fontWeight:600,color:C.faint,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8,paddingLeft:2}}>Unassigned</p>}
          <div style={{border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden",background:C.surface}}>
            {ungrouped.map((pr,i)=><ProjectRow key={pr.id} pr={pr} i={i} total={ungrouped.length}/>)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── LOGIN PAGE ─────────────────────────────────────────────────────────────
function LoginPage({onLogin}) {
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");

  const submit = () => {
    if(!email||!password) return;
    setLoading(true); setError("");
    sbSignIn(email, password).then(data=>{
      AUTH_TOKEN = data.access_token;
      onLogin(data);
    }).catch(e=>{
      setError("Wrong email or password.");
      setLoading(false);
    });
  };

  return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:C.bg,fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"}}>
      <div style={{width:360,background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:36,boxShadow:"0 4px 24px rgba(0,0,0,0.07)"}}>
        <p style={{fontSize:18,fontWeight:700,color:C.text,letterSpacing:"-0.2px",marginBottom:4}}>4602 Banks</p>
        <p style={{fontSize:13,color:C.muted,marginBottom:28}}>Sign in to continue</p>
        <div style={{marginBottom:14}}>
          <p style={{fontSize:11,fontWeight:500,color:C.muted,marginBottom:5}}>Email</p>
          <input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="you@example.com"
            onKeyDown={e=>e.key==="Enter"&&submit()}
            style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:6,padding:"8px 11px",fontSize:13,color:C.text,background:C.bg,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}
            onFocus={e=>e.target.style.borderColor=C.accent} onBlur={e=>e.target.style.borderColor=C.border}/>
        </div>
        <div style={{marginBottom:20}}>
          <p style={{fontSize:11,fontWeight:500,color:C.muted,marginBottom:5}}>Password</p>
          <input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="••••••••"
            onKeyDown={e=>e.key==="Enter"&&submit()}
            style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:6,padding:"8px 11px",fontSize:13,color:C.text,background:C.bg,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}
            onFocus={e=>e.target.style.borderColor=C.accent} onBlur={e=>e.target.style.borderColor=C.border}/>
        </div>
        {error&&<p style={{fontSize:12,color:"#9E3C3C",marginBottom:14}}>{error}</p>}
        <button onClick={submit} disabled={loading}
          style={{width:"100%",background:loading?C.faint:C.accent,color:"white",border:"none",borderRadius:6,padding:"9px 0",fontSize:13,fontWeight:600,cursor:loading?"default":"pointer"}}>
          {loading?"Signing in…":"Sign in"}
        </button>
      </div>
    </div>
  );
}

// ── ROOT ───────────────────────────────────────────────────────────────────
export default function App() {
  const [session,   setSession]   = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [view,      setView]      = useState("dashboard");
  const [phases,    setPhases]     = useState([]);
  const [sidebarAddingPhase, setSidebarAddingPhase] = useState(null);
  const [sidebarNewProject,  setSidebarNewProject]  = useState("");
  const sidebarInputRef = useRef(null);
  const [team,      setTeam]       = useState([]);
  const [projects,  setProjects]    = useState([]);
  const [tasks,     setTasks]     = useState([]);
  const [expenses,  setExpenses]  = useState([]);
  const [events,    setEvents]    = useState([]);
  const [quotes,    setQuotes]    = useState([]);
  const [proceeds,  setProceeds]  = useState([]);
  const [page,      setPage]      = useState(null);
  const [globalAI,  setGlobalAI]  = useState(false);

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([
      sbQ("team_members","select=*&order=name.asc"),
      sbQ("phases",     "select=*&order=sort_order.asc"),
      sbQ("projects",   "select=*&order=sort_order.asc"),
      sbQ("tasks",    "select=*&order=sort_order.asc"),
      sbQ("expenses", "select=*"),
      sbQ("events",   "select=*&order=event_date.asc"),
      sbFetch("/rest/v1/quotes?select=*,quote_contractors!quote_contractors_quote_id_fkey(*),quote_items(*,quote_item_amounts(*))"),
      sbQ("proceeds","select=*&order=received_date.asc"),
    ]).then(([tm,fa,ph,ta,ex,ev,qu,pr])=>{
      setTeam(tm);
      setPhases(fa.map(f=>({...f, allocated:f.allocated||0})));
      setProjects(ph.map(mapProject));
      setTasks(ta.map(mapTask));
      setExpenses(ex.map(mapExpense));
      setEvents(ev.map(mapEvent));
      setQuotes(qu.map(mapQuote));
      setProceeds(pr||[]);
    }).catch(console.error).finally(()=>setLoading(false));
  }, []);

  const handleLogin = (data) => {
    AUTH_TOKEN = data.access_token;
    localStorage.setItem("4602banks_session", JSON.stringify(data));
    setSession(data);
    loadData();
  };

  const handleSignOut = () => {
    sbSignOut().catch(()=>{});
    AUTH_TOKEN = null;
    localStorage.removeItem("4602banks_session");
    setSession(null);
    setTeam([]); setPhases([]); setProjects([]); setTasks([]); setExpenses([]); setEvents([]); setQuotes([]); setProceeds([]);
  };

  // Restore session on mount (dev bypass when import.meta.env.DEV)
  useEffect(()=>{
    const saved = localStorage.getItem("4602banks_session");
    if(saved) {
      try {
        const data = JSON.parse(saved);
        const exp = data?.expires_at || 0;
        if(Date.now()/1000 < exp) {
          AUTH_TOKEN = data.access_token;
          setSession(data);
          loadData();
          return;
        } else {
          localStorage.removeItem("4602banks_session");
        }
      } catch(e) {
        localStorage.removeItem("4602banks_session");
      }
    }
    // Dev bypass: load seed data or restore persisted dev data
    if(import.meta.env.DEV && !saved) {
      setSession({user:{email:"dev@localhost"}});
      const devData = localStorage.getItem("4602banks_dev_data");
      if(devData) {
        try {
          const d = JSON.parse(devData);
          const dedup = arr => { const seen=new Set(); return (arr||[]).filter(r=>{ if(!r||seen.has(r.id))return false; seen.add(r.id); return true; }); };
          if(d.projects) setProjects(dedup(d.projects));
          if(d.tasks) setTasks(dedup(d.tasks));
          if(d.expenses) setExpenses(dedup(d.expenses));
          if(d.events) setEvents(dedup(d.events));
          if(d.quotes) setQuotes(dedup(d.quotes));
          if(d.proceeds) setProceeds(dedup(d.proceeds));
          if(d.team) setTeam(dedup(d.team));
          return;
        } catch(e) { localStorage.removeItem("4602banks_dev_data"); }
      }
      setProjects(PHASES_SEED.map(p=>({...p,project_id:null,target_budget:p.budget,contingency:0,photos:[],datesMode:"manual",phase_id:null})));
      setTasks(TASKS_SEED.map(t=>({...t,start:t.start,end:t.end,actual_cost:null,photos:[]})));
      setExpenses(EXPENSES_SEED.map(e=>({...e,date:e.date})));
      setEvents(EVENTS_SEED.map(e=>({...e,date:e.date,type:e.type,time:""})));
      setQuotes(QUOTES_SEED);
      setProceeds([
        {id:1,label:"B. Guthrie",amount:10000,received_date:"2026-01-15",notes:"contribution"},
        {id:2,label:"L. Fruend",amount:10000,received_date:"2026-01-20",notes:"contribution"},
        {id:3,label:"D. Chavez",amount:16000,received_date:"2026-01-25",notes:"contribution"},
        {id:4,label:"E. Diaz",amount:14000,received_date:"2026-02-01",notes:"contribution"},
        {id:5,label:"E. Guthrie",amount:5000,received_date:"2026-02-05",notes:"contribution"},
        {id:6,label:"Seller Credit (closing)",amount:13500,received_date:"2026-02-10",notes:"credit"},
        {id:7,label:"Seller Credit (repairs)",amount:11200,received_date:"2026-02-10",notes:"credit"},
      ]);
    }
  }, []);

  // Persist dev data to localStorage so changes survive reload
  useEffect(()=>{
    if(!import.meta.env.DEV || !session?.user?.email?.includes("dev@localhost")) return;
    const timer = setTimeout(()=>{
      localStorage.setItem("4602banks_dev_data", JSON.stringify({projects,tasks,expenses,events,quotes,proceeds,team}));
    }, 300);
    return ()=>clearTimeout(timer);
  },[projects,tasks,expenses,events,quotes,proceeds,team,session]);

  // Debounced quote save to DB (must be before early return to maintain hook order)
  const quoteSaveTimers = useRef({});
  const persistQuote = useCallback((quoteId) => {
    if(_isDev()) return;
    if(quoteSaveTimers.current[quoteId]) clearTimeout(quoteSaveTimers.current[quoteId]);
    quoteSaveTimers.current[quoteId] = setTimeout(()=>{
      setQuotes(prev => {
        const q = prev.find(x=>x.id===quoteId);
        if(!q) return prev;
        sbPatch("quotes", quoteId, {project_id:q.project_id, task_id:q.task_id||null, awarded_to:q.awarded_to, notes:q.notes||""}).catch(console.error);
        sbFetch(`/rest/v1/quote_contractors?quote_id=eq.${quoteId}`,{method:"DELETE"}).then(()=>{
          sbFetch(`/rest/v1/quote_items?quote_id=eq.${quoteId}`,{method:"DELETE"}).then(()=>{
            const cInserts = q.contractors.map((c,i)=>
              sbInsertRow("quote_contractors",{quote_id:quoteId,name:c.name,phone:c.phone||"",email:c.email||"",sort_order:i})
                .then(cr=>cr?.[0]?[c.id,cr[0].id]:null)
            );
            Promise.all(cInserts).then(idPairs=>{
              const cIdMap = Object.fromEntries(idPairs.filter(Boolean));
              q.items.forEach((item,i)=>{
                sbInsertRow("quote_items",{quote_id:quoteId,label:item.label,sort_order:i}).then(ir=>{
                  if(!ir?.[0]) return;
                  const dbItemId = ir[0].id;
                  Object.entries(item.amounts||{}).forEach(([localCId,amount])=>{
                    const dbCId = cIdMap[localCId];
                    if(dbCId && amount) sbInsertRow("quote_item_amounts",{quote_item_id:dbItemId,contractor_id:dbCId,amount}).catch(console.error);
                  });
                }).catch(console.error);
              });
            });
          }).catch(console.error);
        }).catch(console.error);
        return prev;
      });
    }, 1000);
  },[]);

  if(!session) return <LoginPage onLogin={handleLogin}/>;

  const navigate=(type,projectId,taskId)=>{
    if(type==="dashboard"||type==="phases"||type==="projects"||type==="timeline"||type==="weekly"||type==="tasks"||type==="quotes"||type==="budget"||type==="team"||type==="events"||type==="settings"){setView(type);setPage(null);return;}
    if(type==="project"){setPage({type:"project",projectId,taskId:taskId||null});return;}
  };

  const updateProject=(id,fn)=>setProjects(prev=>prev.map(p=>p.id===id?fn(p):p));
  const updateTask=(id,fn)=>setTasks(prev=>prev.map(t=>t.id===id?fn(t):t));

  const updateQuote=(id,fn,newQuote)=>{
    if(newQuote){
      // Persist new quote to DB
      sbInsertRow("quotes",{project_id:newQuote.project_id,task_id:newQuote.task_id||null,awarded_to:null,notes:""}).then(rows=>{
        if(!rows?.[0]) return;
        const dbId=rows[0].id;
        const q={...newQuote,id:dbId};
        setQuotes(prev=>[...prev,q]);
        // Insert contractors
        const cInserts=newQuote.contractors.map((c,i)=>sbInsertRow("quote_contractors",{quote_id:dbId,name:c.name,phone:c.phone||"",email:c.email||"",sort_order:i}).then(cr=>[c.id,cr?.[0]?.id]));
        Promise.all(cInserts).then(idMap=>{
          const cIdMap=Object.fromEntries(idMap.filter(Boolean));
          newQuote.items.forEach((item,i)=>{
            sbInsertRow("quote_items",{quote_id:dbId,label:item.label,sort_order:i}).then(ir=>{
              if(!ir?.[0]) return;
              const dbItemId=ir[0].id;
              Object.entries(item.amounts).forEach(([localCId,amount])=>{
                const dbCId=cIdMap[localCId];
                if(dbCId) sbInsertRow("quote_item_amounts",{quote_item_id:dbItemId,contractor_id:dbCId,amount}).catch(console.error);
              });
            }).catch(console.error);
          });
        });
      }).catch(console.error);
      return;
    }
    setQuotes(prev=>prev.map(q=>q.id===id?fn(q):q));
    persistQuote(id);
  };

  const deleteProject = id => {
    setProjects(prev=>prev.filter(p=>p.id!==id));
    setTasks(prev=>prev.filter(t=>t.project_id!==id));
    sbDel("projects", id).catch(console.error);
  };

  const addTasks = newTasks => {
    // If tasks already have an id (already inserted, e.g. from SubtaskPanel), just add to state
    const alreadyInserted = newTasks.filter(t=>t.id);
    const toInsert = newTasks.filter(t=>!t.id);
    if(alreadyInserted.length) setTasks(prev=>[...prev,...alreadyInserted]);
    if(!toInsert.length) return;
    const dbTasks = toInsert.map(t=>({
      project_id:t.project_id, title:t.title, assignee:t.assignee||"",
      start_date:t.start||TODAY, end_date:t.end||addDays(TODAY,7),
      status:"todo", notes:t.notes||"", sort_order:0,
    }));
    Promise.all(dbTasks.map(dt=>sbInsertRow("tasks",dt))).then(results=>{
      const inserted = results.flat().filter(Boolean).map(mapTask);
      setTasks(prev=>[...prev,...inserted]);
    }).catch(console.error);
  };

  const addBudgetItems = (items, phaseId) => {
    const dbItems = items.map(item=>({
      project_id:projectId, category:"Materials", vendor:"Est. (AI)",
      amount:Math.round((item.low+item.high)/2), expense_date:TODAY,
      notes:item.label||"", is_estimate:true,
    }));
    Promise.all(dbItems.map(di=>sbInsertRow("expenses",di))).then(results=>{
      const inserted = results.flat().filter(Boolean).map(mapExpense);
      setExpenses(prev=>[...prev,...inserted]);
    }).catch(console.error);
  };

  const showProjectPage=page?.type==="project";
  const activeProject=showProjectPage?projects.find(p=>p.id===page.projectId):null;
  const userEmail = session?.user?.email || "";

  const nav=[{id:"dashboard",label:"Overview"},{id:"phases",label:"Phases"},{id:"projects",label:"Projects"},{id:"timeline",label:"Timeline"},{id:"tasks",label:"Tasks"},{id:"quotes",label:"Quotes"},{id:"team",label:"Team"},{id:"events",label:"Events"},{id:"settings",label:"Settings"}];

  if(loading) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:C.bg,fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:13,color:C.muted}}>Loading 4602 Banks…</div>
      </div>
    </div>
  );

  return (
    <div style={{display:"flex",height:"100vh",background:C.bg,fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",overflow:"hidden"}}>
      <style>{`*{box-sizing:border-box;margin:0;padding:0;}::-webkit-scrollbar{width:6px;}::-webkit-scrollbar-thumb{background:#D5D5D3;border-radius:3px;}button:focus{outline:none;}textarea,input,select{font-family:inherit;}select{-webkit-appearance:none;}`}</style>
      <div style={{width:220,background:C.sidebar,borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",flexShrink:0,padding:"16px 8px"}}>
        <div style={{padding:"8px 10px 16px"}}>
          <p style={{fontSize:14,fontWeight:700,color:C.text,letterSpacing:"-0.2px"}}>4602 Banks</p>
          <p style={{fontSize:11,color:C.muted,marginTop:2}}>New Orleans, LA</p>
        </div>
        <div style={{height:1,background:C.divider,margin:"0 10px 10px"}}/>
        <nav style={{flex:1,overflowY:"auto"}}>
          {nav.map(item=>{const active=view===item.id&&!showProjectPage;return(
            <button key={item.id} onClick={()=>{setView(item.id);setPage(null);}} style={{display:"flex",alignItems:"center",width:"100%",padding:"7px 10px",borderRadius:6,border:"none",cursor:"pointer",marginBottom:1,background:active?C.hover:"transparent",color:active?C.text:C.sideText,fontSize:13,fontWeight:active?500:400,textAlign:"left",transition:"background 0.1s"}}>
              {item.label}
            </button>
          );})}
          <div style={{height:1,background:C.divider,margin:"10px 2px"}}/>
          {phases.map((fa,fi)=>{
            const faProjects=projects.filter(p=>p.phase_id===fa.id);
            const isAddingHere = sidebarAddingPhase===fa.id;
            return(
              <div key={fa.id}>
                <div style={{display:"flex",alignItems:"center",padding:"4px 10px 4px",marginTop:fi>0?8:0}}
                  onMouseEnter={e=>e.currentTarget.querySelector(".addproj").style.opacity="1"}
                  onMouseLeave={e=>e.currentTarget.querySelector(".addproj").style.opacity="0"}>
                  <p style={{fontSize:10,fontWeight:600,color:C.faint,textTransform:"uppercase",letterSpacing:"0.08em",flex:1}}>{fa.name}</p>
                  <button className="addproj" onClick={()=>{setSidebarAddingPhase(fa.id);setSidebarNewProject("");setTimeout(()=>sidebarInputRef.current?.focus(),0);}}
                    style={{background:"none",border:"none",cursor:"pointer",color:C.faint,fontSize:14,padding:"0 2px",lineHeight:1,opacity:0,transition:"opacity 0.1s"}}>+</button>
                </div>
                {faProjects.map(pr=>{const active=showProjectPage&&page.projectId===pr.id;return(
                  <button key={pr.id} onClick={()=>navigate("project",pr.id)} style={{display:"flex",alignItems:"center",gap:7,width:"100%",padding:"6px 10px",borderRadius:6,border:"none",cursor:"pointer",marginBottom:1,background:active?C.hover:"transparent",color:active?C.text:C.sideText,fontSize:12,textAlign:"left",transition:"background 0.1s"}}>
                    <div style={{width:6,height:6,borderRadius:2,background:pc(pr.id),flexShrink:0}}/>{pr.name}
                  </button>
                );})}
                {isAddingHere&&(
                  <div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 10px"}}>
                    <div style={{width:6,height:6,borderRadius:2,background:C.faint,flexShrink:0}}/>
                    <input ref={sidebarInputRef} defaultValue=""
                      onKeyDown={e=>{
                        if(e.key==="Enter"){
                          e.preventDefault();
                          const title=(sidebarInputRef.current?.value||"").trim();
                          if(!title){setSidebarAddingPhase(null);return;}
                          const dbProj={name:title,status:"planning",budget:0,start_date:null,end_date:null,notes:"",phase_id:fa.id,sort_order:projects.length};
                          if(sidebarInputRef.current) sidebarInputRef.current.value="";
                          setSidebarAddingPhase(null);
                          sbInsertRow("projects",dbProj).then(rows=>{if(rows?.[0])setProjects(prev=>[...prev,mapProject(rows[0])]);}).catch(console.error);
                        }
                        if(e.key==="Escape") setSidebarAddingPhase(null);
                      }}
                      onBlur={()=>setSidebarAddingPhase(null)}
                      placeholder="Project name…"
                      style={{flex:1,fontSize:12,border:"none",outline:"none",background:"transparent",fontFamily:"inherit",color:C.text,padding:0}}/>
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div style={{padding:"10px",borderTop:`1px solid ${C.divider}`,marginTop:8}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
            <div style={{width:7,height:7,borderRadius:"50%",background:C.green}}/>
            <span style={{fontSize:11,color:C.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{userEmail}</span>
          </div>
        </div>
      </div>

      {/* Main area */}
      <div style={{flex:1,overflowY:"auto",position:"relative"}}>
        {showProjectPage&&activeProject&&<ProjectPage project={activeProject} tasks={tasks} expenses={expenses} quotes={quotes} phases={phases} initialTaskId={page?.taskId||null} onNavigate={navigate} onUpdateProject={updateProject} onUpdateTask={updateTask} onUpdateQuote={updateQuote} onAddTasks={addTasks} onAddBudgetItems={addBudgetItems} onDeleteProject={deleteProject} onAddEvent={ev=>setEvents(prev=>[...prev,ev])} team={team}/>}
        {!showProjectPage&&<>
          {view==="phases"   &&<PhasesView phases={phases} projects={projects} onNavigate={navigate} onAddPhase={fa=>setPhases(prev=>[...prev,fa])} onUpdatePhase={(id,upd)=>setPhases(prev=>prev.map(f=>f.id===id?{...f,...upd}:f))} onDeletePhase={id=>setPhases(prev=>prev.filter(f=>f.id!==id))}/> }
          {view==="dashboard"&&<Dashboard projects={projects} phases={phases} tasks={tasks} expenses={expenses} events={events} proceeds={proceeds} onNavigate={navigate}/>}
          {view==="projects"   &&<ProjectsView phases={phases} projects={projects} setProjects={setProjects} tasks={tasks} expenses={expenses} onNavigate={navigate} onAddProject={p=>setProjects(prev=>[...prev,p])}/>}
          {view==="timeline" &&<TimelineView projects={projects} setProjects={setProjects} tasks={tasks} setTasks={setTasks} onNavigate={navigate} proceeds={proceeds} setProceeds={setProceeds} phases={phases} expenses={expenses} quotes={quotes} updateQuote={updateQuote} team={team} events={events} setEvents={setEvents}/>}
          {view==="weekly"   &&<WeeklyView projects={projects} tasks={tasks} setTasks={setTasks} onNavigate={navigate}/>}
          {view==="tasks"    &&<TasksGrid tasks={tasks} setTasks={setTasks} projects={projects} setProjects={setProjects} onNavigate={navigate} team={team} setTeam={setTeam}/>}
          {view==="quotes"   &&<QuotesView quotes={quotes} projects={projects} tasks={tasks} setQuotes={setQuotes} setTasks={setTasks} updateQuote={updateQuote} onNavigate={navigate}/>}

          {view==="team"     &&<TeamView team={team} setTeam={setTeam} tasks={tasks} projects={projects}/>}
          {view==="events"   &&<EventsView events={events} setEvents={setEvents} projects={projects}/>}
          {view==="settings" &&(
            <div style={{padding:"32px 40px",maxWidth:500}}>
              <h2 style={{fontSize:18,fontWeight:700,color:C.text,letterSpacing:"-0.2px",marginBottom:20}}>Settings</h2>
              <div style={{border:`1px solid ${C.border}`,borderRadius:8,background:C.surface,padding:18,marginBottom:16}}>
                <p style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:3}}>iCal sync</p>
                <p style={{fontSize:12,color:C.muted,marginBottom:12}}>Subscribe in Apple Calendar, Google Calendar, or Outlook. Updates hourly.</p>
                <div style={{display:"flex",gap:8}}>
                  <div style={{flex:1,background:C.bg,border:`1px solid ${C.border}`,borderRadius:5,padding:"8px 10px",fontSize:11,color:C.muted,fontFamily:"monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>https://4602banks.vercel.app/api/ical?token=abc123</div>
                  <Btn variant="primary" onClick={()=>navigator.clipboard.writeText("https://4602banks.vercel.app/api/ical?token=abc123").catch(()=>{})}>Copy</Btn>
                </div>
              </div>
              <div style={{border:`1px solid ${C.border}`,borderRadius:8,background:C.surface,padding:18}}>
                <p style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:3}}>Account</p>
                <p style={{fontSize:12,color:C.muted,marginBottom:12}}>Signed in as {userEmail}</p>
                <Btn variant="danger" onClick={handleSignOut}>Sign out</Btn>
              </div>
            </div>
          )}
        </>}

        {/* Global AI floating button */}
        <button onClick={()=>setGlobalAI(s=>!s)} style={{
          position:"fixed",bottom:24,right:24,width:44,height:44,borderRadius:"50%",
          background:globalAI?C.text:C.accent,color:"white",border:"none",
          fontSize:18,cursor:"pointer",boxShadow:"0 2px 12px rgba(0,0,0,0.18)",
          display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,
          transition:"background 0.2s,transform 0.15s",
        }}
          title="AI assistant"
          onMouseEnter={e=>e.currentTarget.style.transform="scale(1.08)"}
          onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}
        >{globalAI?"✕":"✦"}</button>

        {/* Global AI slide-up panel */}
        {globalAI&&(
          <div style={{
            position:"fixed",bottom:80,right:24,width:480,maxHeight:"70vh",
            borderRadius:12,boxShadow:"0 8px 32px rgba(0,0,0,0.16)",
            border:`1px solid ${C.border}`,background:C.surface,
            overflowY:"auto",zIndex:99,
          }}>
            <div style={{padding:"14px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",background:C.bg,borderRadius:"12px 12px 0 0"}}>
              <div>
                <p style={{fontSize:13,fontWeight:700,color:C.text}}>AI Assistant</p>
                <p style={{fontSize:11,color:C.muted}}>4602 Banks — project level</p>
              </div>
              <button onClick={()=>setGlobalAI(false)} style={{background:"none",border:"none",cursor:"pointer",color:C.muted,fontSize:16}}>✕</button>
            </div>
            <div style={{padding:16}}>
              <AIPanel
                phase={null}
                projects={projects}
                tasks={tasks}
                onAddTasks={addTasks}
                onAddBudgetItems={addBudgetItems}
                compact={true}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
