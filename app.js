/* =============================================================
   畑ノート v3
   - 作物データは crops.json（GitHub上で直接編集できる）
   - 記録はこの端末に保存し、設定したGoogleスプレッドシートへ自動同期
   ============================================================= */
"use strict";

const APP_VERSION = "3.0.0";
const PREVIEW = !!window.HATAKE_PREVIEW;          // claude.ai 上のプレビュー版
const STORE_KEY = "hatake-note-v3";
const LEGACY_KEY = "hatake-note-v1";
const PLACE = { name:"各務原市", lat:35.399, lon:136.863 };   // 霜予報の地点
const FROST_C = 3;                                  // この最低気温以下で霜注意

let DATA = null;

/* =============================================================
   ユーティリティ
   ============================================================= */
const $ = s => document.querySelector(s);
const esc = s => String(s==null?"":s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const MS = 86400000;
function today(){ const d = new Date(); d.setHours(0,0,0,0); return d; }
function parseD(s){ const [y,m,d] = String(s).slice(0,10).split("-").map(Number); return new Date(y, m-1, d); }
function fmtD(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function addD(d,n){ const x = new Date(d); x.setDate(x.getDate()+n); return x; }
function diffD(a,b){ return Math.round((a-b)/MS); }
function jp(d){ return (d.getMonth()+1)+"/"+d.getDate()+"("+"日月火水木金土"[d.getDay()]+")"; }
function uid(p){ return p + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function jun(code){
  const m = parseInt(code,10), k = code.replace(/[0-9]/g,"");
  return { month:m, day: k==="上"?1 : k==="中"?11 : 21 };
}
function junEndDate(code, year){
  const {month} = jun(code), k = code.replace(/[0-9]/g,"");
  if(k==="上") return new Date(year, month-1, 10);
  if(k==="中") return new Date(year, month-1, 20);
  return new Date(year, month, 0);
}
function junLabel(w){ return w[0]+"〜"+w[1]; }
function resolveCal(code, base){
  const {month,day} = jun(code);
  let d = new Date(base.getFullYear(), month-1, day);
  if(d < base) d = new Date(base.getFullYear()+1, month-1, day);
  return d;
}
function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function lsSet(k,v){ try{ localStorage.setItem(k,v); return true; }catch(e){ return false; } }

/* =============================================================
   畝と区画
   ============================================================= */
const BEDS = [
  {id:"a", name:"畝a", note:"日当たり良好", winterSun:"good"},
  {id:"b", name:"畝b", note:"標準",         winterSun:"good"},
  {id:"c", name:"畝c", note:"冬は半日陰",   winterSun:"half"}
];
const DIV = 4;
const slotsOf  = b => Array.from({length:DIV}, (_,i) => b+(i+1));
const slotIdx  = s => parseInt(s.slice(1),10);
const slotBed  = s => String(s||"")[0];
const ALL_SLOTS = BEDS.flatMap(b => slotsOf(b.id));
const bedById  = id => BEDS.find(b => b.id===id);
const cropById = id => DATA.crops.find(c => c.id===id);
const needOf   = id => (cropById(id)||{}).slotsNeeded || 1;
const shareLabel = n => n>=DIV ? "畝まるごと" : n===DIV/2 ? "畝の半分" : `${n}/${DIV}畝`;
const slotNums = p => (p.slots||[]).map(slotIdx).sort((x,y)=>x-y).join("・");
const bedOf    = p => bedById(p.bedId || slotBed((p.slots||[])[0]));
const occupant = (slot, ignoreId) => state.plantings.find(p => p.id!==ignoreId && p.status!=="done" && (p.slots||[]).includes(slot));

/* =============================================================
   状態と保存
   ============================================================= */
let state = null;

function emptyState(){
  return {
    v:3, plantings:[], logs:[],
    settings:{ offset:0, cropOffset:{}, myCrops:null, myCropsTouched:false },
    sync:{ url:"", outbox:[], lastOk:0, lastErr:"" },
    sample:false
  };
}

function load(){
  state = emptyState();
  let raw = lsGet(STORE_KEY);
  if(raw){
    try{ Object.assign(state, JSON.parse(raw)); }catch(e){}
  }else if(!PREVIEW && (raw = lsGet(LEGACY_KEY))){
    // v1/v2（試作版）からの引き継ぎ。サンプルは引き継がない
    try{
      const o = JSON.parse(raw);
      if(!o.sample){
        state.plantings = o.plantings||[]; state.logs = o.logs||[];
        state.settings.offset = o.offset|0;
      }
    }catch(e){}
  }
  if(PREVIEW && !raw) seedSample();
  // 補完
  state.settings = Object.assign(emptyState().settings, state.settings||{});
  state.sync = Object.assign(emptyState().sync, state.sync||{});
  if(!Array.isArray(state.settings.myCrops) || !state.settings.myCropsTouched)
    state.settings.myCrops = DATA.crops.map(c=>c.id);
  state.plantings.forEach(p=>{
    if(!Array.isArray(p.slots) || !p.slots.length) p.slots = slotsOf(p.bedId||"a");
    if(!p.bedId) p.bedId = slotBed(p.slots[0]);
  });
  mergeSameDayHarvests(false);
}
function save(){ lsSet(STORE_KEY, JSON.stringify(state)); }

function seedSample(){
  const y = today().getFullYear();
  state.plantings = [
    {id:"s1", bedId:"b", slots:["b1","b2"], cropId:"daikon",     date:fmtD(addD(today(),-13)), count:24,  status:"active", memo:"品種：耐病総太り"},
    {id:"s2", bedId:"a", slots:["a1","a2"], cropId:"onion_late", date:`${y}-11-15`,            count:120, status:"active"},
    {id:"s3", bedId:"a", slots:["a3","a4"], cropId:"tomato",     date:`${y}-05-10`,            count:6,   status:"done", endDate:`${y}-09-05`, memo:"桃太郎。8月後半は裂果が多かった"},
    {id:"s4", bedId:"c", slots:["c1","c2"], cropId:"nasu",       date:`${y}-05-18`,            count:4,   status:"active"},
    {id:"s5", bedId:"b", slots:["b3","b4"], cropId:"edamame",    date:`${y}-05-06`,            count:20,  status:"done", endDate:`${y}-07-30`}
  ];
  const L = (pid,tid,d,type,qty)=>({id:uid("l"), plantingId:pid, taskId:tid, date:`${y}-${d}`, type, qty});
  state.logs = [
    L("s3","plant","05-10","work"), L("s3","support","05-20","work"),
    L("s3","harvest","07-08","harvest",6), L("s3","harvest","07-14","harvest",11), L("s3","harvest","07-22","harvest",18),
    L("s3","harvest","07-30","harvest",21), L("s3","harvest","08-05","harvest",23), L("s3","harvest","08-14","harvest",17),
    L("s3","harvest","08-24","harvest",14), L("s3","harvest","09-02","harvest",8),
    L("s4","plant","05-18","work"), L("s4","pruning","06-08","work"),
    L("s4","harvest","07-02","harvest",5), L("s4","harvest","07-12","harvest",9), L("s4","harvest","07-25","harvest",12),
    L("s4","harvest","08-08","harvest",10), L("s4","renewal","08-10","work"), L("s4","harvest","09-10","harvest",7),
    L("s5","sow","05-06","work"), L("s5","harvest","07-28","harvest",20),
    L("s1","sow",fmtD(addD(today(),-13)).slice(5),"work")
  ];
  state.sample = true;
}

/* 同じ日・同じ作付けの収穫は1件にまとめる */
function mergeSameDayHarvests(queueSync){
  const seen = {};
  const drop = [];
  state.logs.forEach(l=>{
    if(l.type!=="harvest") return;
    const k = l.plantingId+"|"+l.date;
    if(seen[k]){ seen[k].qty = (seen[k].qty||0) + (l.qty||0); drop.push(l.id); if(queueSync) queueOp("logs","upsert",seen[k]); }
    else seen[k] = l;
  });
  if(drop.length){
    state.logs = state.logs.filter(l=>!drop.includes(l.id));
    if(queueSync) drop.forEach(id=>queueOp("logs","delete",{id}));
  }
}

/* ---------- 変更はすべてここを通す（同期キューに積む） ---------- */
function putPlanting(p){
  p.updatedAt = Date.now();
  const i = state.plantings.findIndex(x=>x.id===p.id);
  if(i<0) state.plantings.push(p); else state.plantings[i] = p;
  state.sample = false;
  queueOp("plantings","upsert",p); save();
}
function removePlanting(id){
  const logs = state.logs.filter(l=>l.plantingId===id);
  state.plantings = state.plantings.filter(p=>p.id!==id);
  state.logs = state.logs.filter(l=>l.plantingId!==id);
  queueOp("plantings","delete",{id});
  logs.forEach(l=>queueOp("logs","delete",{id:l.id}));
  save();
}
function putLog(l){
  l.updatedAt = Date.now();
  const i = state.logs.findIndex(x=>x.id===l.id);
  if(i<0) state.logs.push(l); else state.logs[i] = l;
  state.sample = false;
  queueOp("logs","upsert",l); save();
}
function removeLog(id){
  state.logs = state.logs.filter(l=>l.id!==id);
  queueOp("logs","delete",{id}); save();
}
function putSettings(patch){
  Object.assign(state.settings, patch);
  queueOp("settings","upsert",{key:"settings"}); save();
}

/* =============================================================
   Googleスプレッドシート同期
   端末が正。変更はキューに積み、つながったときにまとめて送る
   ============================================================= */
let flushTimer = null, flushing = false;

function rowFor(table, obj){
  if(table==="plantings"){
    const c = cropById(obj.cropId);
    return { id:obj.id, bedId:obj.bedId, slots:(obj.slots||[]).join(","), cropId:obj.cropId, cropName:c?c.name:"",
      date:obj.date, count:obj.count||0, status:obj.status, endDate:obj.endDate||"", memo:obj.memo||"", updatedAt:obj.updatedAt||Date.now() };
  }
  if(table==="logs"){
    const p = state.plantings.find(x=>x.id===obj.plantingId);
    const c = p ? cropById(p.cropId) : null;
    const t = c ? c.tasks.find(x=>x.id===obj.taskId) : null;
    return { id:obj.id, plantingId:obj.plantingId, cropName:c?c.name:"", taskId:obj.taskId, taskName:t?(t.name+(obj.type==="skip"?"（見送り）":"")):"",
      date:obj.date, type:obj.type, qty:obj.type==="harvest"?(obj.qty||0):"", unit:obj.type==="harvest"&&c?c.unit:"",
      updatedAt:obj.updatedAt||Date.now() };
  }
  if(table==="settings"){
    const s = state.settings;
    return { key:"settings", value:JSON.stringify({offset:s.offset, cropOffset:s.cropOffset, myCrops:s.myCrops, myCropsTouched:s.myCropsTouched}), updatedAt:Date.now() };
  }
}

function queueOp(table, op, obj){
  if(PREVIEW) return;
  const q = state.sync.outbox;
  const id = table==="settings" ? "settings" : obj.id;
  // 同じ行への古い操作は捨てる（最新だけ送ればよい）
  for(let i=q.length-1;i>=0;i--) if(q[i].table===table && q[i].id===id) q.splice(i,1);
  q.push({ table, op, id, row: op==="upsert" ? rowFor(table,obj) : null });
  scheduleFlush();
}
function scheduleFlush(ms){
  if(!state.sync.url) { renderSyncDot(); return; }
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, ms==null?1500:ms);
  renderSyncDot();
}
async function callSheet(payload){
  const url = state.sync.url;
  if(!url) throw new Error("未設定");
  const res = payload
    ? await fetch(url, { method:"POST", body:JSON.stringify(payload), redirect:"follow" })
    : null;
  const json = await res.json();
  if(!json.ok) throw new Error(json.error||"失敗");
  return json;
}
async function getSheet(action){
  const url = state.sync.url;
  const res = await fetch(url + (url.includes("?")?"&":"?") + "action=" + action, { redirect:"follow" });
  const json = await res.json();
  if(!json.ok) throw new Error(json.error||"失敗");
  return json;
}
async function flush(){
  if(PREVIEW || flushing || !state.sync.url || !state.sync.outbox.length) { renderSyncDot(); return; }
  if(navigator.onLine===false){ renderSyncDot(); return; }
  flushing = true;
  const batch = state.sync.outbox.slice(0,200);
  try{
    await callSheet({ action:"apply", ops:batch.map(o=>({table:o.table, op:o.op, id:o.id, row:o.row})) });
    // 送信中に同じ行が再編集されていたら残す
    state.sync.outbox = state.sync.outbox.filter(o=>!batch.includes(o));
    state.sync.lastOk = Date.now(); state.sync.lastErr = "";
    save();
    if(state.sync.outbox.length) scheduleFlush(300);
  }catch(e){
    state.sync.lastErr = navigator.onLine===false ? "オフライン" : "送信できませんでした（"+ (e.message||"通信エラー") +"）";
    save();
  }finally{
    flushing = false; renderSyncDot();
    if(!$("#panel-set").hidden) renderSettings();
  }
}
function queueEverything(){
  state.plantings.forEach(p=>queueOp("plantings","upsert",p));
  state.logs.forEach(l=>queueOp("logs","upsert",l));
  queueOp("settings","upsert",{key:"settings"});
}
function applyDump(d){
  const num = v => v===""||v==null ? 0 : Number(v);
  state.plantings = (d.plantings||[]).filter(r=>r.id).map(r=>({
    id:String(r.id), bedId:String(r.bedId||slotBed(String(r.slots||"a1"))), slots:String(r.slots||"").split(",").filter(Boolean),
    cropId:String(r.cropId), date:String(r.date).slice(0,10), count:num(r.count), status:String(r.status||"active"),
    endDate:r.endDate?String(r.endDate).slice(0,10):undefined, memo:r.memo?String(r.memo):"", updatedAt:num(r.updatedAt)
  })).filter(p=>cropById(p.cropId));
  state.logs = (d.logs||[]).filter(r=>r.id).map(r=>({
    id:String(r.id), plantingId:String(r.plantingId), taskId:String(r.taskId), date:String(r.date).slice(0,10),
    type:String(r.type||"work"), qty: r.type==="harvest" ? num(r.qty) : undefined, updatedAt:num(r.updatedAt)
  }));
  const srow = (d.settings||[]).find(r=>r.key==="settings");
  if(srow){ try{ Object.assign(state.settings, JSON.parse(srow.value)); }catch(e){} }
  state.sync.outbox = []; state.sample = false;
  state.sync.lastOk = Date.now(); state.sync.lastErr = "";
  save();
}

window.addEventListener("online", ()=>scheduleFlush(200));
document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="visible"){ scheduleFlush(500); refreshFrost(); } });
setInterval(()=>{ if(state && state.sync.outbox.length) flush(); }, 60000);

