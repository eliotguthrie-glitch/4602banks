import { useState, useMemo, useRef, useEffect, useCallback } from "react";

// ── Supabase ───────────────────────────────────────────────────────────────
const SB_URL = "https://wsitewxcjuevhujckvsm.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndzaXRld3hjanVldmh1amNrdnNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5ODcxOTcsImV4cCI6MjA4ODU2MzE5N30.VhlZ2Gt8apYzQQO-vXz4bSIkEkTOdDmpwkPME69FPBQ";
let AUTH_TOKEN = null; // set on login, referenced by all mutations

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

const sbSignIn  = (email, pw) => sbFetch("/auth/v1/token?grant_type=password", {method:"POST", body:JSON.stringify({email,password:pw})});
const sbSignOut = ()          => sbFetch("/auth/v1/logout", {method:"POST"});
const sbQ       = (table, qs) => sbFetch("/rest/v1/"+table+(qs?"?"+qs:"?select=*"));
const sbInsertRow = (table, data) => sbFetch("/rest/v1/"+table, {method:"POST", headers:{"Prefer":"return=representation"}, body:JSON.stringify(data)});
const sbPatch   = (table, id, data) => sbFetch("/rest/v1/"+table+"?id=eq."+id, {method:"PATCH", headers:{"Prefer":"return=representation"}, body:JSON.stringify(data)});
const sbDel     = (table, id) => sbFetch("/rest/v1/"+table+"?id=eq."+id, {method:"DELETE"});