/* =============================================================
   やることの計算
   ============================================================= */
function cropOff(cropId){ return (state.settings.offset|0) + ((state.settings.cropOffset||{})[cropId]|0); }
function logsFor(pid, tid){
  return state.logs.filter(l=>l.plantingId===pid && l.taskId===tid).sort((a,b)=>a.date<b.date?-1:1);
}
function firstDue(p, crop, task){
  const base = parseD(p.date), t = task.trigger, OFF = cropOff(crop.id);
  return t.type==="offset" ? addD(base, t.days + OFF) : addD(resolveCal(t.when, base), OFF);
}
function computeTasks(){
  const t0 = today(), out = [];
  state.plantings.filter(p=>p.status!=="done").forEach(p=>{
    const crop = cropById(p.cropId); if(!crop) return;
    const base = parseD(p.date), started = base <= t0, OFF = cropOff(crop.id);
    crop.tasks.forEach(task=>{
      const t = task.trigger;
      if(t.type==="offset" && t.days < 0 && started) return;       // 準備作業は作付け日を過ぎたら不要
      const first = firstDue(p, crop, task);
      const done = logsFor(p.id, task.id);
      let due, end = null;
      if(t.repeat){
        end = t.type==="offset" ? addD(base, t.repeat.untilDays + OFF) : addD(first, t.repeat.untilDays);
        due = done.length ? addD(parseD(done[done.length-1].date), t.repeat.everyDays) : first;
        if(due < first) due = first;
        // 何回も抜けているときは、いちばん最近の回まで進める（96日遅れ、のような表示を出さない）
        if(due < t0){ const k = Math.floor(diffD(t0, due) / t.repeat.everyDays); due = addD(due, k*t.repeat.everyDays); }
        if(due > end) return;
      }else{
        if(done.length) return;
        due = first;
      }
      const isHarvest = task.kind==="harvest";
      const kind = task.routine ? "routine"
                 : (isHarvest && t.repeat && (done.length || due <= t0)) ? "season"
                 : "normal";
      out.push({ p, crop, task, due, end, kind, doneCount:done.length });
    });
  });
  out.sort((a,b)=> a.due - b.due || a.p.id.localeCompare(b.p.id));
  return out;
}

/* =============================================================
   適期
   ============================================================= */
function windowInfo(c){
  const t0 = today(), OFF = cropOff(c.id), y = t0.getFullYear();
  const s0 = jun(c.start.window[0]);
  let start = addD(new Date(y, s0.month-1, s0.day), OFF);
  let end   = addD(junEndDate(c.start.window[1], y), OFF);
  if(t0 > end){
    start = addD(new Date(y+1, s0.month-1, s0.day), OFF);
    end   = addD(junEndDate(c.start.window[1], y+1), OFF);
  }
  const n = diffD(start, t0);
  return { start, end, n, inWindow: n<=0 && t0<=end, left: diffD(end,t0) };
}
function defaultDate(c){ const w = windowInfo(c); return fmtD(w.inWindow ? today() : w.start); }
function upcomingWindows(days){
  const out = [];
  (state.settings.myCrops||[]).forEach(id=>{
    const c = cropById(id); if(!c) return;
    if(state.plantings.some(p=>p.status!=="done" && p.cropId===id)) return;
    const w = windowInfo(c);
    if(w.n > days) return;
    out.push(Object.assign({crop:c}, w));
  });
  return out.sort((a,b)=>a.start-b.start);
}

/* =============================================================
   検査：空き・連作（区画単位）・日照
   ============================================================= */
function freeSlotsElsewhere(crop, d, exclude){
  const years = (DATA.families[crop.family]||{}).rotationYears || 0;
  return ALL_SLOTS.filter(s=>{
    if(exclude.includes(s) || occupant(s)) return false;
    if(!years) return true;
    return !state.plantings.some(p=>{
      const c = cropById(p.cropId);
      return c && c.family===crop.family && (p.slots||[]).includes(s) && Math.abs(diffD(d, parseD(p.date)))/365.25 < years;
    });
  });
}
function checkPlanting(slots, cropId, dateStr, ignoreId){
  const out = [], crop = cropById(cropId);
  if(!crop || !slots || !slots.length) return out;
  const bed = bedById(slotBed(slots[0])), d = parseD(dateStr);

  const busy = slots.map(s=>({s, p:occupant(s, ignoreId)})).filter(x=>x.p);
  if(busy.length){
    out.push({level:"amber", title:"区画が埋まっています",
      text: busy.map(b=>`区画${slotIdx(b.s)}は<b>${esc(cropById(b.p.cropId).name)}</b>が使用中`).join("／")+"。作付けを終了するか、別の区画を選んでください。"});
  }
  const years = (DATA.families[crop.family]||{}).rotationYears || 0;
  if(years){
    const hits = [];
    state.plantings.forEach(p=>{
      if(p.id===ignoreId) return;
      const c = cropById(p.cropId);
      if(!c || c.family!==crop.family) return;
      const ov = (p.slots||[]).filter(s=>slots.includes(s));
      if(!ov.length) return;
      const days = Math.abs(diffD(d, parseD(p.date)));
      if(days/365.25 < years) hits.push({c, ov, days});
    });
    if(hits.length){
      const h = hits[hits.length-1];
      const ago = h.days<=45 ? "ちょうど今" : h.days<365 ? `${Math.round(h.days/30)}か月前に` : `${(h.days/365.25).toFixed(1)}年前に`;
      const free = freeSlotsElsewhere(crop, d, slots);
      out.push({level:"red", title:"連作注意",
        text:`${esc(bed.name)}の区画${h.ov.map(slotIdx).sort().join("・")}では${ago}<b>${esc(h.c.name)}</b>（${esc(crop.family)}）を作付けしています。${esc(crop.family)}は<b>${years}年</b>空けたい作物です。`+
          (free.length?`<br>空いていて連作にならない区画：<b>${free.slice(0,6).map(s=>bedById(slotBed(s)).name+"-"+slotIdx(s)).join("、")}</b>`:"")});
    }
  }
  if(crop.winterSunRequired && bed.winterSun==="half")
    out.push({level:"amber", title:"日照注意", text:`${esc(bed.name)}は${esc(bed.note)}。${esc(crop.winterSunNote||"")}日当たりの良い畝を検討してください。`});
  if(crop.shadeOk && bed.winterSun==="half")
    out.push({level:"good", title:"この畝に向いています", text:`${esc(crop.name)}は半日陰でも育ちます。${esc(bed.name)}を使えば、日当たりの良い畝を他の作物に空けられます。`});
  return out;
}
function extendFrom(anchor, need, ignoreId){
  const bed = slotBed(anchor), i0 = slotIdx(anchor);
  const free = i => i>=1 && i<=DIV && !occupant(bed+i, ignoreId);
  const got = [i0]; let r = i0+1, l = i0-1;
  while(got.length < need && (free(r) || free(l))){ if(free(r)) got.push(r++); else got.push(l--); }
  return got.sort((a,b)=>a-b).map(i=>bed+i);
}
function autoPlace(cropId){
  const crop = cropById(cropId), need = needOf(cropId), date = defaultDate(crop);
  const score = b => crop.shadeOk ? (b.winterSun==="half"?0:1) : (b.winterSun==="half"?1:0);
  let fallback = null;
  for(const bed of BEDS.slice().sort((a,b)=>score(a)-score(b))){
    for(let i=1;i<=DIV-need+1;i++){
      const slots = Array.from({length:need},(_,k)=>bed.id+(i+k));
      if(slots.some(s=>occupant(s))) continue;
      const ws = checkPlanting(slots, cropId, date);
      if(!ws.some(w=>w.level==="red"||w.level==="amber")) return slots;
      if(!fallback) fallback = slots;
    }
  }
  return fallback;
}

/* =============================================================
   霜予報（Open-Meteo・無料・キー不要）
   ============================================================= */
let frost = null;   // { date, tmin, fetchedAt }
async function refreshFrost(){
  if(PREVIEW) return;
  const cache = (()=>{ try{ return JSON.parse(lsGet("hatake-frost")||"null"); }catch(e){ return null; } })();
  if(cache && Date.now()-cache.fetchedAt < 3*3600*1000){ frost = cache; renderWeek(); return; }
  try{
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${PLACE.lat}&longitude=${PLACE.lon}&daily=temperature_2m_min&timezone=Asia%2FTokyo&forecast_days=7`;
    const r = await fetch(u); const j = await r.json();
    const days = (j.daily&&j.daily.time)||[], mins = (j.daily&&j.daily.temperature_2m_min)||[];
    let hit = null;
    days.forEach((d,i)=>{ if(!hit && mins[i]!=null && mins[i] <= FROST_C) hit = {date:d, tmin:mins[i]}; });
    frost = Object.assign({fetchedAt:Date.now()}, hit||{date:null});
    lsSet("hatake-frost", JSON.stringify(frost));
    renderWeek();
  }catch(e){ /* 取れなければ表示しないだけ */ }
}
function frostTargets(){
  const t0 = today(), out = [];
  state.plantings.filter(p=>p.status!=="done" && parseD(p.date)<=t0).forEach(p=>{
    const c = cropById(p.cropId); if(!c || !c.frost) return;
    const age = diffD(t0, parseD(p.date));
    const text = (age<=21 && c.frost.spring) ? c.frost.spring : c.frost.autumn;
    if(text) out.push({p, c, text});
  });
  return out;
}

/* =============================================================
   実績から作物ごとの補正を提案
   ============================================================= */
function offsetSuggestions(){
  const by = {};
  state.plantings.forEach(p=>{
    const c = cropById(p.cropId); if(!c) return;
    const ht = c.tasks.find(t=>t.kind==="harvest"); if(!ht) return;
    const hs = state.logs.filter(l=>l.plantingId===p.id && l.type==="harvest").sort((a,b)=>a.date<b.date?-1:1);
    if(!hs.length) return;
    const base = parseD(p.date);
    const std = ht.trigger.type==="offset" ? addD(base, ht.trigger.days) : resolveCal(ht.trigger.when, base);
    const delta = diffD(parseD(hs[0].date), std);
    (by[c.id] = by[c.id] || {c, deltas:[]}).deltas.push(delta);
  });
  return Object.values(by).map(x=>{
    const avg = x.deltas.reduce((s,v)=>s+v,0)/x.deltas.length;
    const suggest = Math.max(-30, Math.min(30, Math.round(avg) - (state.settings.offset|0)));
    const cur = (state.settings.cropOffset||{})[x.c.id]|0;
    return { crop:x.c, n:x.deltas.length, avg:Math.round(avg), suggest, cur };
  }).filter(s=>Math.abs(s.suggest - s.cur) >= 3);
}

/* =============================================================
   描画
   ============================================================= */
function renderAll(){ renderWeek(); renderField(); renderLog(); renderSettings(); renderSyncDot(); }

function whenLabel(due, lateOk){
  const n = diffD(due, today());
  if(n<0) return lateOk ? `<b>${-n}日 遅れ</b>${jp(due)}` : `<b>今日</b>${jp(today())}`;
  if(n===0) return `<b>今日</b>${jp(due)}`;
  if(n<=6)  return `<b>${n}日後</b>${jp(due)}`;
  return jp(due);
}
function taskRow(x, cls){
  const bed = bedOf(x.p);
  const stage = x.task.trigger.stage ? `／目安 ${esc(x.task.trigger.stage)}` : "";
  return `<button class="task ${cls||""}" data-act="open" data-p="${x.p.id}" data-t="${x.task.id}" data-d="${fmtD(x.due)}">
    <span class="bed">${bed?bed.id:"?"}</span>
    <span class="tbody"><span class="tname">${esc(x.task.name)}</span>
      <span class="tmeta">${esc(x.crop.name)}・区画${slotNums(x.p)}${stage}</span></span>
    <span class="tdue">${whenLabel(x.due, x.kind==="normal")}</span>
  </button>`;
}

/* ---------- 今週 ---------- */
function renderWeek(){
  if(!state) return;
  const t0 = today(), all = computeTasks();
  const within = (x,n) => diffD(x.due,t0) <= n;
  const routine = all.filter(x=>x.kind==="routine" && within(x,6));
  const season  = all.filter(x=>x.kind==="season" && within(x,0));
  const normal  = all.filter(x=>x.kind==="normal" || (x.kind==="season" && !within(x,0)));
  const stale   = normal.filter(x=>!x.task.trigger.repeat && diffD(t0,x.due) > 21);   // 3週間以上前の一回きりの作業
  const late    = normal.filter(x=>x.due < t0 && !stale.includes(x));
  const week    = normal.filter(x=>x.due >= t0 && within(x,6));
  const later   = normal.filter(x=>diffD(x.due,t0) > 6 && within(x,60));

  let h = "";
  if(state.sample){
    h += `<div class="banner">サンプルの作付けで表示しています。<button class="btn" data-act="clear-sample">消して自分の畑を登録</button></div>`;
  }

  /* 霜 */
  if(frost && frost.date){
    const targets = frostTargets();
    if(targets.length){
      const fd = parseD(frost.date), n = diffD(fd, t0);
      h += `<div class="frost" role="alert">
        <div class="frost-head"><span class="frost-title">霜注意</span>
          <span class="frost-temp">${frost.tmin.toFixed(1)}℃</span>
          <span class="frost-when">${n<=0?"今夜〜明朝":n===1?"明日":`${n}日後`}　${jp(fd)} の最低気温予報</span></div>
        <ul>${targets.map(t=>`<li><b>${esc(t.c.name)}</b>（${esc(bedOf(t.p).name)} 区画${slotNums(t.p)}）${esc(t.text)}</li>`).join("")}</ul>
        <div class="frost-src">${esc(PLACE.name)}・最低気温${FROST_C}℃以下で表示／天気予報：Open-Meteo</div>
      </div>`;
    }
  }

  /* 見回り */
  if(routine.length){
    h += `<div class="sect"><div class="sect-head"><h2>見回り</h2><span class="count">${routine.length}</span></div>
      <div class="round">
        <div class="round-head"><span class="round-title">今週の見回り</span><span class="round-sub">名前をタップで手順</span></div>
        <div class="round-list">${routine.map(x=>`<button class="round-item" data-act="open" data-p="${x.p.id}" data-t="${x.task.id}" data-d="${fmtD(x.due)}">
          <span>${esc(x.task.name)}</span><span class="ri-crop">${esc(x.crop.name)}　${esc(bedOf(x.p).id)}-${slotNums(x.p)}</span></button>`).join("")}</div>
        <button class="btn primary wide" data-act="round-done">まとめて見回り済みにする</button>
      </div></div>`;
  }

  /* 収穫期 */
  if(season.length){
    h += `<div class="sect"><div class="sect-head"><h2>収穫期</h2><span class="count">${season.length}</span></div><div class="stack">
      ${season.map(x=>{
        const last = logsFor(x.p.id, x.task.id).slice(-1)[0];
        const bed = bedOf(x.p);
        return `<button class="task" data-act="open" data-p="${x.p.id}" data-t="${x.task.id}" data-d="${fmtD(t0)}">
          <span class="bed">${bed.id}</span>
          <span class="tbody"><span class="tname">${esc(x.crop.name)}　${esc(x.task.name)}</span>
            <span class="tmeta">区画${slotNums(x.p)}・${last?`前回 ${jp(parseD(last.date))}`:"まだ収穫なし"}</span></span>
          <span class="tdue">${x.end?`〜${jp(x.end)}`:""}</span>
        </button>`;}).join("")}
    </div></div>`;
  }

  const group = (title, items, cls) => !items.length ? "" :
    `<div class="sect"><div class="sect-head"><h2>${esc(title)}</h2><span class="count">${items.length}</span></div>
     <div class="stack">${items.map(x=>taskRow(x,cls)).join("")}</div></div>`;
  if(stale.length){
    h += `<div class="sect"><div class="round">
      <div class="round-head"><span class="round-title">3週間以上前の作業 ${stale.length}件</span>
        <span class="round-sub">時期が過ぎているので、やらなかったものは見送りにできます</span></div>
      <div class="round-list">${stale.map(x=>`<button class="round-item" data-act="open" data-p="${x.p.id}" data-t="${x.task.id}" data-d="${fmtD(x.due)}">
        <span>${esc(x.task.name)}</span><span class="ri-crop">${esc(x.crop.name)}　${jp(x.due)}</span></button>`).join("")}</div>
      <button class="btn wide" data-act="skip-stale" style="margin-top:10px">まとめて見送りにする</button>
    </div></div>`;
  }
  h += group("遅れている", late, "late");
  h += group(`今週　${jp(t0)}〜${jp(addD(t0,6))}`, week, "soon");
  h += group("この先2か月", later, "");

  if(!state.plantings.length){
    h += `<div class="welcome"><h3>はじめに</h3>
      <ol><li>「畑」タブで、今年作る作物を選ぶ</li>
          <li>畝の区画をタップして、植えた（植える予定の）作物を登録する</li>
          <li>「設定」でスプレッドシートとつなぐと、記録が自動で保存されます</li></ol></div>`;
  }else if(!all.length){
    h += `<div class="sect"><div class="card"><div class="empty">予定されている作業はありません。</div></div></div>`;
  }

  const shop = {};
  normal.filter(x=>within(x,30)).forEach(x=>(x.task.materials||[]).forEach(m=>shop[m]=(shop[m]||0)+1));
  const keys = Object.keys(shop);
  if(keys.length){
    h += `<div class="sect"><div class="sect-head"><h2>買うもの</h2><span class="count">30日以内</span></div>
      <div class="chips">${keys.map(k=>`<span class="chip">${esc(k)}${shop[k]>1?` <b>×${shop[k]}</b>`:""}</span>`).join("")}</div></div>`;
  }
  $("#panel-week").innerHTML = h;
}

/* ---------- 畑 ---------- */
function renderField(){
  const t0 = today();
  let h = `<div class="sect"><div class="sect-head"><h2>畝</h2><span class="count">区画をタップ</span></div>`;
  BEDS.forEach(bed=>{
    const ps = state.plantings.filter(p=>p.status!=="done" && bedOf(p).id===bed.id);
    h += `<div class="card bedcard">
      <div class="bedhead"><span class="bed">${bed.id}</span><span class="bedname">${esc(bed.name)}</span><span class="bednote">${esc(bed.note)}</span></div>
      <div class="strip">${slotsOf(bed.id).map(s=>{
        const p = ps.find(x=>x.slots.includes(s)), c = p ? cropById(p.cropId) : null;
        const future = p && parseD(p.date) > t0;
        return `<button class="cell${c?" busy":""}${future?" plan":""}" data-act="cell" data-s="${s}" aria-label="${esc(bed.name)} 区画${slotIdx(s)} ${c?esc(c.name):"空き"}">
          <span class="cidx">${slotIdx(s)}</span>
          ${c?`<span class="cname">${esc(c.name)}</span><span class="cfam">${future?"予定":esc(c.family)}</span>`
             :`<span class="cplus">＋</span><span class="cfree">植える</span>`}</button>`;
      }).join("")}</div>
      ${ps.map(p=>{
        const c = cropById(p.cropId), d = parseD(p.date), future = d > t0, n = Math.abs(diffD(t0,d));
        return `<button class="plantrow" data-act="planting" data-p="${p.id}">
          <span class="pname">${esc(c.name)}</span><span class="ptype">区画${slotNums(p)}</span>
          <span class="pdate">${future?`予定 ${jp(d)}・${n}日後`:`${jp(d)}〜・${n}日目`}</span></button>`;
      }).join("")}
    </div>`;
  });
  h += `</div>`;

  const my = state.settings.myCrops || [];
  const wins = upcomingWindows(60);
  h += `<div class="sect"><div class="sect-head"><h2>作付けの適期</h2><span class="count">60日以内</span></div><div class="card">`;
  h += !wins.length
    ? `<div class="empty">60日以内にまける・植えられる作物はありません。${my.length?"（植え付け済みの作物は除いています）":"下で作る作物を選んでください。"}</div>`
    : wins.map(w=>`<div class="win">
        <span class="winname">${esc(w.crop.name)}</span><span class="ptype">${esc(w.crop.start.action)}</span>
        <span class="winwhen">${w.inWindow?`<b class="now">適期中</b> ${w.left<=0?"今日まで":`残り${w.left}日`}`:`<b>${w.n}日後</b> ${jp(w.start)}〜`}</span>
        <button class="btn" data-act="auto-place" data-c="${w.crop.id}">空き区画に植える</button></div>`).join("");
  h += `</div></div>`;

  h += `<div class="sect"><div class="sect-head"><h2>作る作物</h2><span class="count">${my.length} / ${DATA.crops.length}</span></div>
    <div class="card"><div class="chips">${DATA.crops.map(c=>{
      const on = my.includes(c.id);
      return `<button class="chip${on?" sel":""}" data-act="toggle-crop" data-c="${c.id}" aria-pressed="${on}"><span class="mark">${on?"✓":"＋"}</span>${esc(c.name)}</button>`;
    }).join("")}</div>
    <div class="hint" style="margin-top:10px">選んだ作物だけが、区画をタップしたときの一覧と適期のお知らせに出ます。外しても、植えてある分のやることは消えません。</div></div></div>`;
  $("#panel-field").innerHTML = h;
}

/* ---------- 記録 ---------- */
let logYear = null, logCrop = "";

function plantingSpan(p){
  const t0 = today();
  const logs = state.logs.filter(l=>l.plantingId===p.id).sort((a,b)=>a.date<b.date?-1:1);
  const hs = logs.filter(l=>l.type==="harvest");
  const start = parseD(p.date);
  const lastLog = logs.length ? parseD(logs[logs.length-1].date) : start;
  let end;
  if(p.status==="done") end = p.endDate ? parseD(p.endDate) : lastLog;
  else end = start > t0 ? null : (t0 > lastLog ? t0 : lastLog);
  const hFirst = hs.length ? parseD(hs[0].date) : null;
  let hLast = hs.length ? parseD(hs[hs.length-1].date) : null;
  if(hLast && p.status!=="done" && end && end > hLast) hLast = end;     // 収穫期の途中
  const total = hs.reduce((s,l)=>s+(l.qty||0),0);
  return { start, end, hFirst, hLast, hs, total, planned: start > t0 };
}

function monthsBetween(a,b){ return (b.getFullYear()-a.getFullYear())*12 + (b.getMonth()-a.getMonth()); }
/* 表の上での作付けの終わり：終了日／今日／予定なら収穫開始の見込み */
function rowEnd(r){
  if(r.sp.end) return r.sp.end;
  const c = cropById(r.p.cropId), ht = c.tasks.find(t=>t.kind==="harvest");
  return ht ? firstDue(r.p, c, ht) : addD(r.sp.start, 60);
}

function renderLog(){
  const t0 = today();
  const years = new Set([t0.getFullYear()]);
  state.plantings.forEach(p=>{ const sp = plantingSpan(p); years.add(sp.start.getFullYear()); if(sp.end) years.add(sp.end.getFullYear()); });
  const yl = [...years].sort((a,b)=>b-a);
  if(!logYear || !yl.includes(logYear)) logYear = t0.getFullYear();

  let h = "";
  /* 最近の記録 */
  const recent = state.logs.slice().sort((a,b)=> (b.updatedAt||0)-(a.updatedAt||0) || (a.date<b.date?1:-1)).slice(0,5);
  h += `<div class="sect"><div class="sect-head"><h2>最近の記録</h2></div><div class="card">`;
  h += recent.length ? `<div class="hist" style="border-top:0;margin-top:0">${recent.map(histRow).join("")}</div>
      <div class="hint" style="margin-top:6px">タップで修正・取り消し</div>`
    : `<div class="empty">まだ記録がありません。やることを「完了」にすると、ここに残ります。</div>`;
  h += `</div></div>`;

  /* 年間表 */
  const usedCrops = [...new Set(state.plantings.map(p=>p.cropId))].map(cropById).filter(Boolean);
  h += `<div class="sect"><div class="sect-head"><h2>${logCrop?"年ごとの比較":"年間の作付け"}</h2></div>
    <div class="yearbar">
      ${logCrop ? `<span class="cmp-note">${esc(cropById(logCrop).name)}を年ごとに並べています</span>`
        : `<label for="lg-year" class="muted">年</label>
           <select id="lg-year">${yl.map(y=>`<option value="${y}"${y===logYear?" selected":""}>${y}年</option>`).join("")}</select>`}
    </div>
    ${usedCrops.length ? `<div class="cropfilter">
      <button class="chip${!logCrop?" sel":""}" data-act="log-crop" data-c="">すべて</button>
      ${usedCrops.map(c=>`<button class="chip${logCrop===c.id?" sel":""}" data-act="log-crop" data-c="${c.id}">${esc(c.name)}</button>`).join("")}
    </div>`:""}
    <div class="card" style="margin-top:10px;padding:10px 8px">
      <div class="gantt-wrap" id="ganttWrap"></div>
      <div class="legend">
        <span><i class="l-grow"></i>育てている期間</span><span><i class="l-harv"></i>収穫期間</span>
        <span><i class="l-dot"></i>収穫した日</span><span><i class="l-plan"></i>予定</span>
      </div>
    </div></div>`;

  /* 終了した作付け */
  const done = state.plantings.filter(p=>p.status==="done").sort((a,b)=>a.date<b.date?1:-1);
  if(done.length){
    h += `<div class="sect"><div class="sect-head"><h2>終了した作付け</h2><span class="count">${done.length}</span></div><div class="card">
      ${done.map(p=>{ const c = cropById(p.cropId), sp = plantingSpan(p);
        return `<button class="plantrow" data-act="planting" data-p="${p.id}">
          <span class="bed" style="width:22px;height:22px;font-size:12px">${bedOf(p).id}</span>
          <span class="pname">${esc(c.name)}</span><span class="ptype">区画${slotNums(p)}</span>
          <span class="pdate">${sp.start.getFullYear()}年${sp.start.getMonth()+1}月〜${sp.total?`・${sp.total}${esc(c.unit)}`:""}</span></button>`;}).join("")}
      </div><div class="hint" style="margin-top:8px">連作チェックはこの履歴を使います。登録が間違いだったものは削除してください。</div></div>`;
  }
  $("#panel-log").innerHTML = h;
  const ys = $("#lg-year"); if(ys) ys.addEventListener("change", ()=>{ logYear = parseInt(ys.value,10); renderLog(); });
  drawGantt();
}

function histRow(l){
  const p = state.plantings.find(x=>x.id===l.plantingId);
  const c = p ? cropById(p.cropId) : null, t = c ? c.tasks.find(x=>x.id===l.taskId) : null;
  const isH = l.type==="harvest";
  return `<button class="hrow${isH?" harv":""}" data-act="log" data-l="${l.id}">
    <span class="hd">${esc(l.date.slice(5).replace("-","/"))}</span>
    <span class="hn">${c?esc(c.name):"?"}　<span style="color:var(--ink2);font-size:12.5px">${t?esc(t.name):""}</span></span>
    <span class="hq">${isH?`${l.qty||0}${esc(c?c.unit:"")}`:l.type==="skip"?`<span style="color:var(--ink3);font-weight:400">見送り</span>`:""}</span></button>`;
}

/* 年間表（ガントチャート）
   - 年表示：その年に畑にあった作付けを、実際の日付で並べる
   - 作物で絞る：同じ作物を年ごとに並べ、月日をそろえて比較する */
function drawGantt(){
  const wrap = $("#ganttWrap"); if(!wrap) return;
  const t0 = today();
  let rows, x0, x1, toX, compare = !!logCrop;

  if(compare){
    const ps = state.plantings.filter(p=>p.cropId===logCrop).sort((a,b)=>a.date<b.date?-1:1);
    rows = ps.map(p=>({p, sp:plantingSpan(p), label:`${parseD(p.date).getFullYear()}年`, sub:`${bedOf(p).id}-${slotNums(p)}`}));
    // 植えた年の1月1日からの日数でそろえる（年またぎの玉ねぎも同じ軸に乗る）
    const rel = (d, p) => diffD(d, new Date(parseD(p.date).getFullYear(),0,1));
    let lo = Infinity, hi = -Infinity;
    rows.forEach(r=>{
      lo = Math.min(lo, rel(r.sp.start, r.p));
      hi = Math.max(hi, rel(rowEnd(r), r.p));
    });
    const ref = new Date(2025,0,1);               // 月ラベル用の基準年（平年）
    const a = addD(ref, isFinite(lo)?lo:0), b = addD(ref, isFinite(hi)?hi:365);
    x0 = new Date(a.getFullYear(), a.getMonth(), 1);
    x1 = new Date(b.getFullYear(), b.getMonth()+1, 1);
    if(diffD(x1,x0) < 180) x1 = new Date(x0.getFullYear(), x0.getMonth()+6, 1);
    rows.forEach(r=>{ r.map = d => addD(ref, rel(d, r.p)); });
  }else{
    const Y = logYear, ys = new Date(Y,0,1), ye = new Date(Y+1,0,1);
    rows = state.plantings.map(p=>({p, sp:plantingSpan(p)})).filter(r=>{
      return r.sp.start < ye && rowEnd(r) >= ys;
    }).sort((a,b)=>a.sp.start-b.sp.start).map(r=>Object.assign(r,{
      label: cropById(r.p.cropId).name, sub:`${bedOf(r.p).id}-${slotNums(r.p)}`, map:d=>d }));
    // 表示範囲：データのある月だけ（最低6か月、年またぎは翌年6月まで）
    let lo = null, hi = null;
    rows.forEach(r=>{ const a = r.sp.start < ys ? ys : r.sp.start, e = rowEnd(r); if(!lo||a<lo) lo = a; if(!hi||e>hi) hi = e; });
    if(!rows.length){ lo = ys; hi = ye; }
    if(t0.getFullYear()===Y){ if(t0<lo) lo = t0; if(t0>hi) hi = t0; }
    const cap = new Date(Y+1,6,1);
    x0 = new Date(lo.getFullYear(), lo.getMonth(), 1);
    x1 = new Date(Math.min(cap, new Date(hi.getFullYear(), hi.getMonth()+1, 1)));
    while(monthsBetween(x0,x1) < 6){
      if(x0 > ys) x0 = new Date(x0.getFullYear(), x0.getMonth()-1, 1);
      else x1 = new Date(x1.getFullYear(), x1.getMonth()+1, 1);
    }
  }

  if(!rows.length){
    wrap.innerHTML = `<div class="empty" style="padding:14px 6px">${compare?"この作物の作付けはまだありません。":`${logYear}年の作付けはまだありません。`}</div>`;
    return;
  }

  const W = Math.max(wrap.clientWidth || 320, 300);
  const LBL = W<420 ? 72 : 92, TOT = W<420 ? 50 : 62, TOP = 22, RH = 34, PAD = 8;
  const plotW = W - LBL - TOT - PAD;
  const span = Math.max(1, diffD(x1, x0));
  toX = d => LBL + Math.max(0, Math.min(plotW, diffD(d, x0) / span * plotW));
  const H = TOP + rows.length*RH + 6;

  let s = `<svg class="gantt" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${compare?"年ごとの比較":"年間の作付け"}">`;
  // 月の目盛り
  for(let m = new Date(x0); m < x1; m = new Date(m.getFullYear(), m.getMonth()+1, 1)){
    const x = toX(m), nx = toX(new Date(m.getFullYear(), m.getMonth()+1, 1));
    s += `<line class="g-grid" x1="${x}" y1="${TOP-4}" x2="${x}" y2="${H-4}"/>`;
    const step = (plotW / Math.max(1, monthsBetween(x0,x1))) < 18 ? 2 : 1;
    if((m.getMonth() % step)===0 || m.getMonth()===0) s += `<text class="${m.getMonth()===0&&!compare?"g-year":"g-month"}" x="${(x+nx)/2}" y="${TOP-9}" text-anchor="middle">${m.getMonth()===0&&!compare?`${String(m.getFullYear()).slice(2)}/1`:m.getMonth()+1}</text>`;
  }
  s += `<line class="g-grid" x1="${toX(x1)}" y1="${TOP-4}" x2="${toX(x1)}" y2="${H-4}"/>`;
  if(!compare && t0 >= x0 && t0 <= x1) s += `<line class="g-today" x1="${toX(t0)}" y1="${TOP-4}" x2="${toX(t0)}" y2="${H-4}"/>`;

  rows.forEach((r,i)=>{
    const y = TOP + i*RH, cy = y + RH/2, c = cropById(r.p.cropId), sp = r.sp, m = r.map;
    const aria = `${r.label} ${r.sub}、${jp(sp.start)}から${sp.total?`、収穫 ${sp.total}${c.unit}`:""}`;
    s += `<g class="g-row" tabindex="0" role="button" data-act="planting" data-p="${r.p.id}" aria-label="${esc(aria)}">`;
    s += `<rect class="g-hit" x="0" y="${y+2}" width="${W}" height="${RH-4}" rx="6"/>`;
    s += `<text class="g-label" x="4" y="${cy-1}">${esc(r.label)}</text><text class="g-sub" x="4" y="${cy+11}">${esc(r.sub)}</text>`;
    if(sp.planned){
      const ht = c.tasks.find(t=>t.kind==="harvest");
      const hx = ht ? firstDue(r.p, c, ht) : addD(sp.start, 60);
      const xa = toX(m(sp.start)), xb = Math.max(xa+8, toX(m(hx)));
      s += `<rect class="g-plan" x="${xa}" y="${cy-5}" width="${xb-xa}" height="10" rx="5"/>`;
    }else{
      const xa = toX(m(sp.start)), xb = Math.max(xa+6, toX(m(sp.end||t0)));
      s += `<rect class="g-grow" x="${xa}" y="${cy-5}" width="${xb-xa}" height="10" rx="5"/>`;
      if(sp.hFirst){
        const ha = toX(m(sp.hFirst)), hb = Math.max(ha+6, toX(m(sp.hLast||sp.hFirst)));
        s += `<rect class="g-harv" x="${ha}" y="${cy-5}" width="${hb-ha}" height="10" rx="5"/>`;
        sp.hs.forEach(l=>{ s += `<circle class="g-dot" cx="${toX(m(parseD(l.date)))}" cy="${cy}" r="3"/>`; });
      }
    }
    if(sp.total) s += `<text class="g-total" x="${W-4}" y="${cy+1}" text-anchor="end">${sp.total}<tspan class="g-unit" dx="2">${esc(c.unit)}</tspan></text>`;
    s += `</g>`;
  });
  s += `</svg>`;
  wrap.innerHTML = s;
}

/* ---------- 設定 ---------- */
function syncStatus(){
  const s = state.sync;
  if(PREVIEW) return {cls:"", text:"プレビューでは同期しません"};
  if(!s.url) return {cls:"", text:"未設定（この端末だけに保存）"};
  if(s.lastErr) return {cls:"err", text:s.lastErr + (s.outbox.length?`・未送信 ${s.outbox.length}件`:"")};
  if(s.outbox.length) return {cls:"wait", text:`未送信 ${s.outbox.length}件`};
  if(s.lastOk){ const d = new Date(s.lastOk); return {cls:"ok", text:`同期済み ${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`}; }
  return {cls:"wait", text:"接続待ち"};
}
function renderSyncDot(){
  const el = $("#syncDot"); if(!el || !state) return;
  if(PREVIEW){ el.hidden = true; return; }
  const st = syncStatus();
  el.hidden = false;
  el.className = "syncdot " + st.cls;
  el.querySelector("span").textContent = !state.sync.url ? "未同期" : st.cls==="ok" ? "同期済み" : st.cls==="err" ? "同期エラー" : "送信待ち";
}
function renderSettings(){
  const st = syncStatus(), s = state.settings;
  const sugg = offsetSuggestions();
  const offs = Object.entries(s.cropOffset||{}).filter(([k,v])=>v);
  let h = `<div class="sect"><div class="sect-head"><h2>スプレッドシート同期</h2></div><div class="card">
    <div class="setrow">
      <div class="status-line">状態：<b class="${st.cls}">${esc(st.text)}</b></div>
      ${PREVIEW?`<div class="desc">GitHub Pages に置いた版で使えます。</div>`:""}
    </div>
    ${PREVIEW?"":`<div class="setrow">
      <label class="lbl" for="set-url">保存先のURL（Apps Script のウェブアプリURL）</label>
      <input type="url" id="set-url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(state.sync.url)}" autocomplete="off" spellcheck="false">
      <div class="desc">このURLは合鍵の役割をします。人に見せたり、GitHubのコードに書いたりしないでください。</div>
      <div class="btns"><button class="btn primary" data-act="sync-connect">保存してつなぐ</button>
        ${state.sync.url?`<button class="btn" data-act="sync-now">今すぐ同期</button>`:""}</div>
    </div>
    ${state.sync.url?`<div class="setrow">
      <div class="lbl">機種変更・データが消えたとき</div>
      <div class="desc">スプレッドシートの記録をこの端末に読み込みます。この端末の記録は置き換わります。</div>
      <div class="btns"><button class="btn" data-act="sync-restore">スプレッドシートから復元</button></div>
    </div>`:""}`}
  </div></div>`;

  h += `<div class="sect"><div class="sect-head"><h2>時期の補正</h2></div><div class="card">
    <div class="setrow">
      <label class="lbl" for="set-offset">全体の補正（日）</label>
      <div class="desc">関東標準の時期から、全作物のやることを前後にずらします。マイナスで前倒し。</div>
      <input type="number" id="set-offset" value="${s.offset|0}" min="-30" max="30" step="1" style="width:90px;font-family:inherit;font-size:15px;padding:7px 9px;border:1px solid var(--line2);border-radius:8px;background:var(--surface);color:var(--ink);text-align:right">
    </div>
    <div class="setrow">
      <div class="lbl">作物ごとの補正（実績から提案）</div>
      <div class="desc">収穫の記録がたまると、実際の収穫開始日と標準のずれを作物ごとに計算して、ここに提案します。</div>
      ${sugg.length ? sugg.map(x=>`<div class="sugg"><span class="sname">${esc(x.crop.name)}</span>
          <span class="sdiff">標準より${x.avg>=0?"+":""}${x.avg}日（${x.n}作付け）</span>
          <button class="btn" data-act="apply-off" data-c="${x.crop.id}" data-v="${x.suggest}">補正を${x.suggest>=0?"+":""}${x.suggest}日にする</button></div>`).join("")
        : `<div class="empty" style="padding:4px 0">いまは提案はありません。</div>`}
      ${offs.length?`<div class="offchips">${offs.map(([k,v])=>`<button class="chip" data-act="reset-off" data-c="${k}">${esc(cropById(k)?cropById(k).name:k)} ${v>0?"+":""}${v}日 ✕</button>`).join("")}</div>
        <div class="desc">タップで作物ごとの補正を0に戻します。</div>`:""}
    </div>
  </div></div>`;

  h += `<div class="sect"><div class="muted" style="font-size:11.5px">畑ノート ${APP_VERSION}・作物データ ${DATA.crops.length}種（crops.json）</div></div>`;
  $("#panel-set").innerHTML = h;
  const off = $("#set-offset");
  if(off) off.addEventListener("change", ()=>{ putSettings({offset: Math.max(-30,Math.min(30,parseInt(off.value,10)||0))}); renderAll(); });
}

/* =============================================================
   シート（下から出る画面）
   ============================================================= */
let sheetCtx = null, ps = null, pe = null;
function showSheet(h){ $("#sheet").innerHTML = h; $("#backdrop").hidden = false; $("#sheet").scrollTop = 0; }
function closeSheet(){ $("#backdrop").hidden = true; sheetCtx = null; ps = null; pe = null; }
const warnHtml = ws => ws.map(w=>`<div class="warn ${w.level==="red"?"":w.level}"><span class="wt">${esc(w.title)}</span>${w.text}</div>`).join("");

/* ---------- やること（チェックリスト） ---------- */
function openTask(pid, tid, dueStr){
  const p = state.plantings.find(x=>x.id===pid); if(!p) return;
  const crop = cropById(p.cropId), task = crop.tasks.find(t=>t.id===tid); if(!task) return;
  const bed = bedOf(p), due = parseD(dueStr), n = diffD(due, today());
  const isH = task.kind==="harvest";
  const when = isH && task.trigger.repeat ? "収穫期" : n<0 ? (task.routine?"今週の見回り":`${jp(due)}・${-n}日 遅れ`) : n===0 ? `${jp(due)}・今日` : `${jp(due)}・${n}日後`;
  sheetCtx = {pid, tid, isH};
  const todays = isH ? state.logs.find(l=>l.plantingId===pid && l.type==="harvest" && l.date===fmtD(today())) : null;
  let h = `<h3>${esc(task.name)}</h3><div class="sheet-sub">${esc(bed.name)} 区画${slotNums(p)}／${esc(crop.name)}　${esc(when)}</div>`;
  if(task.note) h += `<div class="sheet-sub" style="margin-top:6px">${esc(task.note)}</div>`;
  if(task.trigger.stage) h += `<div class="sheet-sub" style="margin-top:6px">生育の目安：<b>${esc(task.trigger.stage)}</b>（日数は目安。現物を見て判断）</div>`;
  if(task.materials && task.materials.length) h += `<div class="label-s">使うもの</div><div class="chips" style="margin-top:6px">${task.materials.map(m=>`<span class="chip">${esc(m)}</span>`).join("")}</div>`;
  h += `<div class="label-s">手順</div><ul class="steps">${task.steps.map((s,i)=>`<li><input type="checkbox" id="st-${i}"><label for="st-${i}">${esc(s)}</label></li>`).join("")}</ul>`;
  if(task.caution) h += `<div class="warn"><span class="wt">つまずきポイント</span>${esc(task.caution)}</div>`;
  if(isH) h += `<div class="qty"><label for="q-in">収穫量</label><input type="number" id="q-in" min="0" inputmode="numeric" placeholder="0"><span class="unit">${esc(crop.unit)}</span></div>
    ${todays?`<div class="hint" style="margin-top:6px">今日はすでに ${todays.qty||0}${esc(crop.unit)} 記録済み。入力した分を足します。</div>`:""}`;
  h += `<div class="sheet-foot"><button class="btn" data-act="close">閉じる</button><button class="btn primary" data-act="done">${isH?"収穫を記録":"完了にする"}</button></div>`;
  showSheet(h);
}
function completeTask(){
  if(!sheetCtx) return;
  const {pid, tid, isH} = sheetCtx, d = fmtD(today());
  if(isH){
    const qty = parseInt(($("#q-in")||{}).value,10)||0;
    const ex = state.logs.find(l=>l.plantingId===pid && l.type==="harvest" && l.date===d);
    if(ex){ ex.qty = (ex.qty||0) + qty; putLog(ex); }
    else putLog({id:uid("l"), plantingId:pid, taskId:tid, date:d, type:"harvest", qty});
  }else{
    putLog({id:uid("l"), plantingId:pid, taskId:tid, date:d, type:"work"});
  }
  closeSheet(); renderAll();
  toast(isH?"収穫を記録しました":"完了にしました");
}

/* ---------- 空き区画 → 作物を選ぶ → 登録 ---------- */
function openCell(slot){
  const p = occupant(slot);
  if(p){ openPlanting(p.id); return; }
  ps = { anchor:slot, bed:slotBed(slot), cropId:null, slots:[slot], date:null, count:10 };
  renderPlantSheet();
}
function renderPlantSheet(){
  const bed = bedById(ps.bed);
  let h = "";
  if(!ps.cropId){
    const my = (state.settings.myCrops||[]).length ? state.settings.myCrops : DATA.crops.map(c=>c.id);
    const rows = my.map(id=>{
      const c = cropById(id); if(!c) return null;
      const w = windowInfo(c), slots = extendFrom(ps.anchor, needOf(id));
      const ws = checkPlanting(slots, id, defaultDate(c));
      const red = ws.some(x=>x.level==="red"), sun = ws.some(x=>x.title==="日照注意"), good = ws.some(x=>x.level==="good");
      const short = slots.length < needOf(id);
      return {c, w, red, sun, good, short, rank:(red?100:0)+(short?50:0)+(sun?20:0)+(w.inWindow?0:Math.min(w.n,365)/10+1)};
    }).filter(Boolean).sort((a,b)=>a.rank-b.rank);
    h = `<h3>${esc(bed.name)}・区画${slotIdx(ps.anchor)}に植える</h3>
      <div class="sheet-sub">${esc(bed.note)}。この区画での連作・日照・広さを判定して並べています。</div>
      <div class="croplist">${rows.map(r=>{
        const when = r.w.inWindow ? `<b class="now">適期中</b>` : r.w.n<=60 ? `<b>${r.w.n}日後</b>` : `${r.w.start.getMonth()+1}月〜`;
        const tags = [ r.red?`<span class="tag red">連作</span>`:"", r.sun?`<span class="tag amber">日照</span>`:"",
          r.short?`<span class="tag amber">狭い</span>`:"", r.good?`<span class="tag good">半日陰◎</span>`:"",
          needOf(r.c.id)>1&&!r.short?`<span class="tag">${esc(shareLabel(needOf(r.c.id)))}</span>`:"" ].join("");
        return `<button class="croprow${r.red?" ng":""}" data-act="ps-crop" data-c="${r.c.id}"><span class="crname">${esc(r.c.name)}</span><span class="crtags">${tags}</span><span class="crwhen">${when}</span></button>`;
      }).join("")}</div>
      <div class="sheet-foot"><button class="btn" data-act="close">閉じる</button></div>`;
  }else{
    const c = cropById(ps.cropId), need = needOf(ps.cropId);
    const ws = checkPlanting(ps.slots, ps.cropId, ps.date);
    if(ps.slots.length && ps.slots.length < need) ws.push({level:"amber", title:"区画が足りないかも", text:`${esc(c.name)}は${esc(shareLabel(need))}ほど場所を使います（${esc(c.start.spacing)}）。`});
    h = `<button class="linkback" data-act="ps-back">← 作物を選び直す</button>
      <h3>${esc(c.name)}を植える</h3>
      <div class="sheet-sub">${esc(bed.name)}／適期 ${esc(junLabel(c.start.window))}（${esc(c.start.action)}）／${esc(c.start.spacing)}</div>
      <div class="label-s">使う区画${need>1?`（目安 ${need}区画）`:""}</div>
      <div class="picker">${slotsOf(ps.bed).map(s=>{
        const o = occupant(s), oc = o ? cropById(o.cropId) : null, sel = ps.slots.includes(s);
        return `<button class="slot${sel?" sel":""}${oc?" occ":""}" data-act="ps-slot" data-s="${s}" aria-pressed="${sel}"${oc&&!sel?" disabled":""}>
          <span class="sidx">区画${slotIdx(s)}</span><span class="sname">${oc?esc(oc.name):sel?esc(c.name):"空き"}</span></button>`;
      }).join("")}</div>
      <div class="row2">
        <div class="field"><label for="ps-date">${esc(c.start.action)}日</label><input type="date" id="ps-date" value="${ps.date}"></div>
        <div class="field"><label for="ps-count">株数・本数</label><input type="number" id="ps-count" min="1" value="${ps.count}" inputmode="numeric"></div>
      </div>
      ${warnHtml(ws)}
      <div class="sheet-foot"><button class="btn" data-act="close">やめる</button>
        <button class="btn primary" data-act="ps-save"${ps.slots.length?"":" disabled"}>登録する</button></div>`;
  }
  $("#sheet").innerHTML = h; $("#backdrop").hidden = false;
  const di = $("#ps-date"); if(di) di.addEventListener("change", ()=>{ ps.date = di.value||ps.date; renderPlantSheet(); });
  const ci = $("#ps-count"); if(ci) ci.addEventListener("change", ()=>{ ps.count = parseInt(ci.value,10)||1; });
}
function savePlanting(){
  if(!ps || !ps.cropId || !ps.slots.length) return;
  const ci = $("#ps-count"); if(ci) ps.count = parseInt(ci.value,10)||1;
  const ws = checkPlanting(ps.slots, ps.cropId, ps.date).filter(w=>w.level!=="good");
  if(ws.length && !confirm(ws.map(w=>w.title).join("・")+"があります。このまま登録しますか？")) return;
  if(state.sample){ state.plantings = []; state.logs = []; state.sample = false; }
  const slots = ps.slots.slice().sort((a,b)=>slotIdx(a)-slotIdx(b));
  const pid = uid("p");
  putPlanting({id:pid, bedId:ps.bed, slots, cropId:ps.cropId, date:ps.date, count:ps.count, status:"active", memo:""});
  // もう植えた（まいた）日付で登録したなら、定植・播種の作業は済んでいる
  const st = cropById(ps.cropId).tasks.find(t=>t.trigger.type==="offset" && t.trigger.days===0);
  if(st && parseD(ps.date) <= today()) putLog({id:uid("l"), plantingId:pid, taskId:st.id, date:ps.date, type:"work"});
  closeSheet(); renderAll(); toast("登録しました");
}

/* ---------- 作付けの詳細 ---------- */
function openPlanting(pid){
  const p = state.plantings.find(x=>x.id===pid); if(!p) return;
  const c = cropById(p.cropId), bed = bedOf(p), t0 = today(), d = parseD(p.date);
  const future = d > t0, n = Math.abs(diffD(t0,d)), isDone = p.status==="done";
  const next = computeTasks().filter(x=>x.p.id===pid).slice(0,4);
  const logs = state.logs.filter(l=>l.plantingId===pid).sort((a,b)=>a.date<b.date?1:-1);
  const hs = logs.filter(l=>l.type==="harvest"), total = hs.reduce((s,l)=>s+(l.qty||0),0);
  ps = null;
  let h = `<h3>${esc(c.name)}</h3>
    <div class="sheet-sub">${esc(bed.name)} 区画${slotNums(p)}（${esc(shareLabel(p.slots.length))}）・${p.count}株</div>
    <div class="sheet-sub">${future?`${esc(c.start.action)}予定 ${jp(d)}（${n}日後）`:`${esc(c.start.action)} ${jp(d)}${isDone?"":`（${n}日目）`}`}
      ${isDone&&p.endDate?`〜 ${jp(parseD(p.endDate))} 終了`:""}${hs.length?`／収穫 ${hs.length}日・計<b>${total}${esc(c.unit)}</b>`:""}</div>
    ${isDone?`<div class="sheet-sub" style="margin-top:6px"><b>終了済み</b>（連作の履歴として残っています）</div>`:""}
    ${p.memo?`<div class="memo">${esc(p.memo)}</div>`:""}`;
  if(!isDone){
    h += `<div class="label-s">次のやること</div>`;
    h += next.length ? `<div class="stack" style="margin-top:8px">${next.map(x=>taskRow(x, x.kind==="normal"&&x.due<t0?"late":diffD(x.due,t0)<=6?"soon":"")).join("")}</div>`
                     : `<div class="empty">予定されている作業はありません。</div>`;
  }
  h += `<div class="label-s">記録（${logs.length}件）</div>`;
  h += logs.length ? `<div class="hist">${logs.map(histRow).join("")}</div>` : `<div class="empty">まだ記録がありません。</div>`;
  h += `<div class="sheet-foot">
      ${!isDone && !future && c.tasks.some(t=>t.kind==="harvest") ? `<button class="btn" data-act="quick-harvest" data-p="${p.id}">収穫を記録</button>`:""}
      ${isDone?`<button class="btn" data-act="reopen" data-p="${p.id}">作付けを再開</button>`:`<button class="btn ghost" data-act="finish" data-p="${p.id}">作付けを終了</button>`}
    </div>
    <div class="sheet-foot" style="margin-top:8px"><button class="btn" data-act="pe-open" data-p="${p.id}">修正・メモ・削除</button><button class="btn" data-act="close">閉じる</button></div>`;
  showSheet(h);
}

/* ---------- 作付けの修正 ---------- */
function openPlantingEdit(pid){
  const p = state.plantings.find(x=>x.id===pid); if(!p) return;
  pe = { pid, slots:p.slots.slice(), date:p.date, count:p.count, memo:p.memo||"" };
  renderPlantingEdit(true);
}
function renderPlantingEdit(top){
  const p = state.plantings.find(x=>x.id===pe.pid); if(!p) return;
  const c = cropById(p.cropId), bedId = slotBed(p.slots[0]), bed = bedById(bedId);
  const nLogs = state.logs.filter(l=>l.plantingId===p.id).length;
  const ws = checkPlanting(pe.slots, p.cropId, pe.date, p.id).filter(w=>w.level!=="good");
  const h = `<button class="linkback" data-act="planting" data-p="${p.id}">← 戻る</button>
    <h3>${esc(c.name)}を修正</h3><div class="sheet-sub">${esc(bed.name)}</div>
    <div class="label-s">区画</div>
    <div class="picker">${slotsOf(bedId).map(s=>{
      const o = occupant(s, p.id), oc = o ? cropById(o.cropId) : null, sel = pe.slots.includes(s);
      return `<button class="slot${sel?" sel":""}${oc?" occ":""}" data-act="pe-slot" data-s="${s}" aria-pressed="${sel}"${oc&&p.status!=="done"?" disabled":""}>
        <span class="sidx">区画${slotIdx(s)}</span><span class="sname">${oc?esc(oc.name):sel?esc(c.name):"空き"}</span></button>`;
    }).join("")}</div>
    <div class="row2">
      <div class="field"><label for="pe-date">${esc(c.start.action)}日</label><input type="date" id="pe-date" value="${pe.date}"></div>
      <div class="field"><label for="pe-count">株数・本数</label><input type="number" id="pe-count" min="1" value="${pe.count}" inputmode="numeric"></div>
    </div>
    <div class="field" style="margin-top:12px"><label for="pe-memo">メモ（品種・苗の購入先・気づいたこと）</label>
      <textarea id="pe-memo" placeholder="例：桃太郎。苗はコメリで4株">${esc(pe.memo)}</textarea></div>
    <div class="hint" style="margin-top:8px">${esc(c.start.action)}日を変えると、やることの日付がすべてずれます。</div>
    ${warnHtml(ws)}
    <div class="sheet-foot"><button class="btn" data-act="planting" data-p="${p.id}">やめる</button>
      <button class="btn primary" data-act="pe-save"${pe.slots.length?"":" disabled"}>保存</button></div>
    <div class="dangerzone">
      <div class="hint">登録そのものが間違いだった場合は削除します。記録${nLogs}件も一緒に消え、連作の履歴にも残りません。収穫を終えただけなら「作付けを終了」を使ってください。</div>
      <button class="btn danger wide" data-act="pe-del" data-p="${p.id}">この作付けを削除</button>
    </div>`;
  const keep = $("#sheet").scrollTop;
  $("#sheet").innerHTML = h; $("#backdrop").hidden = false;
  $("#sheet").scrollTop = top ? 0 : keep;
  const di = $("#pe-date"); if(di) di.addEventListener("change", ()=>{ pe.date = di.value||pe.date; syncPe(); renderPlantingEdit(); });
}
function syncPe(){
  const ci = $("#pe-count"); if(ci) pe.count = parseInt(ci.value,10)||1;
  const mi = $("#pe-memo"); if(mi) pe.memo = mi.value;
}

/* ---------- 記録の修正 ---------- */
function openLog(id){
  const l = state.logs.find(x=>x.id===id); if(!l) return;
  const p = state.plantings.find(x=>x.id===l.plantingId), c = p ? cropById(p.cropId) : null;
  const t = c ? c.tasks.find(x=>x.id===l.taskId) : null, isH = l.type==="harvest";
  showSheet(`<h3>${t?esc(t.name):"作業の記録"}</h3>
    <div class="sheet-sub">${c?esc(c.name):""}${p?`／${esc(bedOf(p).name)} 区画${slotNums(p)}`:""}</div>
    <div class="row2">
      <div class="field"><label for="lg-date">日付</label><input type="date" id="lg-date" value="${l.date}"></div>
      ${isH?`<div class="field"><label for="lg-qty">収穫量（${esc(c?c.unit:"")}）</label><input type="number" id="lg-qty" min="0" inputmode="numeric" value="${l.qty||0}"></div>`:""}
    </div>
    <div class="hint" style="margin-top:10px">${isH?"削除すると収穫の合計からも差し引かれます。":(l.type==="skip"?"見送りにした作業です。":"")+"削除すると、この作業は未完了に戻ってやることリストに再び出ます。"}</div>
    <div class="sheet-foot"><button class="btn danger" data-act="log-del" data-l="${l.id}">削除</button><button class="btn primary" data-act="log-save" data-l="${l.id}">保存</button></div>
    <div class="sheet-foot" style="margin-top:8px"><button class="btn" data-act="close">閉じる</button></div>`);
}

/* ---------- トースト（取り消し付き） ---------- */
let toastTimer = null;
function toast(msg, undo){
  let el = $("#toast");
  if(!el){ el = document.createElement("div"); el.id = "toast"; el.setAttribute("role","status"); document.body.appendChild(el); }
  el.innerHTML = `<span>${esc(msg)}</span>${undo?`<button data-act="undo">取り消す</button>`:""}`;
  el.className = "show";
  toast.undo = undo || null;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>{ el.className = ""; toast.undo = null; }, undo ? 7000 : 2200);
}