// DB → app field mappers
const mapProject   = p => ({...p, start:p.start_date, end:p.end_date, photos:[]});
const mapTask    = t => ({...t, start:t.start_date, end:t.end_date, photos:[]});
const mapEvent   = e => ({...e, date:e.event_date, type:e.event_type, time:e.event_time||""});
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
  {id:6, project_id:2,title:"Order cabinets",               start:"2026-03-25",end:"2026-04-05",status:"todo",        assignee:"Elysha",       notes:"IKEA SEKTION or semi-custom. Lead time ~6 weeks.",photos:[]},
  {id:7, project_id:2,title:"Demo existing kitchen",        start:"2026-04-10",end:"2026-04-22",status:"todo",        assignee:"GC",           notes:"",photos:[]},
  {id:8, project_id:2,title:"Cabinet installation",         start:"2026-05-01",end:"2026-05-28",status:"todo",        assignee:"GC",           notes:"",photos:[]},
  {id:9, project_id:2,title:"Countertop template + install",start:"2026-06-01",end:"2026-06-16",status:"todo",        assignee:"GC",           notes:"Quartz preferred.",photos:[]},
  {id:10,project_id:2,title:"Appliance hookup",             start:"2026-06-20",end:"2026-06-30",status:"todo",        assignee:"GC",           notes:"",photos:[]},
  {id:11,project_id:3,title:"Tile selection",               start:"2026-05-01",end:"2026-05-10",status:"todo",        assignee:"Elysha",       notes:"",photos:[]},
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
const fmtFull     = s    => s ? new Date(s+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "—";
const fmtM        = n    => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(n);
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

  const commitSub = () => {
    const title = (subRef.current?.value||"").trim();
    if(!title) { setAddingSub(false); return; }
    const dbTask = {project_id:projectId, title, parent_task_id:taskId, assignee:"", start_date:null, end_date:null, status:"todo", notes:"", sort_order:0};
    if(subRef.current) subRef.current.value = "";
    setAddingSub(false);
    sbInsertRow("tasks", dbTask).then(rows=>{ if(rows?.[0]) onAddTask(mapTask(rows[0])); }).catch(console.error);
  };

  return (
    <div style={{border:`1px solid ${C.border}`,borderRadius:8,background:C.surface,marginBottom:16}}>
      <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.divider}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <p style={{fontSize:13,fontWeight:600,color:C.text}}>Subtasks <span style={{fontWeight:400,color:C.muted,fontSize:12}}>{subtasks.filter(t=>t.status==="complete").length}/{subtasks.length}</span></p>
        <button onClick={()=>setAddingSub(true)} style={{fontSize:12,color:C.accent,background:"none",border:"none",cursor:"pointer",padding:0,fontWeight:500}}>+ Add</button>
      </div>
      {subtasks.map((st,i)=>(
        <div key={st.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 16px",borderBottom:(i<subtasks.length-1||addingSub)?`1px solid ${C.divider}`:"none"}}
          onMouseEnter={e=>e.currentTarget.style.background=C.hover} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
          <div onClick={()=>{const ns=st.status==="complete"?"todo":"complete";onUpdateTask(st.id,t=>({...t,status:ns}));sbPatch("tasks",st.id,{status:ns}).catch(console.error);}}
            style={{width:13,height:13,borderRadius:2,flexShrink:0,cursor:"pointer",border:"1.5px solid "+(st.status==="complete"?C.green:C.faint),background:st.status==="complete"?C.green:"transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>
            {st.status==="complete"&&<svg width="7" height="7" viewBox="0 0 8 8" fill="none"><path d="M1.5 4L3.5 6L6.5 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
          </div>
          <span style={{fontSize:13,flex:1,color:st.status==="complete"?C.muted:C.text,textDecoration:st.status==="complete"?"line-through":"none"}}>{st.title}</span>
          {st.assignee&&<span style={{fontSize:11,color:C.muted}}>{st.assignee}</span>}
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
  const convertToEvent = () => {
    const ev = {
      title: task.title,
      event_date: task.start,
      event_type: "milestone",
      project_id: task.project_id,
      notes: task.notes||"",
      done: false,
    };
    sbInsertRow("events", ev).then(rows=>{
      if(rows?.[0]) onAddEvent(mapEvent(rows[0]));
      setAddedToCalendar(true);
    }).catch(console.error);
  };
  const taskQuote = (quotes||[]).find(q=>q.task_id===task.id);
  const taskQuoteTotals = taskQuote ? (() => {
    const t={};
    taskQuote.contractors.forEach(c=>{t[c.id]=taskQuote.items.reduce((s,item)=>s+(item.amounts[c.id]||0),0);});
    return t;
  })() : {};

  return (
    <div style={{padding:"32px 40px",maxWidth:820}}>
      <Breadcrumb crumbs={[{label:"Overview",onClick:()=>onNavigate("dashboard")},{label:phase.name,onClick:onBack},{label:task.title}]}/>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:24}}>
        <div>
          <h1 style={{fontSize:22,fontWeight:700,color:C.text,letterSpacing:"-0.3px",marginBottom:8}}>{task.title}</h1>
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <Chip status={task.status}/>
            <span style={{fontSize:12,color:C.muted}}>{fmtFull(task.start)} → {fmtFull(task.end)}</span>
            <span style={{fontSize:12,color:C.muted}}>{task.start&&task.end?"· "+daysBetween(task.start,task.end)+" days":""}</span>
          </div>
        </div>
        <div style={{display:"flex",gap:6,flexShrink:0,alignItems:"center"}}>
          {addedToCalendar
            ? <span style={{fontSize:12,color:C.green,fontWeight:500}}>✓ Added to calendar</span>
            : <button onClick={convertToEvent} style={{padding:"5px 10px",fontSize:12,fontWeight:500,borderRadius:5,cursor:"pointer",border:`1px solid ${C.border}`,background:C.surface,color:C.muted,marginRight:4}}>Add to calendar</button>
          }
          {[{s:"todo",label:"To do"},{s:"complete",label:"Done"}].map(({s,label})=>(
            <button key={s} onClick={()=>{onUpdateTask(task.id,t=>({...t,status:s}));sbPatch("tasks",task.id,{status:s}).catch(console.error);}} style={{padding:"5px 14px",fontSize:12,fontWeight:500,borderRadius:5,cursor:"pointer",border:`1px solid ${task.status===s?C.accent:C.border}`,background:task.status===s?C.accentBg:C.surface,color:task.status===s?C.accent:C.muted}}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab nav */}
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
      <div style={{border:`1px solid ${C.border}`,borderRadius:8,background:C.surface,marginBottom:16}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr 1fr"}}>
          {[
            {label:"Project",value:<div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:7,height:7,borderRadius:2,background:pc(phase.id)}}/><span style={{fontSize:13,color:C.text}}>{phase.name}</span></div>},
            {label:"Assignee",value:(
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <Avatar name={task.assignee}/>
                <select value={task.assignee||""} onChange={e=>{const v=e.target.value;onUpdateTask(task.id,t=>({...t,assignee:v}));sbPatch("tasks",task.id,{assignee:v}).catch(console.error);}}
                  style={{fontSize:13,color:C.text,border:"none",background:"transparent",fontFamily:"inherit",outline:"none",cursor:"pointer",appearance:"none",WebkitAppearance:"none"}}>
                  <option value="">— Unassigned —</option>
                  {(team||[]).map(m=><option key={m.id} value={m.name}>{m.name}</option>)}
                </select>
              </div>
            )},
            {label:"Duration",value:<span style={{fontSize:13,color:C.text}}>{task.end?daysBetween(task.start,task.end)+" days":"—"}</span>},
            {label:"Cost ($)",value:(
              <input type="number" min="0" defaultValue={task.price||""} placeholder="0"
                onBlur={e=>{const v=parseFloat(e.target.value)||0;onUpdateTask(task.id,t=>({...t,price:v}));sbPatch("tasks",task.id,{price:v}).catch(console.error);}}
                style={{fontSize:13,color:C.text,border:"none",background:"transparent",fontFamily:"inherit",outline:"none",padding:0,width:"100%"}}/>
            )},
          ].map(({label,value},i)=>(
            <div key={label} style={{padding:"14px 18px",borderRight:`1px solid ${C.divider}`}}>
              <p style={{fontSize:11,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>{label}</p>
              {value}
            </div>
          ))}
          <div style={{padding:"14px 18px",borderRight:`1px solid ${C.divider}`}}>
            <p style={{fontSize:11,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Start</p>
            <input type="date" value={task.start} onChange={e=>{
              const v=e.target.value;
              onUpdateTask(task.id,t=>({...t,start:v}));
              sbPatch("tasks",task.id,{start_date:v}).catch(console.error);
            }} style={{fontSize:13,color:C.text,border:"none",background:"transparent",fontFamily:"inherit",cursor:"pointer",outline:"none",padding:0,width:"100%"}}/>
          </div>
          <div style={{padding:"14px 18px"}}>
            <p style={{fontSize:11,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>End</p>
            <input type="date" value={task.end||""} onChange={e=>{
              const v=e.target.value||null;
              onUpdateTask(task.id,t=>({...t,end:v||""}));
              sbPatch("tasks",task.id,{end_date:v}).catch(console.error);
            }} style={{fontSize:13,color:C.text,border:"none",background:"transparent",fontFamily:"inherit",cursor:"pointer",outline:"none",padding:0,width:"100%"}}/>
          </div>
        </div>
      </div>

      <SubtaskPanel taskId={task.id} projectId={task.project_id} tasks={tasks||[]} onUpdateTask={onUpdateTask} onAddTask={onAddTask}/>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <div style={{border:`1px solid ${C.border}`,borderRadius:8,background:C.surface}}>
          <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.divider}`}}><p style={{fontSize:13,fontWeight:600,color:C.text}}>Notes</p></div>
          <div style={{padding:"12px 16px"}}>
            <NoteField value={task.notes||""} onChange={v=>onUpdateTask(task.id,t=>({...t,notes:v}))} placeholder="Add task notes..."/>
          </div>
        </div>
        <div style={{border:`1px solid ${C.border}`,borderRadius:8,background:C.surface}}>
          <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.divider}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <p style={{fontSize:13,fontWeight:600,color:C.text}}>Photos</p>
              <span style={{fontSize:11,color:C.muted}}>feeds to phase</span>
            </div>
          </div>
          <div style={{padding:"12px 16px"}}>
            <PhotoGrid photos={task.photos} onAdd={p=>onUpdateTask(task.id,t=>({...t,photos:[...(t.photos||[]),p]}))} onRemove={id=>onUpdateTask(task.id,t=>({...t,photos:(t.photos||[]).filter(p=>p.id!==id)}))}/>
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
  const [editForm,setEditForm]=useState({name:phase.name,status:phase.status,budget:phase.budget,start:phase.start,end:phase.end,notes:phase.notes||"",datesMode:phase.datesMode||"manual",phase_id:phase.phase_id||""});
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
    const updated = {...phase, ...editForm, start:resolvedStart, end:resolvedEnd, budget:parseInt(editForm.budget)||0, phase_id:parseInt(editForm.phase_id)||null};
    onUpdateProject(phase.id, ()=>updated);
    sbPatch("projects", phase.id, {
      name:editForm.name, status:editForm.status, budget:parseInt(editForm.budget)||0,
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
              <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Budget ($)</p>
              <Input value={String(editForm.budget)} onChange={v=>setEditForm(f=>({...f,budget:v}))}/>
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
              <Chip status={phase.status}/>
              <span style={{fontSize:12,color:C.muted}}>{fmtFull(phase.start)} → {fmtFull(phase.end)}</span>
              <span style={{fontSize:12,color:C.muted}}>· {daysBetween(phase.start,phase.end)} days</span>
            </div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
          <div style={{textAlign:"right",flexShrink:0}}>
            <p style={{fontSize:11,color:C.muted,marginBottom:2}}>Budget</p>
            <p style={{fontSize:18,fontWeight:600,color:C.text,fontVariantNumeric:"tabular-nums"}}>{fmtM(phase.budget)}</p>
            <p style={{fontSize:12,color:C.muted}}>{fmtM(spent)} spent · {fmtM(phase.budget-spent)} left</p>
          </div>
          <Btn onClick={()=>{setEditing(s=>!s);setConfirmDelete(false);setEditForm({name:phase.name,status:phase.status,budget:phase.budget,start:phase.start,end:phase.end,notes:phase.notes||"",datesMode:phase.datesMode||"manual",phase_id:phase.phase_id||""});}}>
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
                {t.price>0&&<span style={{fontSize:11,color:C.muted,fontVariantNumeric:"tabular-nums"}}>{fmtM(t.price)}</span>}{((t.photos||[]).length>0||t.notes)&&<span style={{fontSize:11,color:C.faint}}>{(t.photos||[]).length>0?"📷":""}{t.notes?"📝":""}</span>}
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
                {[{l:"Budgeted",v:fmtM(phase.budget)},{l:"Spent",v:fmtM(spent)},{l:"Remaining",v:fmtM(phase.budget-spent)}].map(({l,v})=>(
                  <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${C.divider}`}}>
                    <span style={{fontSize:12,color:C.muted}}>{l}</span>
                    <span style={{fontSize:13,color:C.text,fontWeight:500,fontVariantNumeric:"tabular-nums"}}>{v}</span>
                  </div>
                ))}
                <div style={{marginTop:10,height:4,background:C.divider,borderRadius:2}}>
                  <div style={{height:"100%",width:`${Math.min(100,(spent/phase.budget)*100)}%`,background:pc(phase.id),borderRadius:2}}/>
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

// ── EVENTS VIEW ────────────────────────────────────────────────────────────
function EventsView({events,setEvents,projects}) {
  const [showAdd,setShowAdd]=useState(false);
  const [form,setForm]=useState({date:"",time:"",title:"",type:"inspection",project_id:"",notes:""});

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
    const dbEvent = {
      event_date:form.date, event_time:form.time||null, title:form.title, event_type:form.type,
      project_id:form.project_id?parseInt(form.project_id):null,
      notes:form.notes, done:false,
    };
    setForm({date:"",time:"",title:"",type:"inspection",project_id:"",notes:""});
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
        <Btn variant="primary" onClick={()=>setShowAdd(s=>!s)}>+ Add event</Btn>
      </div>

      {/* Add form */}
      {showAdd&&(
        <div style={{border:`1px solid ${C.border}`,borderRadius:8,background:C.surface,padding:20,marginBottom:24}}>
          <p style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:14}}>New event</p>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:10}}>
            <div>
              <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Date</p>
              <input type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}
                style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:5,padding:"7px 10px",fontSize:13,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none"}}/>
            </div>
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
          <div style={{marginBottom:10}}>
            <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Title</p>
            <Input value={form.title} onChange={v=>setForm(f=>({...f,title:v}))} placeholder="Event title"/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
            <div>
              <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Project (optional)</p>
              <select value={form.project_id} onChange={e=>setForm(f=>({...f,project_id:e.target.value}))}
                style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:5,padding:"7px 10px",fontSize:13,color:C.text,background:C.surface,fontFamily:"inherit",outline:"none",appearance:"none"}}>
                <option value="">— No project —</option>
                {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{marginBottom:14}}>
            <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Notes</p>
            <NoteField value={form.notes} onChange={v=>setForm(f=>({...f,notes:v}))} placeholder="Any details..." rows={2}/>
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
              return (
                <div key={ev.id} style={{display:"flex",alignItems:"flex-start",gap:12,padding:"12px 16px",borderBottom:i<evs.length-1?`1px solid ${C.divider}`:"none",opacity:ev.done?0.5:1}}>
                  {/* Date column */}
                  <div style={{width:48,flexShrink:0,textAlign:"center",paddingTop:1}}>
                    <p style={{fontSize:18,fontWeight:700,color:isPast?C.faint:C.text,lineHeight:1,fontVariantNumeric:"tabular-nums"}}>{new Date(ev.date+"T12:00:00").getDate()}</p>
                    <p style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.04em"}}>{new Date(ev.date+"T12:00:00").toLocaleDateString("en-US",{month:"short"})}</p>
                  </div>
                  {/* Color bar */}
                  <div style={{width:3,alignSelf:"stretch",background:col,borderRadius:2,flexShrink:0,minHeight:36}}/>
                  {/* Content */}
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:3}}>
                      <span style={{fontSize:11,fontWeight:600,color:col,textTransform:"uppercase",letterSpacing:"0.04em"}}>{eventLabel(ev.type)}</span>
                      {ph&&<><span style={{color:C.faint,fontSize:11}}>·</span><span style={{fontSize:11,color:C.muted}}>{ph.name}</span></>}
                    </div>
                    <p style={{fontSize:13,fontWeight:500,color:ev.done?C.muted:C.text,textDecoration:ev.done?"line-through":"none"}}>{ev.title}</p>
                    {ev.time&&<p style={{fontSize:12,color:C.muted,marginTop:2}}>{ev.time}</p>}{ev.notes&&<p style={{fontSize:12,color:C.muted,marginTop:3,lineHeight:1.4}}>{ev.notes}</p>}
                  </div>
                  {/* Actions */}
                  <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
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
function Dashboard({projects,tasks,expenses,events,phases,onNavigate}) {
  const phaseDateRange = (faId) => {
    const ps = projects.filter(p=>String(p.phase_id)===String(faId)&&p.start&&p.end);
    if(!ps.length) return {start:null,end:null};
    return {
      start: ps.reduce((min,p)=>p.start<min?p.start:min, ps[0].start),
      end:   ps.reduce((max,p)=>p.end>max?p.end:max,     ps[0].end),
    };
  };
  const spent=expenses.reduce((s,e)=>s+e.amount,0);
  const allocated=projects.reduce((s,p)=>s+p.budget,0);
  const done=tasks.filter(t=>t.status==="complete").length;
  const upcoming=[...tasks].filter(t=>t.status!=="complete").sort((a,b)=>toMs(a.end)-toMs(b.end)).slice(0,6);
  const upcomingEvents=[...events].filter(e=>!e.done&&toMs(e.date)>=toMs(TODAY)).sort((a,b)=>toMs(a.date)-toMs(b.date)).slice(0,4);

  return (
    <div style={{padding:"32px 40px",maxWidth:960}}>
      <div style={{marginBottom:22}}>
        <p style={{fontSize:13,color:C.muted,marginBottom:3}}>{PROJECT.address}</p>
        <h1 style={{fontSize:22,fontWeight:700,color:C.text,letterSpacing:"-0.3px"}}>{PROJECT.name}</h1>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:1,border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden",marginBottom:22,background:C.border}}>
        {[{l:"Total budget",v:fmtM(allocated)},{l:"Allocated",v:fmtM(allocated)},{l:"Spent",v:fmtM(spent)},{l:"Tasks done",v:`${done} / ${tasks.length}`}].map(({l,v})=>(
          <div key={l} style={{background:C.surface,padding:"14px 18px"}}>
            <p style={{fontSize:11,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:5}}>{l}</p>
            <p style={{fontSize:18,fontWeight:600,color:C.text,fontVariantNumeric:"tabular-nums"}}>{v}</p>
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1.2fr 1fr 0.8fr",gap:16}}>
        <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8}}>
          <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.divider}`}}><p style={{fontSize:13,fontWeight:600,color:C.text}}>Upcoming tasks</p></div>
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
            const s=expenses.filter(e=>e.project_id===ph.id).reduce((a,e)=>a+e.amount,0);
            return (
              <div key={ph.id} onClick={()=>onNavigate("project",ph.id)} style={{padding:"9px 16px",borderBottom:i<projects.length-1?`1px solid ${C.divider}`:"none",cursor:"pointer"}}
                onMouseEnter={e=>e.currentTarget.style.background=C.hover} onMouseLeave={e=>e.currentTarget.style.background="transparent"}
              >
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                  <div style={{width:7,height:7,borderRadius:2,background:pc(ph.id)}}/>
                  <span style={{fontSize:13,color:C.text,flex:1,fontWeight:500}}>{ph.name}</span>
                  <Chip status={ph.status}/>
                </div>
                <div style={{height:3,background:C.divider,borderRadius:2,marginLeft:15}}>
                  <div style={{height:"100%",width:`${Math.min(100,(s/ph.budget)*100)}%`,background:pc(ph.id),borderRadius:2}}/>
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
const LCOL=200;
function TimelineView({tasks,setTasks,projects,onNavigate}) {
  const pS=PROJECT.start,pE=PROJECT.end,projDays=daysBetween(pS,pE);
  const containerRef=useRef(null);
  const [drag,setDrag]=useState(null);
  const [groupBy,setGroupBy]=useState("phase"); // "phase" | "assignee" | "all"

  const months=useMemo(()=>{
    const res=[],s=new Date(pS+"T12:00:00"),e=new Date(pE+"T12:00:00");
    let c=new Date(s.getFullYear(),s.getMonth(),1);
    while(c<=e){
      const iso=`${c.getFullYear()}-${String(c.getMonth()+1).padStart(2,"0")}-01`;
      res.push({label:c.toLocaleDateString("en-US",{month:"short",year:"2-digit"}),pct:datePct(iso,pS,pE)});
      c=new Date(c.getFullYear(),c.getMonth()+1,1);
    }
    return res;
  },[]);

  const bw=useCallback(()=>containerRef.current?containerRef.current.getBoundingClientRect().width-LCOL:800,[]);
  const onDown=useCallback((e,id,type)=>{
    e.preventDefault();e.stopPropagation();
    const t=tasks.find(x=>x.id===id);if(!t)return;
    // If undated, assign placeholder dates at today so dragging can place them
    const start = t.start||TODAY;
    const end   = t.end||addDays(TODAY,7);
    if(!t.start||!t.end) setTasks(prev=>prev.map(x=>x.id===id?{...x,start,end}:x));
    setDrag({id,type,startX:e.clientX,origStart:start,origEnd:end,bw:bw()});
  },[tasks,bw]);

  useEffect(()=>{
    if(!drag)return;
    const mv=e=>{
      const dd=Math.round(((e.clientX-drag.startX)/drag.bw)*projDays);
      setTasks(prev=>prev.map(t=>{
        if(t.id!==drag.id)return t;
        if(!drag.origStart||!drag.origEnd)return t;
        if(drag.type==="move")return{...t,start:addDays(drag.origStart,dd),end:addDays(drag.origEnd,dd)};
        const ne=addDays(drag.origEnd,dd);
        return{...t,end:ne>drag.origStart?ne:addDays(drag.origStart,1)};
      }));
    };
    const up=()=>{
      if(drag){
        const t=tasks.find(x=>x.id===drag.id);
        if(t&&t.start&&t.end) sbPatch("tasks",drag.id,{start_date:t.start,end_date:t.end}).catch(console.error);
      }
      setDrag(null);
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
        onHeaderClick: ()=>onNavigate("project",ph.id),
        rows: tasks.filter(t=>t.project_id===ph.id && !t.parent_task_id),
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
        rows: [...tasks.filter(t=>t.assignee===a && t.start && t.end).sort((x,y)=>toMs(x.start)-toMs(y.start)), ...tasks.filter(t=>t.assignee===a && !t.start)],
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
      rows:[...tasks.filter(t=>t.start&&t.end).sort((a,b)=>toMs(a.start)-toMs(b.start)), ...tasks.filter(t=>!t.start)],
      taskColor:t=>t.status==="complete"?C.faint:pc(t.project_id),
    }];
  },[groupBy,tasks,projects]);

  const colLabel = groupBy==="phase"?"Phase / task" : groupBy==="assignee"?"Assignee / task" : "Task";

  return (
    <div style={{padding:"32px 40px",userSelect:"none",cursor:drag?(drag.type==="resize"?"ew-resize":"grabbing"):"default"}}>
      {/* Header row */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}>
        <div style={{display:"flex",alignItems:"baseline",gap:14}}>
          <h2 style={{fontSize:18,fontWeight:700,color:C.text,letterSpacing:"-0.2px"}}>Timeline</h2>
          <span style={{fontSize:12,color:C.muted}}>Drag to move · right edge to resize</span>
        </div>
        {/* Group-by toggle */}
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <span style={{fontSize:11,color:C.muted,fontWeight:500,marginRight:4}}>Group by</span>
          {[{id:"phase",label:"Project"},{id:"assignee",label:"Assignee"},{id:"all",label:"All"}].map(opt=>(
            <button key={opt.id} onClick={()=>setGroupBy(opt.id)} style={{
              padding:"4px 12px",fontSize:12,fontWeight:500,borderRadius:5,cursor:"pointer",
              border:`1px solid ${groupBy===opt.id?C.accent:C.border}`,
              background:groupBy===opt.id?C.accentBg:C.surface,
              color:groupBy===opt.id?C.accent:C.muted,
              transition:"all 0.1s",
            }}>{opt.label}</button>
          ))}
        </div>
      </div>

      <div ref={containerRef} style={{border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden",background:C.surface}}>
        {/* Month header */}
        <div style={{display:"flex",borderBottom:`1px solid ${C.border}`,background:C.bg}}>
          <div style={{width:LCOL,flexShrink:0,padding:"8px 16px",borderRight:`1px solid ${C.border}`}}>
            <span style={{fontSize:11,color:C.muted,fontWeight:500}}>{colLabel}</span>
          </div>
          <div style={{flex:1,position:"relative",height:32}}>
            {months.map(({label,pct},i)=>(
              <div key={i} style={{position:"absolute",left:`${pct}%`,top:0,bottom:0,display:"flex",alignItems:"center",paddingLeft:6}}>
                <span style={{fontSize:10,color:C.muted,fontWeight:500,whiteSpace:"nowrap"}}>{label}</span>
              </div>
            ))}
            <div style={{position:"absolute",left:`${todayPct}%`,top:0,bottom:0,width:1.5,background:C.accent,opacity:0.6}}/>
          </div>
        </div>

        {groups.map((grp,gi)=>(
          <div key={grp.key} style={{borderBottom:gi<groups.length-1?`1px solid ${C.border}`:"none"}}>
            {/* Group header row — hidden in "all" mode since there's only one group and it's obvious */}
            {groupBy!=="all"&&(
              <div style={{display:"flex",alignItems:"center",height:40,background:C.bg}}>
                <div
                  onClick={grp.onHeaderClick||undefined}
                  style={{width:LCOL,flexShrink:0,padding:"0 16px",borderRight:`1px solid ${C.border}`,height:"100%",display:"flex",alignItems:"center",gap:8,cursor:grp.onHeaderClick?"pointer":"default"}}
                  onMouseEnter={e=>{if(grp.onHeaderClick)e.currentTarget.style.background=C.hover;}}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                >
                  {grp.color
                    ? <div style={{width:8,height:8,borderRadius:2,background:grp.color,flexShrink:0}}/>
                    : <Avatar name={grp.label} size={18}/>
                  }
                  <span style={{fontSize:12,fontWeight:600,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{grp.label}</span>
                  <span style={{fontSize:11,color:C.faint,marginLeft:"auto",flexShrink:0}}>{grp.rows.length}</span>
                </div>
                <div style={{flex:1,position:"relative",height:"100%",display:"flex",alignItems:"center"}}>
                  <Grid/>
                  {grp.headerExtra()}
                </div>
              </div>
            )}

            {/* Task rows */}
            {grp.rows.map(t=>{
              const undated=!t.start||!t.end;
              const dispStart=t.start||TODAY, dispEnd=t.end||addDays(TODAY,7);
              const tL=datePct(dispStart,pS,pE), tW=Math.max(datePct(dispEnd,pS,pE)-tL, undated?1.5:0.4);
              const done=t.status==="complete",active=drag?.id===t.id;
              const col=grp.taskColor(t);
              const indent = groupBy==="all" ? 16 : 30;
              return (
                <div key={t.id} style={{display:"flex",alignItems:"center",height:32,borderTop:`1px solid ${C.divider}`}}>
                  <div style={{width:LCOL,flexShrink:0,padding:`0 16px 0 ${indent}px`,borderRight:`1px solid ${C.border}`,height:"100%",display:"flex",alignItems:"center",gap:7}}>
                    <div style={{width:13,height:13,borderRadius:3,flexShrink:0,border:`1.5px solid ${done?C.accent:C.faint}`,background:done?C.accent:"transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>
                      {done&&<svg width="7" height="7" viewBox="0 0 8 8" fill="none"><path d="M1.5 4L3.5 6L6.5 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    </div>
                    {groupBy!=="phase"&&<div style={{width:6,height:6,borderRadius:"50%",background:pc(t.project_id),flexShrink:0}}/>}
                    <span style={{fontSize:12,color:done?C.muted:undated?C.faint:C.text,textDecoration:done?"line-through":"none",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</span>
                    {groupBy==="phase"&&<Avatar name={t.assignee} size={14}/>}
                  </div>
                  <div style={{flex:1,position:"relative",height:"100%",display:"flex",alignItems:"center",overflow:"visible"}}>
                    <Grid/>
                    <div onMouseDown={e=>onDown(e,t.id,"move")} style={{
                      position:"absolute",left:`${tL}%`,width:`${tW}%`,height:18,
                      background:undated?"transparent":col,
                      border:undated?`1.5px dashed ${col}`:"none",
                      borderRadius:3,
                      opacity:active?0.65:(done?0.35:undated?0.7:0.8),
                      zIndex:2,display:"flex",alignItems:"center",paddingLeft:6,overflow:"hidden",
                      cursor:active&&drag?.type==="move"?"grabbing":"grab",
                      boxShadow:active?`0 0 0 2px ${col}44`:"none"
                    }}>
                      {!undated&&tW>5&&<span style={{fontSize:9,color:"white",fontWeight:600,whiteSpace:"nowrap",pointerEvents:"none"}}>{fmtD(t.start)}</span>}
                      {undated&&<span style={{fontSize:9,color:col,fontWeight:600,whiteSpace:"nowrap",pointerEvents:"none",paddingLeft:2}}>no date</span>}
                      {!undated&&<div onMouseDown={e=>onDown(e,t.id,"resize")} style={{position:"absolute",right:0,top:0,bottom:0,width:8,cursor:"ew-resize",display:"flex",alignItems:"center",justifyContent:"center"}}>
                        <div style={{width:1.5,height:"50%",background:"rgba(255,255,255,0.6)",borderRadius:1}}/>
                      </div>}
                    </div>
                    {active&&<div style={{position:"absolute",left:`${tL}%`,top:-26,background:C.text,color:"white",fontSize:11,padding:"3px 8px",borderRadius:4,whiteSpace:"nowrap",pointerEvents:"none",zIndex:20,fontVariantNumeric:"tabular-nums"}}>{fmtD(dispStart)} → {fmtD(dispEnd)} · {daysBetween(dispStart,dispEnd)}d</div>}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
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

// ── BUDGET ─────────────────────────────────────────────────────────────────
function BudgetView({projects,expenses,tasks,onNavigate}) {
  const allocated=projects.reduce((s,p)=>s+p.budget,0);const taskCosts=tasks?tasks.reduce((s,t)=>s+(t.price||0),0):0;const totalB=allocated,totalSpent=expenses.reduce((s,e)=>s+e.amount,0);
  return (
    <div style={{padding:"32px 40px"}}>
      <h2 style={{fontSize:18,fontWeight:700,color:C.text,letterSpacing:"-0.2px",marginBottom:18}}>Budget</h2>
      <div style={{border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden",marginBottom:18,background:C.surface}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)"}}>
          {[{l:"Total budget",v:fmtM(totalB),n:""},{l:"Allocated",v:fmtM(allocated),n:`${fmtM(totalB-allocated)} free`},{l:"Spent",v:fmtM(totalSpent),n:`${((totalSpent/totalB)*100).toFixed(1)}%`},{l:"Remaining",v:fmtM(allocated-totalSpent),n:"of allocated"}].map(({l,v,n},i)=>(
            <div key={l} style={{padding:"14px 18px",borderRight:i<3?`1px solid ${C.border}`:"none"}}>
              <p style={{fontSize:11,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:5}}>{l}</p>
              <p style={{fontSize:18,fontWeight:600,color:C.text,fontVariantNumeric:"tabular-nums"}}>{v}</p>
              {n&&<p style={{fontSize:11,color:C.muted,marginTop:2}}>{n}</p>}
            </div>
          ))}
        </div>
        <div style={{padding:"0 18px 14px"}}><div style={{height:4,background:C.divider,borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",width:`${(totalSpent/totalB)*100}%`,background:C.accent,borderRadius:2}}/></div></div>
      </div>
      <div style={{border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden",background:C.surface}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 100px 100px 100px 130px 90px",padding:"8px 16px",borderBottom:`1px solid ${C.border}`,background:C.bg}}>
          {["Project","Budget","Spent","Remaining","Progress","Status"].map(h=><span key={h} style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:"uppercase",letterSpacing:"0.06em"}}>{h}</span>)}
        </div>
        {projects.map((ph,idx)=>{const phExp=expenses.filter(e=>e.project_id===ph.id);const spent=phExp.reduce((s,e)=>s+e.amount,0);const pct=Math.min(100,(spent/ph.budget)*100);
          return (
            <div key={ph.id}>
              <div onClick={()=>onNavigate("project",ph.id)} style={{display:"grid",gridTemplateColumns:"1fr 100px 100px 100px 130px 90px",padding:"11px 16px",borderBottom:`1px solid ${C.divider}`,alignItems:"center",cursor:"pointer",background:C.surface}} onMouseEnter={e=>e.currentTarget.style.background=C.hover} onMouseLeave={e=>e.currentTarget.style.background=C.surface}>
                <div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:8,height:8,borderRadius:2,background:pc(ph.id),flexShrink:0}}/><span style={{fontSize:13,color:C.text,fontWeight:500}}>{ph.name}</span></div>
                <span style={{fontSize:13,color:C.text,fontVariantNumeric:"tabular-nums"}}>{fmtM(ph.budget)}</span>
                <span style={{fontSize:13,color:spent>0?C.text:C.muted,fontVariantNumeric:"tabular-nums"}}>{spent>0?fmtM(spent):"—"}</span>
                <span style={{fontSize:13,color:C.text,fontVariantNumeric:"tabular-nums"}}>{fmtM(ph.budget-spent)}</span>
                <div style={{display:"flex",alignItems:"center",gap:8}}><div style={{flex:1,height:4,background:C.divider,borderRadius:2}}><div style={{height:"100%",width:`${pct}%`,background:pc(ph.id),borderRadius:2}}/></div><span style={{fontSize:11,color:C.muted,minWidth:28,textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{pct.toFixed(0)}%</span></div>
                <Chip status={ph.status}/>
              </div>
              {phExp.map(ex=><div key={ex.id} style={{display:"grid",gridTemplateColumns:"1fr 100px 100px 100px 130px 90px",padding:"6px 16px 6px 40px",borderBottom:`1px solid ${C.divider}`,background:C.bg,alignItems:"center"}}><span style={{fontSize:12,color:C.muted}}>{ex.category} · {ex.vendor}</span><span/><span style={{fontSize:12,color:C.muted,fontVariantNumeric:"tabular-nums"}}>{fmtM(ex.amount)}</span><span/><span/><span/></div>)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── TASKS GRID ─────────────────────────────────────────────────────────────
function TasksGrid({tasks, setTasks, projects, onNavigate, team}) {
  const [groupBy,    setGroupBy]    = useState("phase"); // "phase" | "assignee" | "date"
  const [editingId,  setEditingId]  = useState(null);
  const [editTitle,  setEditTitle]  = useState("");
  const [collapsed,  setCollapsed]  = useState({});
  const [hovId,      setHovId]      = useState(null);
  const [addingTo,   setAddingTo]   = useState(null);
  const [newTitle,   setNewTitle]   = useState("");
  const titleRef = useRef(null);
  const newRef   = useRef(null);
  const justCommitted = useRef(false);
  // price toggle: task id -> bool (true = included in tally)
  const [priceOn, setPriceOn] = useState({});
  const isPriceOn = id => priceOn[id]!==false; // default true
  const togglePrice = (e, id) => { e.stopPropagation(); setPriceOn(p=>({...p,[id]:!isPriceOn(id)})); };

  useEffect(()=>{ if(editingId && titleRef.current) titleRef.current.focus(); },[editingId]);
  useEffect(()=>{ if(addingTo  && newRef.current)   newRef.current.focus();   },[addingTo]);

  const toggleDone = id => {
    const task = tasks.find(t=>t.id===id); if(!task) return;
    const newStatus = task.status==="complete" ? "todo" : "complete";
    setTasks(prev=>prev.map(t=>t.id===id?{...t,status:newStatus}:t));
    sbPatch("tasks", id, {status:newStatus}).catch(console.error);
  };

  const startEdit  = task => { setEditingId(task.id); setEditTitle(task.title); };
  const commitEdit = id => {
    const title = editTitle || tasks.find(t=>t.id===id)?.title;
    setTasks(prev=>prev.map(t=>t.id===id?{...t,title}:t));
    setEditingId(null);
    sbPatch("tasks", id, {title}).catch(console.error);
  };
  const deleteTask = id => {
    setTasks(prev=>prev.filter(t=>t.id!==id));
    sbDel("tasks", id).catch(console.error);
  };
  const toggleCollapse = key => setCollapsed(s=>({...s,[key]:!s[key]}));
  const startAdd  = key => { setAddingTo(key); setNewTitle(""); };

  const commitAdd = (key, defaultPhaseId, continueAdding=false) => {
    const title = (newRef.current?.value||"").trim();
    if(!title) { setAddingTo(null); return; }
    const dbTask = {
      project_id: defaultPhaseId||projects[0]?.id||1, title,
      assignee:"", start_date:null, end_date:null,
      status:"todo", notes:"", sort_order:0,
    };
    if(newRef.current) newRef.current.value = "";
    if(!continueAdding) { setAddingTo(null); }
    else { setTimeout(()=>{ if(newRef.current) newRef.current.focus(); }, 0); }
    sbInsertRow("tasks", dbTask).then(rows=>{
      if(rows?.[0]) setTasks(prev=>[...prev, mapTask(rows[0])]);
    }).catch(err=>{ console.error(err); alert("Failed to save task: "+err.message); });
  };

  // ── Build groups ──────────────────────────────────────────────────────────
  const groups = useMemo(()=>{
    if(groupBy==="phase") {
      return projects.map(ph=>({
        key: String(ph.id),
        label: ph.name,
        dot: pc(ph.id),
        tasks: [...tasks].filter(t=>t.project_id===ph.id),
        addPhaseId: ph.id,
      }));
    }
    if(groupBy==="assignee") {
      const names = [...new Set(tasks.map(t=>t.assignee||"Unassigned"))].sort();
      return names.map(name=>({
        key: name,
        label: name,
        dot: null,
        tasks: [...tasks].filter(t=>(t.assignee||"Unassigned")===name),
        addPhaseId: projects[0]?.id||1,
      }));
    }
    // date — flat list sorted by end date, no add-task per group
    const sorted = [...tasks].sort((a,b)=>toMs(a.end)-toMs(b.end));
    const now = toMs(TODAY);
    const buckets = [
      {key:"overdue",  label:"Overdue",    dot:"#C0392B", tasks:sorted.filter(t=>t.end&&toMs(t.end)<now && t.status!=="complete")},
      {key:"week",     label:"This week",  dot:C.accent,  tasks:sorted.filter(t=>{ if(!t.end) return false; const ms=toMs(t.end); return ms>=now && ms<now+7*86400000 && t.status!=="complete"; })},
      {key:"month",    label:"This month", dot:C.muted,   tasks:sorted.filter(t=>{ if(!t.end) return false; const ms=toMs(t.end); return ms>=now+7*86400000 && ms<now+30*86400000 && t.status!=="complete"; })},
      {key:"later",    label:"Later",      dot:C.faint,   tasks:sorted.filter(t=>t.end&&toMs(t.end)>=now+30*86400000 && t.status!=="complete")},
      {key:"nodate",   label:"No date",    dot:C.faint,   tasks:sorted.filter(t=>!t.start&&!t.end&&t.status!=="complete")},
      {key:"done",     label:"Done",       dot:C.green,   tasks:sorted.filter(t=>t.status==="complete")},
    ].filter(g=>g.tasks.length>0);
    return buckets.map(b=>({...b, addPhaseId:null}));
  },[tasks, projects, groupBy]);

  const totalDone = tasks.filter(t=>t.status==="complete").length;
  const GROUPS = [{id:"phase",label:"Project"},{id:"assignee",label:"Assignee"},{id:"date",label:"Due date"}];

  // ── Shared task row ───────────────────────────────────────────────────────
  const TaskRow = ({task, showMeta}) => {
    const done = task.status==="complete";
    const isEditing = editingId===task.id;
    const ph = projects.find(p=>p.id===task.project_id);
    const isHov = hovId===task.id;

    const saveField = (field, value) => {
      setTasks(prev=>prev.map(t=>t.id===task.id?{...t,[field]:value}:t));
      const dbField = field==="start"?"start_date":field==="end"?"end_date":field;
      sbPatch("tasks", task.id, {[dbField]:value||null}).catch(console.error);
    };

    return (
      <div
        onMouseEnter={()=>setHovId(task.id)}
        onMouseLeave={()=>setHovId(null)}
        style={{display:"flex",alignItems:"center",gap:8,padding:"5px 10px",borderRadius:6,background:isHov?C.hover:"transparent"}}
      >
        {/* Checkbox */}
        <div onClick={()=>toggleDone(task.id)} style={{
          width:15,height:15,borderRadius:3,flexShrink:0,cursor:"pointer",
          border:"1.5px solid "+(done?C.green:C.faint),background:done?C.green:"transparent",
          display:"flex",alignItems:"center",justifyContent:"center",
        }}>
          {done&&<svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1.5 4L3.5 6L6.5 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
        </div>

        {/* Title */}
        <div style={{flex:1,minWidth:0}}>
          {isEditing ? (
            <input ref={titleRef} value={editTitle} onChange={e=>setEditTitle(e.target.value)}
              onBlur={()=>commitEdit(task.id)}
              onKeyDown={e=>{if(e.key==="Enter"||e.key==="Escape") commitEdit(task.id);}}
              style={{width:"100%",border:"none",outline:"none",background:"transparent",fontFamily:"inherit",fontSize:13,color:C.text,padding:0}}/>
          ) : (
            <span onDoubleClick={()=>startEdit(task)}
              style={{fontSize:13,color:done?C.muted:C.text,textDecoration:done?"line-through":"none",cursor:"text",display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
              {task.title||<span style={{color:C.faint}}>Untitled</span>}
            </span>
          )}
        </div>

        {/* Inline meta */}
        <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
          {/* Project badge when grouped by assignee */}
          {showMeta==="phase" && ph && (
            <div style={{display:"flex",alignItems:"center",gap:4}}>
              <div style={{width:5,height:5,borderRadius:1,background:pc(ph.id),flexShrink:0}}/>
              <span style={{fontSize:11,color:C.muted}}>{ph.name}</span>
            </div>
          )}

          {/* Inline assignee dropdown */}
          <select
            value={task.assignee||""}
            onChange={e=>saveField("assignee",e.target.value)}
            style={{
              fontSize:11,color:task.assignee?C.muted:C.faint,border:"none",background:"transparent",
              fontFamily:"inherit",outline:"none",padding:0,cursor:"pointer",
              appearance:"none",WebkitAppearance:"none",maxWidth:90,
            }}
          >
            <option value="">Assignee</option>
            {(team||[]).map(m=><option key={m.id} value={m.name}>{m.name}</option>)}
          </select>

          {/* Inline start date */}
          <input type="date" value={task.start||""}
            onChange={e=>saveField("start",e.target.value)}
            title="Start date"
            style={{fontSize:11,color:task.start?C.faint:C.faint,border:"none",background:"transparent",fontFamily:"inherit",
              cursor:"pointer",outline:"none",padding:0,width:task.start?86:70,fontVariantNumeric:"tabular-nums",
              color:task.start?C.faint:"#D0CFC9"}}/>

          {/* Inline end date */}
          <input type="date" value={task.end||""}
            onChange={e=>saveField("end",e.target.value)}
            title="End date"
            style={{fontSize:11,border:"none",background:"transparent",fontFamily:"inherit",
              cursor:"pointer",outline:"none",padding:0,width:task.end?86:70,fontVariantNumeric:"tabular-nums",
              color:task.end?C.faint:"#D0CFC9"}}/>
        </div>

        {/* Click-through arrow */}
        <button onClick={()=>onNavigate("project", task.project_id, task.id)}
          style={{background:"none",border:"none",cursor:"pointer",color:C.faint,fontSize:14,padding:"0 2px",lineHeight:1,opacity:isHov?1:0,transition:"opacity 0.1s",flexShrink:0}}>→</button>

        {/* Delete */}
        <button onClick={()=>deleteTask(task.id)}
          style={{background:"none",border:"none",cursor:"pointer",color:C.faint,fontSize:14,padding:"0 2px",lineHeight:1,opacity:isHov?1:0,transition:"opacity 0.1s",flexShrink:0}}>✕</button>

        {/* Price toggle + amount */}
        <div style={{display:"flex",alignItems:"center",gap:4,width:86,justifyContent:"flex-end",flexShrink:0}}>
          {(task.price>0||isHov)&&(
            <button onClick={e=>togglePrice(e,task.id)} title={isPriceOn(task.id)?"Exclude from budget":"Include in budget"}
              style={{background:"none",border:"none",cursor:"pointer",padding:0,lineHeight:1,fontSize:11,
                color:isPriceOn(task.id)?C.green:C.faint,opacity:(task.price>0||isHov)?1:0,transition:"color 0.15s"}}>
              {isPriceOn(task.id)?"●":"○"}
            </button>
          )}
          <span style={{
            fontSize:12,fontVariantNumeric:"tabular-nums",minWidth:60,textAlign:"right",fontWeight:500,
            color:!task.price?C.faint:isPriceOn(task.id)?C.text:C.faint,
            textDecoration:!isPriceOn(task.id)&&task.price?"line-through":"none",
          }}>
            {task.price>0?fmtM(task.price):"—"}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div style={{padding:"32px 40px",maxWidth:860}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
        <h2 style={{fontSize:18,fontWeight:700,color:C.text,letterSpacing:"-0.2px"}}>Tasks</h2>
        <div style={{display:"flex",alignItems:"center",gap:16}}>
          {/* Group toggle */}
          <div style={{display:"flex",alignItems:"center",gap:2,background:C.bg,border:"1px solid "+C.border,borderRadius:6,padding:3}}>
            {GROUPS.map(g=>(
              <button key={g.id} onClick={()=>setGroupBy(g.id)}
                style={{padding:"4px 10px",fontSize:12,fontWeight:groupBy===g.id?600:400,
                  color:groupBy===g.id?C.text:C.muted,
                  background:groupBy===g.id?C.surface:"transparent",
                  border:groupBy===g.id?"1px solid "+C.border:"1px solid transparent",
                  borderRadius:4,cursor:"pointer"}}>
                {g.label}
              </button>
            ))}
          </div>
          <span style={{fontSize:12,color:C.muted}}>{totalDone} of {tasks.length} done</span>
        </div>
      </div>

      {/* Groups */}
      {groups.map(group=>{
        const isCollapsed = collapsed[group.key];
        const doneCt = group.tasks.filter(t=>t.status==="complete").length;
        const metaMode = groupBy==="phase" ? "assignee" : groupBy==="assignee" ? "phase" : "phase";

        return (
          <div key={group.key} style={{marginBottom:8}}>
            {/* Group header */}
            <div onClick={()=>toggleCollapse(group.key)}
              onMouseEnter={e=>e.currentTarget.style.background=C.hover}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}
              style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",borderRadius:6,cursor:"pointer",userSelect:"none",marginLeft:-10}}>
              <span style={{fontSize:10,color:C.faint,width:10,textAlign:"center",flexShrink:0}}>{isCollapsed?"▶":"▼"}</span>
              {group.dot && <div style={{width:7,height:7,borderRadius:2,background:group.dot,flexShrink:0}}/>}
              <span style={{fontSize:13,fontWeight:600,color:C.text}}>{group.label}</span>
              <span style={{fontSize:11,color:C.faint}}>{doneCt}/{group.tasks.length}</span>
            </div>

            {!isCollapsed&&(
              <div style={{marginLeft:10}}>
                {group.tasks.map(task=><TaskRow key={task.id} task={task} showMeta={metaMode}/>)}

                {/* Group subtotal */}
                {(()=>{
                  const priced = group.tasks.filter(t=>t.price>0);
                  const subtotal = priced.reduce((s,t)=>s+(isPriceOn(t.id)?t.price:0),0);
                  const total = priced.reduce((s,t)=>s+t.price,0);
                  if(!total) return null;
                  return (
                    <div style={{display:"flex",alignItems:"center",padding:"5px 10px",marginTop:2}}>
                      <div style={{flex:1,height:1,background:C.divider}}/>
                      <div style={{display:"flex",alignItems:"center",gap:6,paddingLeft:12}}>
                        {subtotal!==total&&<span style={{fontSize:11,color:C.faint,textDecoration:"line-through",fontVariantNumeric:"tabular-nums"}}>{fmtM(total)}</span>}
                        <span style={{fontSize:12,fontWeight:600,color:subtotal!==total?C.accent:C.muted,fontVariantNumeric:"tabular-nums",minWidth:60,textAlign:"right"}}>{fmtM(subtotal)}</span>
                      </div>
                    </div>
                  );
                })()}

                {/* Add task — only for phase and assignee groupings */}
                {group.addPhaseId && (addingTo===group.key ? (
                  <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px"}}>
                    <div style={{width:15,height:15,borderRadius:3,flexShrink:0,border:"1.5px solid "+C.faint}}/>
                    <input ref={newRef} defaultValue=""
                      onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();commitAdd(group.key,group.addPhaseId,true);} if(e.key==="Escape") setAddingTo(null);}}
                      placeholder="Task name — press Enter or click ✓"
                      style={{flex:1,border:"none",outline:"none",background:"transparent",fontFamily:"inherit",fontSize:13,color:C.text,padding:0}}/>
                    <button
                      onMouseDown={e=>{e.preventDefault();commitAdd(group.key,group.addPhaseId,false);}}
                      style={{background:"none",border:"none",cursor:"pointer",color:C.accent,fontSize:14,padding:"0 4px",lineHeight:1,flexShrink:0}}>✓</button>
                    <button
                      onMouseDown={e=>{e.preventDefault();setAddingTo(null);}}
                      style={{background:"none",border:"none",cursor:"pointer",color:C.faint,fontSize:14,padding:"0 4px",lineHeight:1,flexShrink:0}}>✕</button>
                  </div>
                ) : (
                  <button onClick={()=>startAdd(group.key)}
                    onMouseEnter={e=>e.currentTarget.style.color=C.text}
                    onMouseLeave={e=>e.currentTarget.style.color=C.faint}
                    style={{display:"flex",alignItems:"center",gap:8,padding:"5px 10px",background:"none",border:"none",cursor:"pointer",color:C.faint,fontSize:13,width:"100%",textAlign:"left"}}>
                    <span style={{fontSize:15,lineHeight:1}}>+</span> Add task
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Grand total */}
      {(()=>{
        const allPriced = tasks.filter(t=>t.price>0);
        const grandActive = allPriced.reduce((s,t)=>s+(isPriceOn(t.id)?t.price:0),0);
        const grandTotal  = allPriced.reduce((s,t)=>s+t.price,0);
        if(!grandTotal) return null;
        return (
          <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",padding:"14px 10px 0",borderTop:`2px solid ${C.border}`,marginTop:8,gap:12}}>
            <span style={{fontSize:12,color:C.muted,fontWeight:500}}>Total</span>
            {grandActive!==grandTotal&&(
              <span style={{fontSize:13,color:C.faint,textDecoration:"line-through",fontVariantNumeric:"tabular-nums"}}>{fmtM(grandTotal)}</span>
            )}
            <span style={{fontSize:15,fontWeight:700,color:grandActive!==grandTotal?C.accent:C.text,fontVariantNumeric:"tabular-nums"}}>{fmtM(grandActive)}</span>
          </div>
        );
      })()}
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
        const totalBudget=faProjects.reduce((s,p)=>s+p.budget,0);
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
                <Chip status={pr.status}/>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke={C.faint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function ProjectsView({phases, projects, tasks, expenses, onNavigate, onAddProject}) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({name:"",status:"planning",budget:"",start:"",end:"",notes:"",phase_id:""});
  const [saving, setSaving] = useState(false);

  const addProject = () => {
    if(!form.name) return;
    setSaving(true);
    const dbProject = {
      name:form.name, status:form.status, budget:parseInt(form.budget)||0,
      start_date:form.start||null, end_date:form.end||null, notes:form.notes,
      phase_id:parseInt(form.phase_id)||null, sort_order:projects.length,
    };
    sbInsertRow("projects", dbProject).then(rows=>{
      if(rows?.[0]) onAddProject(mapProject(rows[0]));
      setForm({name:"",status:"planning",budget:"",start:"",end:"",notes:"",phase_id:""});
      setShowAdd(false);
    }).catch(console.error).finally(()=>setSaving(false));
  };

  // Group projects: those with a phase go under their phase, ungrouped ones at bottom
  const grouped = phases.map(fa=>({fa, items:projects.filter(p=>String(p.phase_id)===String(fa.id))}));
  const ungrouped = projects.filter(p=>!p.phase_id||!phases.find(fa=>String(fa.id)===String(p.phase_id)));

  const ProjectRow = ({pr, i, total}) => {
    const projectTasks=tasks.filter(t=>t.project_id===pr.id);
    const done=projectTasks.filter(t=>t.status==="complete").length;
    const spent=expenses.filter(e=>e.project_id===pr.id).reduce((s,e)=>s+e.amount,0);
    return(
      <div onClick={()=>onNavigate("project",pr.id)}
        style={{display:"flex",alignItems:"center",gap:14,padding:"12px 18px",borderBottom:i<total-1?`1px solid ${C.divider}`:"none",cursor:"pointer"}}
        onMouseEnter={e=>e.currentTarget.style.background=C.hover}
        onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
        <div style={{width:7,height:7,borderRadius:2,background:pc(pr.id),flexShrink:0}}/>
        <div style={{flex:1,minWidth:0}}>
          <p style={{fontSize:13,fontWeight:500,color:C.text}}>{pr.name}</p>
          <p style={{fontSize:11,color:C.muted,marginTop:1}}>{fmtD(pr.start)} → {fmtD(pr.end)}</p>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
          <span style={{fontSize:12,color:C.muted}}>{done}/{projectTasks.length} tasks</span>
          <span style={{fontSize:12,color:C.muted,fontVariantNumeric:"tabular-nums"}}>{fmtM(pr.budget)}</span>
          <Chip status={pr.status}/>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke={C.faint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
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
              <p style={{fontSize:11,color:C.muted,marginBottom:4,fontWeight:500}}>Budget ($)</p>
              <Input value={form.budget} onChange={v=>setForm(f=>({...f,budget:v}))} placeholder="0"/>
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
    ]).then(([tm,fa,ph,ta,ex,ev,qu])=>{
      setTeam(tm);
      setPhases(fa.map(f=>({...f})));
      setProjects(ph.map(mapProject));
      setTasks(ta.map(mapTask));
      setExpenses(ex.map(mapExpense));
      setEvents(ev.map(mapEvent));
      setQuotes(qu.map(mapQuote));
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
    setTeam([]); setPhases([]); setProjects([]); setTasks([]); setExpenses([]); setEvents([]); setQuotes([]);
  };

  // Restore session on mount
  useEffect(()=>{
    const saved = localStorage.getItem("4602banks_session");
    if(!saved) return;
    try {
      const data = JSON.parse(saved);
      const exp = data?.expires_at || 0;
      if(Date.now()/1000 < exp) {
        AUTH_TOKEN = data.access_token;
        setSession(data);
        loadData();
      } else {
        localStorage.removeItem("4602banks_session");
      }
    } catch(e) {
      localStorage.removeItem("4602banks_session");
    }
  }, []);

  if(!session) return <LoginPage onLogin={handleLogin}/>;

  const navigate=(type,projectId,taskId)=>{
    if(type==="dashboard"||type==="phases"||type==="projects"||type==="timeline"||type==="weekly"||type==="tasks"||type==="budget"||type==="events"||type==="settings"){setView(type);setPage(null);return;}
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

  const nav=[{id:"dashboard",label:"Overview"},{id:"phases",label:"Phases"},{id:"projects",label:"Projects"},{id:"timeline",label:"Timeline"},{id:"weekly",label:"Weekly"},{id:"tasks",label:"Tasks"},{id:"budget",label:"Budget"},{id:"events",label:"Events"},{id:"settings",label:"Settings"}];

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
          {view==="dashboard"&&<Dashboard projects={projects} tasks={tasks} expenses={expenses} events={events} onNavigate={navigate}/>}
          {view==="projects"   &&<ProjectsView phases={phases} projects={projects} tasks={tasks} expenses={expenses} onNavigate={navigate} onAddProject={p=>setProjects(prev=>[...prev,p])}/>}
          {view==="timeline" &&<TimelineView projects={projects} tasks={tasks} setTasks={setTasks} onNavigate={navigate}/>}
          {view==="weekly"   &&<WeeklyView projects={projects} tasks={tasks} setTasks={setTasks} onNavigate={navigate}/>}
          {view==="tasks"    &&<TasksGrid tasks={tasks} setTasks={setTasks} projects={projects} onNavigate={navigate} team={team}/>}
          {view==="budget"   &&<BudgetView projects={projects} expenses={expenses} tasks={tasks} onNavigate={navigate}/>}
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