/* =============================================================
   操作
   ============================================================= */
document.addEventListener("click", e=>{
  const tab = e.target.closest('[role="tab"]');
  if(tab){ selectTab(tab.id); return; }
  const el = e.target.closest("[data-act]");
  if(!el){ if(e.target.id==="backdrop") closeSheet(); return; }
  handle(el.dataset.act, el);
});
document.addEventListener("keydown", e=>{
  if(e.key==="Escape" && !$("#backdrop").hidden) closeSheet();
  if((e.key==="Enter"||e.key===" ") && e.target.matches && e.target.matches("g.g-row")){ e.preventDefault(); handle("planting", e.target); }
});

async function handle(act, el){
  const d = el.dataset;
  const P = id => state.plantings.find(x=>x.id===id);
  switch(act){
    case "open": openTask(d.p, d.t, d.d); break;
    case "close": closeSheet(); break;
    case "done": completeTask(); break;
    case "undo": if(toast.undo){ toast.undo(); toast.undo = null; $("#toast").className = ""; } break;
    case "go-settings": selectTab("tab-set"); break;

    case "round-done": {
      const t0 = today();
      const items = computeTasks().filter(x=>x.kind==="routine" && diffD(x.due,t0)<=6);
      const ids = items.map(x=>{ const l = {id:uid("l"), plantingId:x.p.id, taskId:x.task.id, date:fmtD(t0), type:"work"}; putLog(l); return l.id; });
      renderAll();
      toast(`見回り${ids.length}件を記録しました`, ()=>{ ids.forEach(removeLog); renderAll(); });
      break;
    }
    case "skip-stale": {
      const t0 = today();
      const items = computeTasks().filter(x=>x.kind==="normal" && !x.task.trigger.repeat && diffD(t0,x.due) > 21);
      const ids = items.map(x=>{ const l = {id:uid("l"), plantingId:x.p.id, taskId:x.task.id, date:fmtD(t0), type:"skip"}; putLog(l); return l.id; });
      renderAll();
      toast(`${ids.length}件を見送りにしました`, ()=>{ ids.forEach(removeLog); renderAll(); });
      break;
    }
    case "clear-sample":
      state.plantings = []; state.logs = []; state.sample = false; save(); renderAll(); break;

    case "finish": {
      const p = P(d.p);
      if(p && confirm(`${cropById(p.cropId).name}の作付けを終了します。区画が空き、やることからも消えます（記録と連作の履歴は残ります）。`)){
        p.status = "done"; p.endDate = fmtD(today()); putPlanting(p); closeSheet(); renderAll(); toast("作付けを終了しました");
      }
      break;
    }
    case "reopen": {
      const p = P(d.p); if(!p) break;
      const clash = p.slots.filter(s=>occupant(s, p.id));
      if(clash.length){ alert(`区画${clash.map(slotIdx).join("・")}は別の作物が使っています。先に「修正」で区画を変えてください。`); break; }
      p.status = "active"; delete p.endDate; putPlanting(p); renderAll(); openPlanting(p.id); break;
    }
    case "toggle-crop": {
      const my = state.settings.myCrops || [];
      putSettings({ myCrops: my.includes(d.c) ? my.filter(x=>x!==d.c) : my.concat([d.c]), myCropsTouched:true });
      renderField(); break;
    }
    case "cell": openCell(d.s); break;
    case "planting": openPlanting(d.p); break;
    case "ps-crop":
      ps.cropId = d.c; ps.slots = extendFrom(ps.anchor, needOf(d.c)); ps.date = defaultDate(cropById(d.c));
      renderPlantSheet(); $("#sheet").scrollTop = 0; break;
    case "ps-back": ps.cropId = null; ps.slots = [ps.anchor]; ps.date = null; renderPlantSheet(); break;
    case "ps-slot": ps.slots = ps.slots.includes(d.s) ? ps.slots.filter(x=>x!==d.s) : ps.slots.concat([d.s]); renderPlantSheet(); break;
    case "ps-save": savePlanting(); break;
    case "auto-place": {
      const slots = autoPlace(d.c);
      if(!slots){ alert("空いている区画がありません。どれかの作付けを終了してください。"); break; }
      ps = { anchor:slots[0], bed:slotBed(slots[0]), cropId:d.c, slots, date:defaultDate(cropById(d.c)), count:10 };
      renderPlantSheet(); $("#sheet").scrollTop = 0; break;
    }
    case "quick-harvest": {
      const p = P(d.p); if(!p) break;
      const ht = cropById(p.cropId).tasks.find(t=>t.kind==="harvest");
      if(ht) openTask(p.id, ht.id, fmtD(today()));
      break;
    }
    case "log": openLog(d.l); break;
    case "log-save": {
      const l = state.logs.find(x=>x.id===d.l); if(!l) break;
      const nd = ($("#lg-date")||{}).value; if(nd) l.date = nd;
      const q = $("#lg-qty"); if(q) l.qty = parseInt(q.value,10)||0;
      putLog(l); mergeSameDayHarvests(true); save(); closeSheet(); renderAll(); toast("保存しました"); break;
    }
    case "log-del": {
      const l = state.logs.find(x=>x.id===d.l); if(!l) break;
      const copy = Object.assign({}, l);
      removeLog(l.id); closeSheet(); renderAll();
      toast("記録を削除しました", ()=>{ putLog(copy); renderAll(); });
      break;
    }
    case "pe-open": openPlantingEdit(d.p); break;
    case "pe-slot": syncPe(); pe.slots = pe.slots.includes(d.s) ? pe.slots.filter(x=>x!==d.s) : pe.slots.concat([d.s]); renderPlantingEdit(); break;
    case "pe-save": {
      const p = P(pe.pid); if(!p || !pe.slots.length) break;
      syncPe();
      const ws = checkPlanting(pe.slots, p.cropId, pe.date, p.id).filter(w=>w.level!=="good");
      if(ws.length && !confirm(ws.map(w=>w.title).join("・")+"があります。このまま保存しますか？")) break;
      p.slots = pe.slots.slice().sort((a,b)=>slotIdx(a)-slotIdx(b)); p.bedId = slotBed(p.slots[0]);
      p.date = pe.date; p.count = pe.count; p.memo = pe.memo.trim();
      putPlanting(p); renderAll(); openPlanting(p.id); toast("保存しました"); break;
    }
    case "pe-del": {
      const p = P(d.p); if(!p) break;
      const n = state.logs.filter(l=>l.plantingId===p.id).length;
      if(!confirm(`${cropById(p.cropId).name}の作付けを削除します。記録${n}件も消え、元に戻せません。`)) break;
      removePlanting(p.id); closeSheet(); renderAll(); toast("削除しました"); break;
    }
    case "log-crop": logCrop = d.c || ""; renderLog(); break;
    case "apply-off": {
      const co = Object.assign({}, state.settings.cropOffset||{}); co[d.c] = parseInt(d.v,10)||0;
      putSettings({cropOffset:co}); renderAll(); toast(`${cropById(d.c).name}の補正を${co[d.c]>0?"+":""}${co[d.c]}日にしました`); break;
    }
    case "reset-off": {
      const co = Object.assign({}, state.settings.cropOffset||{}); delete co[d.c];
      putSettings({cropOffset:co}); renderAll(); break;
    }

    /* ---- 同期 ---- */
    case "sync-connect": {
      const url = ($("#set-url").value||"").trim();
      if(url && !/^https:\/\/script\.google(usercontent)?\.com\//.test(url)){ alert("Apps Script のウェブアプリURL（https://script.google.com/macros/s/…/exec）を貼ってください。"); break; }
      state.sync.url = url; state.sync.lastErr = ""; save();
      if(!url){ renderSettings(); renderSyncDot(); break; }
      el.disabled = true; el.textContent = "確認中…";
      try{
        const dump = await getSheet("dump");
        const remote = (dump.plantings||[]).length + (dump.logs||[]).length;
        const local = state.plantings.length + state.logs.length;
        if(!remote){ queueEverything(); await flush(); toast("つながりました。記録をスプレッドシートに送りました"); }
        else if(!local){ applyDump(dump); toast(`スプレッドシートから${remote}件を読み込みました`); }
        else if(confirm(`スプレッドシートに記録が${remote}件あります。\nOK：スプレッドシートの内容をこの端末に読み込む（この端末の${local}件は置き換え）\nキャンセル：この端末の記録をスプレッドシートに送る`)){
          applyDump(dump); toast("スプレッドシートから読み込みました");
        }else{ queueEverything(); await flush(); toast("この端末の記録を送りました"); }
      }catch(err){
        state.sync.lastErr = "つながりません。URLとApps Scriptの公開設定（アクセス：全員）を確認してください";
        save();
      }
      renderAll(); break;
    }
    case "sync-now": await flush(); toast(state.sync.lastErr ? "送信できませんでした" : "同期しました"); break;
    case "sync-restore": {
      if(!confirm("スプレッドシートの記録でこの端末の内容を置き換えます。よろしいですか？")) break;
      try{ const dump = await getSheet("dump"); applyDump(dump); renderAll(); toast("復元しました"); }
      catch(err){ alert("スプレッドシートに接続できませんでした。電波とURLを確認してください。"); }
      break;
    }
  }
}

function selectTab(id){
  ["tab-week","tab-field","tab-log","tab-set"].forEach(t=>{
    const b = document.getElementById(t), on = t===id;
    b.setAttribute("aria-selected", on?"true":"false");
    document.getElementById(b.getAttribute("aria-controls")).hidden = !on;
  });
  if(id==="tab-log") drawGantt();
  window.scrollTo(0,0);
}
window.addEventListener("resize", ()=>{ if(!$("#panel-log").hidden) drawGantt(); });

/* =============================================================
   起動
   ============================================================= */
async function boot(){
  try{
    DATA = window.CROPS_DATA || await (await fetch("crops.json", {cache:"no-cache"})).json();
  }catch(e){
    document.querySelector("main").innerHTML = `<div class="warn" style="margin-top:20px">作物データ（crops.json）を読み込めませんでした。電波のある場所で開き直してください。</div>`;
    return;
  }
  load();
  const t0 = today();
  $("#todayLabel").textContent = `${t0.getFullYear()}年${t0.getMonth()+1}月${t0.getDate()}日（${"日月火水木金土"[t0.getDay()]}）`;
  renderAll();
  if(!PREVIEW){
    try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(e){}
    if("serviceWorker" in navigator && location.protocol==="https:"){
      navigator.serviceWorker.register("sw.js").catch(()=>{});
    }
    refreshFrost();
    scheduleFlush(800);
  }
}
boot();
