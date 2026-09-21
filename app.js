/* =============================================================
   畑ノート v4
   - 作物データ・地域の霜平年値は crops.json（GitHub上で直接編集できる）
   - 記録はこの端末に保存し、Googleスプレッドシートと双方向に同期
   ============================================================= */
"use strict";

const APP_VERSION = "4.3";
const PREVIEW = !!window.HATAKE_PREVIEW;      // claude.ai 上のプレビュー版
const STORE_KEY = "hatake-note-v4";
let DATA = null;

/* =============================================================
   ユーティリティ
   ============================================================= */
const $ = s => document.querySelector(s);
const esc = s => String(s==null?"":s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const MS = 86400000, YEAR = 365.25;
function today(){ const d = new Date(); d.setHours(0,0,0,0); return d; }
function parseD(s){ const [y,m,d] = String(s).slice(0,10).split("-").map(Number); return new Date(y, m-1, d); }
function fmtD(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function slash(d){ return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`; }
function addD(d,n){ const x = new Date(d); x.setDate(x.getDate()+n); return x; }
function diffD(a,b){ return Math.round((a-b)/MS); }
const maxD = (a,b) => a > b ? a : b, minD = (a,b) => a < b ? a : b;
function jp(d){ return (d.getMonth()+1)+"/"+d.getDate()+"("+"日月火水木金土"[d.getDay()]+")"; }
function uid(p){ return p + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function jun(code){ const m = parseInt(code,10), k = code.replace(/[0-9]/g,""); return { month:m, day: k==="上"?1 : k==="中"?11 : 21 }; }
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
/* 「2年7か月」「5か月」「12日」 */
function span(days){
  days = Math.max(0, Math.round(days));
  if(days < 31) return `${days}日`;
  const y = Math.floor(days / YEAR), m = Math.floor((days - y*YEAR) / 30.44);
  return y ? `${y}年${m?m+"か月":""}` : `${Math.max(1,m)}か月`;
}
function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function lsSet(k,v){ try{ localStorage.setItem(k,v); return true; }catch(e){ return false; } }

/* 表示（端末ごと・同期しない） */
const THEME_KEY = "hatake-theme";
let themeMem = null;   // 保存できない環境でも、開いている間は効く
function themeGet(){ const t = themeMem || lsGet(THEME_KEY); return t==="light"||t==="dark" ? t : "auto"; }
function applyTheme(t){
  const root = document.documentElement;
  if(t==="light"||t==="dark") root.setAttribute("data-theme", t); else root.removeAttribute("data-theme");
  const dark = t==="dark" || (t==="auto" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach(m=>{
    if(!m.dataset.orig) m.dataset.orig = m.getAttribute("content");
    m.setAttribute("content", t==="auto" ? m.dataset.orig : (dark ? "#14170f" : "#f1f3ed"));
  });
}
function setTheme(t){ themeMem = t; lsSet(THEME_KEY, t); applyTheme(t); }

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

/* =============================================================
   地域（霜の平年値）と季節
   ============================================================= */
const R = () => DATA.region;
function mdDate(md, year){ const [m,d] = md.split("-").map(Number); return new Date(year, m-1, d); }
function lastFrost(year){ return mdDate(R().lastFrost.md, year); }
/* 作付け後に最初に来る初霜 */
function firstFrostAfter(d){ const f = mdDate(R().firstFrost.md, d.getFullYear()); return f >= d ? f : mdDate(R().firstFrost.md, d.getFullYear()+1); }
function anchorDate(c, base){
  if(c.anchor==="lastFrost") return addD(lastFrost(base.getFullYear() + (c.year==="next"?1:0)), c.days||0);
  if(c.anchor==="firstFrost") return addD(firstFrostAfter(base), c.days||0);
  if(c.anchor==="md"){ let x = mdDate(c.md, base.getFullYear()); if(x < base) x = mdDate(c.md, base.getFullYear()+1); return addD(x, c.days||0); }
  return null;
}
const SEASONS = {spring:"春（3〜5月）", summer:"夏（6〜8月）", autumn:"秋（9〜11月）", winter:"冬（12〜2月）"};
function seasonOf(d){ const m = d.getMonth()+1; return m>=3&&m<=5 ? "spring" : m>=6&&m<=8 ? "summer" : m>=9&&m<=11 ? "autumn" : "winter"; }
/* 中間地の標準日にかける補正：季節ごと＋作物ごと */
function offFor(cropId, d){ const s = state.settings; return ((s.seasonOffset||{})[seasonOf(d)]|0) + ((s.cropOffset||{})[cropId]|0); }

/* =============================================================
   状態と保存
   ============================================================= */
let state = null;
function emptyState(){
  return {
    v:4, plantings:[], logs:[], frost:[],
    settings:{ seasonOffset:{spring:0,summer:0,autumn:0,winter:0}, cropOffset:{}, myCrops:null, myCropsTouched:false, _v:0 },
    sync:{ url:"", outbox:[], lastOk:0, lastPull:0, lastErr:"", changeSeq:0, conflicts:0 },
    asked:{}, sample:false
  };
}
function load(){
  state = emptyState();
  const raw = lsGet(STORE_KEY);
  if(raw){ try{ Object.assign(state, JSON.parse(raw)); }catch(e){} }
  else if(PREVIEW) seedSample();
  const base = emptyState();
  state.settings = Object.assign(base.settings, state.settings||{});
  state.settings.seasonOffset = Object.assign({spring:0,summer:0,autumn:0,winter:0}, state.settings.seasonOffset||{});
  state.sync = Object.assign(base.sync, state.sync||{});
  state.frost = state.frost || []; state.asked = state.asked || {};
  if(!Array.isArray(state.settings.myCrops) || !state.settings.myCropsTouched) state.settings.myCrops = DATA.crops.map(c=>c.id);
  state.plantings.forEach(p=>{ if(!p.bedId) p.bedId = slotBed(p.slots[0]); });
}
function save(){ lsSet(STORE_KEY, JSON.stringify(state)); }

function seedSample(){
  const y = today().getFullYear(), d = n => fmtD(addD(today(),n));
  state.plantings = [
    {id:"s1", bedId:"b", slots:["b1","b2"], cropId:"daikon",     date:d(-13),       count:24,  status:"active", memo:"品種：耐病総太り"},
    {id:"s2", bedId:"a", slots:["a1","a2"], cropId:"onion_late", date:`${y}-11-15`, count:120, status:"active"},
    {id:"s3", bedId:"a", slots:["a3","a4"], cropId:"tomato",     date:`${y}-05-10`, count:6,   status:"done", endDate:`${y}-09-05`, memo:"桃太郎。8月後半は裂果が多かった"},
    {id:"s4", bedId:"c", slots:["c1","c2"], cropId:"nasu",       date:`${y}-05-18`, count:4,   status:"active"},
    {id:"s5", bedId:"b", slots:["b3","b4"], cropId:"edamame",    date:`${y}-05-06`, count:20,  status:"done", endDate:`${y}-07-30`},
    {id:"s6", bedId:"a", slots:["a3","a4"], cropId:"tomato",     date:`${y-1}-05-12`, count:6, status:"done", endDate:`${y-1}-09-20`}
  ];
  const L = (pid,tid,dt,type,qty)=>({id:uid("l"), plantingId:pid, taskId:tid, date:dt, type, qty});
  const H = (pid,md,q)=>L(pid,"harvest",`${y}-${md}`,"harvest",q);
  state.logs = [
    L("s3","plant",`${y}-05-10`,"work"), L("s3","support",`${y}-05-20`,"work"),
    H("s3","07-08",6),H("s3","07-14",11),H("s3","07-22",18),H("s3","07-30",21),H("s3","08-05",23),H("s3","08-05",4),H("s3","08-14",17),H("s3","08-24",14),H("s3","09-02",8),
    L("s4","plant",`${y}-05-18`,"work"), L("s4","pruning",`${y}-06-08`,"work"), L("s4","first_fruit",`${y}-06-15`,"work"),
    H("s4","07-02",5),H("s4","07-12",9),H("s4","07-25",12),H("s4","08-08",10), L("s4","renewal",`${y}-08-10`,"work"), H("s4","09-10",7),
    L("s5","sow",`${y}-05-06`,"work"), H("s5","07-28",20),
    L("s1","sow",d(-13),"work"),
    L("s6","plant",`${y-1}-05-12`,"work"),
    ...[["07-15",8],["07-28",19],["08-10",25],["08-30",12]].map(([md,q])=>L("s6","harvest",`${y-1}-${md}`,"harvest",q))
  ];
  state.sample = true;
}

/* ---------- 変更はすべてここを通す（同期キューに積む） ---------- */
function touch(o){ o.updatedAt = Date.now(); return o; }
function putPlanting(p){
  touch(p);
  const i = state.plantings.findIndex(x=>x.id===p.id);
  if(i<0) state.plantings.push(p); else state.plantings[i] = p;
  state.sample = false; queueOp("plantings", p); save();
}
function removePlanting(id){
  const p = state.plantings.find(x=>x.id===id); if(!p) return;
  const logs = state.logs.filter(l=>l.plantingId===id);
  state.plantings = state.plantings.filter(x=>x.id!==id);
  state.logs = state.logs.filter(l=>l.plantingId!==id);
  queueOp("plantings", touch(p), true);
  logs.forEach(l=>queueOp("logs", touch(l), true));
  save();
}
function putLog(l){
  touch(l);
  const i = state.logs.findIndex(x=>x.id===l.id);
  if(i<0) state.logs.push(l); else state.logs[i] = l;
  state.sample = false; queueOp("logs", l); save();
}
function removeLog(id){
  const l = state.logs.find(x=>x.id===id); if(!l) return;
  state.logs = state.logs.filter(x=>x.id!==id);
  queueOp("logs", touch(l), true); save();
}
function putFrost(f){
  touch(f);
  const i = state.frost.findIndex(x=>x.id===f.id);
  if(i<0) state.frost.push(f); else state.frost[i] = f;
  queueOp("frost", f); save();
}
function removeFrost(id){
  const f = state.frost.find(x=>x.id===id); if(!f) return;
  state.frost = state.frost.filter(x=>x.id!==id);
  queueOp("frost", touch(f), true); save();
}
function putSettings(patch){
  Object.assign(state.settings, patch); touch(state.settings);
  queueOp("settings", state.settings); save();
}

/* =============================================================
   Googleスプレッドシート同期（双方向）
   - 送る：変更をキューに積み、元にした版(baseVersion)を添えて送る
   - 受ける：起動時などに全件を取得し、未送信の変更がない行はシートの内容を正とする
   - 競合：シートの版が進んでいたら、updatedAt の新しい方を残す
   ============================================================= */
let flushTimer = null, busy = false;
const TABLE_LIST = ["plantings","logs","frost","settings"];
const localRows = t => t==="settings" ? [state.settings] : state[t];

function rowFor(table, o, deleted){
  const meta = { updatedAt:o.updatedAt||Date.now(), deletedAt: deleted ? Date.now() : "" };
  if(table==="plantings"){
    const c = cropById(o.cropId);
    return Object.assign({ id:o.id, bedId:o.bedId, slots:(o.slots||[]).join(","), cropId:o.cropId, cropName:c?c.name:"",
      date:o.date, count:o.count||0, status:o.status, endDate:o.endDate||"", memo:o.memo||"" }, meta);
  }
  if(table==="logs"){
    const p = state.plantings.find(x=>x.id===o.plantingId);
    const c = p ? cropById(p.cropId) : null, t = c ? c.tasks.find(x=>x.id===o.taskId) : null;
    return Object.assign({ id:o.id, plantingId:o.plantingId, cropName:c?c.name:"", taskId:o.taskId,
      taskName: t ? t.name+(o.type==="skip"?"（見送り）":"") : "", date:o.date, type:o.type,
      qty:o.type==="harvest"?(o.qty||0):"", unit:o.type==="harvest"&&c?c.unit:"" }, meta);
  }
  if(table==="frost"){
    return Object.assign({ id:o.id, targetNight:o.targetNight, forecastCapturedAt:o.forecastCapturedAt||"",
      tmin:o.tmin, cloud:o.cloud, wind:o.wind, risk:o.risk, observed:o.observed||"" }, meta);
  }
  const s = state.settings;
  return Object.assign({ id:"settings", value:JSON.stringify({seasonOffset:s.seasonOffset, cropOffset:s.cropOffset, myCrops:s.myCrops, myCropsTouched:s.myCropsTouched}) }, meta);
}
function fromRow(table, r){
  const num = v => v===""||v==null ? 0 : Number(v);
  if(table==="plantings") return { id:String(r.id), bedId:String(r.bedId||slotBed(String(r.slots))), slots:String(r.slots||"").split(",").filter(Boolean),
    cropId:String(r.cropId), date:String(r.date).slice(0,10), count:num(r.count), status:String(r.status||"active"),
    endDate:r.endDate?String(r.endDate).slice(0,10):undefined, memo:r.memo?String(r.memo):"", updatedAt:num(r.updatedAt), _v:num(r.version) };
  if(table==="logs") return { id:String(r.id), plantingId:String(r.plantingId), taskId:String(r.taskId), date:String(r.date).slice(0,10),
    type:String(r.type||"work"), qty: String(r.type)==="harvest" ? num(r.qty) : undefined, updatedAt:num(r.updatedAt), _v:num(r.version) };
  if(table==="frost") return { id:String(r.id), targetNight:String(r.targetNight).slice(0,10), forecastCapturedAt:num(r.forecastCapturedAt),
    tmin:num(r.tmin), cloud:num(r.cloud), wind:num(r.wind), risk:String(r.risk), observed:String(r.observed||""), updatedAt:num(r.updatedAt), _v:num(r.version) };
  let v = {}; try{ v = JSON.parse(r.value); }catch(e){}
  return Object.assign({}, v, { updatedAt:num(r.updatedAt), _v:num(r.version) });
}
function applyRemote(table, r){
  const o = fromRow(table, r);
  if(table==="settings"){ Object.assign(state.settings, o); return; }
  if(table==="plantings" && !cropById(o.cropId)) return;
  const arr = state[table], i = arr.findIndex(x=>x.id===o.id);
  if(r.deletedAt){ if(i>=0) arr.splice(i,1); return; }
  if(i<0) arr.push(o); else arr[i] = o;
}

function queueOp(table, o, deleted){
  if(PREVIEW) return;
  const q = state.sync.outbox, id = table==="settings" ? "settings" : o.id;
  const prev = q.find(x=>x.table===table && x.id===id);
  const op = { table, id, baseVersion: prev ? prev.baseVersion : (o._v||0), row: rowFor(table, o, deleted) };
  if(prev) q.splice(q.indexOf(prev), 1, op); else q.push(op);
  scheduleFlush();
}
function scheduleFlush(ms){
  renderSyncDot();
  if(!state.sync.url) return;
  clearTimeout(flushTimer);
  flushTimer = setTimeout(()=>sync(false), ms==null?1500:ms);
}
async function post(payload){
  const res = await fetch(state.sync.url, { method:"POST", body:JSON.stringify(payload), redirect:"follow" });
  const j = await res.json(); if(!j.ok) throw new Error(j.error||"失敗"); return j;
}
async function dump(){
  const u = state.sync.url;
  const res = await fetch(u + (u.includes("?")?"&":"?") + "action=dump", { redirect:"follow" });
  const j = await res.json(); if(!j.ok) throw new Error(j.error||"失敗"); return j;
}
async function push(){
  let guard = 0;
  while(state.sync.outbox.length && guard++ < 10){
    const batch = state.sync.outbox.slice(0,200);
    const j = await post({ action:"apply", ops:batch.map(o=>({table:o.table, id:o.id, baseVersion:o.baseVersion, row:o.row})) });
    const byKey = {}; (j.results||[]).forEach(r=>byKey[r.table+"|"+r.id] = r);
    let requeue = false;
    batch.forEach(op=>{
      const r = byKey[op.table+"|"+op.id]; if(!r) return;
      const qi = state.sync.outbox.indexOf(op);
      if(r.status==="ok"){
        if(qi>=0) state.sync.outbox.splice(qi,1);
        const local = localRows(op.table).find(x=>(op.table==="settings"||x.id===op.id));
        if(local && !op.row.deletedAt) local._v = r.version;
        return;
      }
      // 競合：シート側が先に変わっていた
      state.sync.conflicts++;
      const cur = r.current;
      if(!cur){ if(qi>=0) state.sync.outbox.splice(qi,1); applyRemote(op.table, {id:op.id, deletedAt:1}); return; }  // シートで行ごと消された
      if((op.row.updatedAt||0) > (Number(cur.updatedAt)||0)){
        op.baseVersion = Number(cur.version)||0; requeue = true;                  // こちらが新しい → 版を合わせて送り直す
      }else{
        if(qi>=0) state.sync.outbox.splice(qi,1); applyRemote(op.table, cur);    // シートが新しい → シートを採用
      }
    });
    save();
    if(!requeue && state.sync.outbox.length && state.sync.outbox.every(o=>batch.includes(o))) break;
  }
}
async function pull(){
  const d = await dump();
  const pending = new Set(state.sync.outbox.map(o=>o.table+"|"+o.id));
  TABLE_LIST.forEach(t=>{
    const remote = d[t] || [], seen = new Set();
    remote.forEach(r=>{
      const id = String(r.id); seen.add(id);
      if(pending.has(t+"|"+id)) return;                      // 未送信の変更がある行は、送ってから決める
      const local = localRows(t).find(x=> t==="settings" || x.id===id);
      if(local && (local._v||0) >= (Number(r.version)||0) && !r.deletedAt) return;   // 変化なし
      applyRemote(t, r);
    });
    if(t==="settings") return;
    // シートにない行：同期済みなら（シートで手で消された）消す、未同期なら送る
    state[t].slice().forEach(x=>{
      if(seen.has(x.id) || pending.has(t+"|"+x.id)) return;
      if((x._v||0) > 0) state[t].splice(state[t].indexOf(x),1);
      else queueOp(t, x);
    });
  });
  if(!d.settings || !d.settings.length) queueOp("settings", state.settings);
  state.sync.changeSeq = d.changeSeq||0; state.sync.lastPull = Date.now();
  save();
}
/* 送ってから受ける（受けた結果で競合が片づく） */
async function sync(withPull){
  if(PREVIEW || busy || !state.sync.url){ renderSyncDot(); return; }
  if(navigator.onLine===false){ state.sync.lastErr = "オフライン"; renderSyncDot(); return; }
  busy = true;
  const before = state.sync.conflicts;
  try{
    await push();
    if(withPull){ await pull(); await push(); }
    state.sync.lastOk = Date.now(); state.sync.lastErr = "";
  }catch(e){
    state.sync.lastErr = "送受信できませんでした（" + (e.message||"通信エラー") + "）";
  }finally{
    busy = false; save();
    if(state.sync.conflicts > before) toast("別の端末やシートでの変更と重なったため、新しい方を残しました");
    renderAll();
  }
}
window.addEventListener("online", ()=>sync(true));
document.addEventListener("visibilitychange", ()=>{
  if(document.visibilityState!=="visible" || !state) return;
  if(Date.now() - state.sync.lastPull > 60000) sync(true); else scheduleFlush(300);
  refreshFrost();
});
setInterval(()=>{ if(state && state.sync.outbox.length) sync(false); }, 60000);

/* =============================================================
   作付けの期間（区画の予約）
   ============================================================= */
function logsFor(pid, tid){ return state.logs.filter(l=>l.plantingId===pid && l.taskId===tid).sort((a,b)=>a.date<b.date?-1:1); }

/* =============================================================
   開始作業（播種・定植）と栽培の起点
   - 登録＝計画。開始作業を「完了」にした日が、実際の栽培の起点
   - 予定日を過ぎても未実施なら、見込みは今日を起点に計算する
   ============================================================= */
const startTaskOf = c => c && c.tasks.find(t=>t.trigger.type==="offset" && t.trigger.days===0);
const isPrepTask  = t => t.trigger.type==="offset" && t.trigger.days < 0;
function actualStart(p){
  const st = startTaskOf(cropById(p.cropId)); if(!st) return null;
  const d = state.logs.filter(l=>l.plantingId===p.id && l.taskId===st.id).map(l=>l.date).sort()[0];
  return d ? parseD(d) : null;
}
const startPending = p => p.status!=="done" && !!startTaskOf(cropById(p.cropId)) && !actualStart(p);
function clockBase(p){
  if(p.id==="__cand") return parseD(p.date);
  const a = actualStart(p); if(a) return a;
  const d = parseD(p.date);
  return startPending(p) && d < today() ? today() : d;
}
/* 予定日から見て、もう過ぎてしまった準備作業（未記録のもの） */
function missedPrep(p){
  const c = cropById(p.cropId), t0 = today();
  const started = parseD(p.date) <= t0;   // 予定日が来たら、未記録の準備作業はすべて「始める前に確認」へ
  return c.tasks.filter(t=>{ if(!isPrepTask(t) || logsFor(p.id, t.id).length) return false;
    if(started) return true;
    const due = taskSchedule(p, c, t).first; return taskWindow(p, c, t, due).to < t0; });
}
/* =============================================================
   作業の種類と許容幅（週1〜2回しか畑に行けない前提）
   - 日付は締め切りではなく目安。種類ごとの初期値を task.timing で上書きできる
   - 期限（notAfter：霜・暦）は許容幅があっても超えない
   ============================================================= */
const DEFAULT_TIMING = {                        // アプリの初期値（出典なし）
  management:{ earlyDays:3, lateDays:7 },       // 間引き・追肥・土寄せ・誘引・整枝など
  harvest:   { earlyDays:3, lateDays:7 },       // 1回きりの収穫（繰り返しの収穫は「収穫期」で扱う）
  prep:      { earlyDays:3, lateDays:7 },       // 土づくり・畝立て
  deadline:  { earlyDays:7, lateDays:null },    // 期限つき：期限の日まで（null＝期限まで）
  start:     { earlyDays:0, lateDays:0 }        // 播種・定植（予定日を過ぎたら「開始待ち」）
};
function taskClass(crop, task){
  if(task===startTaskOf(crop)) return "start";
  if(isPrepTask(task)) return "prep";
  if(task.trigger.notAfter) return "deadline";
  if(task.kind==="harvest") return "harvest";
  return "management";
}
const urgencyOf = (crop, task) => task.urgency || (task.trigger.notAfter ? "high" : "normal");
function timingOf(crop, task){
  const cls = taskClass(crop, task), tm = Object.assign({cls}, DEFAULT_TIMING[cls], task.timing||{});
  // 急ぎの作業は、個別の指定がなければ許容幅を短くする（個別の timing があればそちらが優先）
  if(!task.timing && urgencyOf(crop, task)==="high" && tm.lateDays!=null) tm.lateDays = Math.min(tm.lateDays, 1);
  return tm;
}
/* 目安日 due の作業ができる期間 [from, to]（許容幅 ∩ 期限） */
function taskWindow(p, crop, task, due){
  const tm = timingOf(crop, task), t = task.trigger;
  const lim = t.notAfter ? anchorDate(t.notAfter, isPrepTask(task) ? parseD(p.date) : clockBase(p)) : null;
  let to = tm.lateDays==null ? (lim || addD(due, 7)) : addD(due, tm.lateDays);
  if(lim) to = minD(to, lim);
  return { from: addD(due, -tm.earlyDays), to, limit: lim, cls: tm.cls, urgency: urgencyOf(crop, task), stage: !!t.stage };
}
/* 遅れて始めたときの準備作業の扱い：doNow＝今からやる／noteOnly＝情報として見せるだけ（初期値）／skip＝出さない */
const lateMode = t => (t.lateStart && t.lateStart.mode) || "noteOnly";
const verbOf = c => /播|まき/.test(c.start.action) ? {now:"まく", past:"まいた"} : {now:"植える", past:"植えた"};

/* 作業1つの「最初の期日」と「繰り返しの終わり」。霜の制約もここでかける */
function taskSchedule(p, crop, task){
  const t = task.trigger, base = isPrepTask(task) ? parseD(p.date) : clockBase(p), OFF = offFor(crop.id, base);
  let first = t.type==="offset" ? addD(base, t.days + OFF) : addD(resolveCal(t.when, base), OFF);
  const raw = first;
  if(t.notBefore) first = maxD(first, anchorDate(t.notBefore, base));
  let end = null;
  if(t.repeat) end = t.type==="offset" ? addD(base, t.repeat.untilDays + OFF) : addD(first, t.repeat.untilDays);
  const limit = t.notAfter ? anchorDate(t.notAfter, base) : null;
  if(limit){ first = minD(first, limit); if(end) end = minD(end, limit); }
  if(crop.frostKilled && end) end = minD(end, firstFrostAfter(base));   // 初霜で枯れる作物は、繰り返しも初霜まで
  if(end && end < first) end = first;
  return { first, end, raw };
}
/* 作付けが区画を使う期間：準備作業の始まり〜終了（予定） */
function expectedEnd(p){
  if(p.status==="done") return p.endDate ? parseD(p.endDate) : lastLogDate(p) || parseD(p.date);
  const crop = cropById(p.cropId), base = clockBase(p);
  if(crop.perennialYears) return addD(base, Math.round(crop.perennialYears*YEAR));
  let e = base;
  crop.tasks.forEach(t=>{
    if(isPrepTask(t)) return;
    const s = taskSchedule(p, crop, t); e = maxD(e, s.end || s.first);
  });
  const ll = lastLogDate(p); if(ll) e = maxD(e, ll);
  return e;
}
function lastLogDate(p){ const ls = state.logs.filter(l=>l.plantingId===p.id); return ls.length ? parseD(ls.map(l=>l.date).sort().pop()) : null; }
function bookingStart(p){
  const crop = cropById(p.cropId), base = parseD(p.date);
  const prep = Math.min(0, ...crop.tasks.filter(t=>t.trigger.type==="offset").map(t=>t.trigger.days));
  return addD(base, prep);
}
/* 準備作業（土づくり等）にかかる日数：植え付けの何日前から区画を使うか */
function prepDays(c){ return -Math.min(0, ...c.tasks.filter(t=>t.trigger.type==="offset").map(t=>t.trigger.days)); }
/* 前の作付けが終わった後に植える場合、準備作業のぶんだけ後ろにずらした日から */
const earliestAfter = (c, after) => after ? addD(after, prepDays(c)) : null;
function interval(p){ return { from: bookingStart(p), to: expectedEnd(p) }; }
const overlaps = (a,b) => a.from <= b.to && b.from <= a.to;
/* その区画を使っている（使う予定の）作付けを、時期の早い順に */
function plantingsIn(slot, pred){ return state.plantings.filter(p=>(p.slots||[]).includes(slot) && (!pred||pred(p))).sort((a,b)=>a.date<b.date?-1:1); }
/* 今日の時点で区画にいる作付け（なければ次の予定） */
function occupantNow(slot){
  const t0 = today();
  const act = plantingsIn(slot, p=>p.status!=="done" && expectedEnd(p) >= t0);
  return { now: act.find(p=>bookingStart(p) <= t0) || null, next: act.filter(p=>bookingStart(p) > t0) };
}

/* =============================================================
   やることの計算
   ============================================================= */
function computeTasks(){
  const t0 = today(), out = [];
  state.plantings.filter(p=>p.status!=="done").forEach(p=>{
    const crop = cropById(p.cropId); if(!crop) return;
    const plan = parseD(p.date), st = startTaskOf(crop), pending = startPending(p);
    const gated = pending && plan <= t0;          // 予定日になっても開始作業が未実施 → 後続は出さない
    crop.tasks.forEach(task=>{
      const t = task.trigger;
      if(isPrepTask(task)){
        if(!pending || plan <= t0 || logsFor(p.id, task.id).length) return;
        const { first } = taskSchedule(p, crop, task), w = taskWindow(p, crop, task, first);
        if(w.to < t0) return;                       // 許容幅も過ぎた準備作業は、遅れにせず開始前チェックへ
        out.push(Object.assign({ p, crop, task, due:first, end:null, kind:"normal", frostBound:false, doneCount:0 }, w));
        return;
      }
      if(task===st){
        if(!pending) return;
        out.push({ p, crop, task, due:plan, end:null, kind: plan < t0 ? "pending" : "normal", frostBound:false, doneCount:0, missed:missedPrep(p).length });
        return;
      }
      if(gated) return;
      const { first, end } = taskSchedule(p, crop, task);
      const done = logsFor(p.id, task.id);
      let due;
      if(t.repeat){
        due = done.length ? addD(parseD(done[done.length-1].date), t.repeat.everyDays) : first;
        if(due < first) due = first;
        if(due < t0){ const k = Math.floor(diffD(t0, due) / t.repeat.everyDays); due = addD(due, k*t.repeat.everyDays); }
        if(due > end) return;
      }else{
        if(done.length) return;
        due = first;
      }
      const isH = task.kind==="harvest";
      const kind = task.routine ? "routine" : (isH && t.repeat && (done.length || due <= t0)) ? "season" : "normal";
      const frostBound = !!(t.notAfter || (crop.frostKilled && t.repeat));
      out.push(Object.assign({ p, crop, task, due, end, kind, frostBound, doneCount:done.length }, taskWindow(p, crop, task, due)));
    });
  });
  out.sort((a,b)=> a.due - b.due || a.p.id.localeCompare(b.p.id));
  return out;
}

/* 区画の予定の重なり（開始が遅れて終わりの見込みが後ろにずれた場合など） */
function bookingConflicts(){
  const act = state.plantings.filter(p=>p.status!=="done"), out = [];
  for(let i=0;i<act.length;i++) for(let j=i+1;j<act.length;j++){
    const a = act[i], b = act[j], shared = a.slots.filter(s=>b.slots.includes(s));
    if(shared.length && overlaps(interval(a), interval(b))) out.push({ a, b, shared });
  }
  return out;
}

/* =============================================================
   適期（中間地の暦 ＋ 季節・作物の補正 ＋ 霜の制約）
   from 以降で最初の適期を返す
   ============================================================= */
function windowFor(c, y){
  const s0 = jun(c.start.window[0]);
  let start = new Date(y, s0.month-1, s0.day), end = junEndDate(c.start.window[1], y);
  if(end < start) end = junEndDate(c.start.window[1], y+1);
  let lateEnd = null;
  if(c.start.lateUntil){ lateEnd = junEndDate(c.start.lateUntil, end.getFullYear()); if(lateEnd < end) lateEnd = junEndDate(c.start.lateUntil, end.getFullYear()+1); }
  const off = offFor(c.id, start);
  start = addD(start, off); end = addD(end, off); lateEnd = lateEnd ? addD(lateEnd, off) : end;
  let frost = null;
  if(c.start.notBefore){
    const nb = anchorDate(c.start.notBefore, new Date(y,0,1));
    if(nb > start){ const len = diffD(end,start), ll = diffD(lateEnd,end); frost = nb; start = nb; if(end < start){ end = addD(start, len); lateEnd = addD(end, ll); } }
  }
  return { start, end, lateEnd, frost };
}
/* 作付けの時期の状態（全画面がこれを使う）
   optimal＝適期中／late＝適期は過ぎたが遅めでも始められる／upcoming＝次の適期まで60日以内／offSeason＝今季は非推奨 */
function seasonStatus(c, at){
  const d = at || today();
  const ws = [-1,0,1].map(k=>windowFor(c, d.getFullYear()+k));
  const cur = ws.find(w=>w.start <= d && d <= w.lateEnd);
  const next = ws.find(w=>w.start > d) || null;
  if(cur){
    const optimal = d <= cur.end;
    return { state: optimal ? "optimal" : "late", win:cur, next, daysLate: optimal ? 0 : diffD(d, cur.end), left: diffD(optimal ? cur.end : cur.lateEnd, d) };
  }
  const n = next ? diffD(next.start, d) : Infinity;
  return { state: n <= 60 ? "upcoming" : "offSeason", win:null, next, daysToNext:n };
}
/* 登録画面の初期日付：適期中・遅めなら今日（from）、それ以外は次の適期の初日 */
function defaultDate(c, from){
  const d = from || today(), s = seasonStatus(c, d);
  return fmtD(s.state==="optimal" || s.state==="late" || !s.next ? d : s.next.start);
}
function upcomingWindows(days){
  const order = {optimal:0, late:1, upcoming:2};
  return (state.settings.myCrops||[]).map(cropById).filter(Boolean)
    .filter(c=>!state.plantings.some(p=>p.status!=="done" && p.cropId===c.id))
    .map(c=>({crop:c, s:seasonStatus(c)}))
    .filter(x=>x.s.state!=="offSeason" && (x.s.state!=="upcoming" || x.s.daysToNext <= days))
    .sort((a,b)=> order[a.s.state]-order[b.s.state] || (a.s.daysToNext||0)-(b.s.daysToNext||0));
}
function statusChip(s){
  if(s.state==="optimal") return `<b class="now">適期中</b>`;
  if(s.state==="late") return `<b class="late">遅め</b>`;
  if(s.state==="upcoming") return `<b>${s.daysToNext}日後</b>`;
  const n = s.next && s.next.start;
  return `<span class="off">今季非推奨</span>${n?` ${n.getFullYear()!==today().getFullYear()?String(n.getFullYear()).slice(2)+"/":""}${n.getMonth()+1}月〜`:""}`;
}

/* =============================================================
   検査：区画の重複（期間）・連作（区画ごと、前後両方向）・日照・霜
   ============================================================= */
function rotationFor(c){ return c.rotation || (DATA.families[c.family]||{}).rotation || {minYears:0, maxYears:0}; }
/* 候補 S〜E と、同じ区画の作付け S2〜E2 を比べる */
function rotationCheck(slots, cropId, dateStr, ignoreId){
  const crop = cropById(cropId);
  const cand = { id:"__cand", cropId, date:dateStr, slots, status:"active" };
  const S = parseD(dateStr), E = expectedEnd(cand);
  const perSlot = [];
  slots.forEach(s=>{
    let worst = null;
    plantingsIn(s, p=>p.id!==ignoreId).forEach(p=>{
      const c2 = cropById(p.cropId); if(!c2 || c2.family!==crop.family) return;
      const S2 = clockBase(p), E2 = expectedEnd(p);
      let gap, rule, dir;
      if(E2 < S){ gap = diffD(S, E2); rule = rotationFor(crop); dir = "past"; }
      else if(E < S2){ gap = diffD(S2, E); rule = rotationFor(c2); dir = "future"; }
      else return;                                            // 期間が重なる → 区画の重複として別に扱う
      const y = gap / YEAR;
      const level = y < rule.minYears ? 2 : y < rule.maxYears ? 1 : 0;
      if(!level) return;
      const hit = { slot:s, p, c2, S2, E2, gap, rule, dir, level };
      if(!worst || hit.level > worst.level || (hit.level===worst.level && hit.gap < worst.gap)) worst = hit;
    });
    if(worst) perSlot.push(worst);
  });
  return perSlot;
}
function rotationText(h){
  const r = h.rule, need = y => Math.max(0, Math.round(y*YEAR) - h.gap);
  const lines = [];
  if(h.dir==="past") lines.push(`区画${slotIdx(h.slot)}：前作 <b>${esc(h.c2.name)}</b> ${h.p.status==="done"?"終了":"終了予定"} ${slash(h.E2)}`);
  else lines.push(`区画${slotIdx(h.slot)}：後作 <b>${esc(h.c2.name)}</b>（${slash(h.S2)} 予定）`);
  lines.push(`${h.dir==="past"?"経過":"間隔"} ${span(h.gap)}`);
  if(h.level===2) lines.push(`最低目安${r.minYears}年まであと${span(need(r.minYears))}`);
  else lines.push(`最低目安はクリア／十分な間隔${r.maxYears}年まであと${span(need(r.maxYears))}`);
  return lines.join("　");
}
function checkPlanting(slots, cropId, dateStr, ignoreId){
  const out = [], crop = cropById(cropId);
  if(!crop || !slots || !slots.length || !dateStr) return out;
  const bed = bedById(slotBed(slots[0])), d = parseD(dateStr);
  const cand = interval({ id:"__cand", cropId, date:dateStr, slots, status:"active" });

  /* 区画の重複（期間が重なる） */
  const clash = [];
  slots.forEach(s=> plantingsIn(s, p=>p.id!==ignoreId).forEach(p=>{
    const iv = interval(p); if(overlaps(cand, iv)) clash.push({s, p, iv});
  }));
  if(clash.length){
    out.push({level:"error", title:"区画が使用中です",
      text: clash.map(x=>`区画${slotIdx(x.s)}は、その時期 <b>${esc(cropById(x.p.cropId).name)}</b>（${jp(x.iv.from)}〜${jp(x.iv.to)}${x.p.status==="done"?"":"予定"}）が使っています`).join("<br>")
        + "<br>日付をずらすか、別の区画を選んでください。"});
  }
  /* 連作（最も厳しい区画を全体の判定に） */
  const rot = rotationCheck(slots, cropId, dateStr, ignoreId);
  if(rot.length){
    const worst = Math.max(...rot.map(h=>h.level)), r = rot[0].rule;
    out.push({level: worst===2 ? "red" : "amber", title: worst===2 ? "連作リスク高" : "連作：推奨間隔にはやや短い",
      text: rot.map(rotationText).join("<br>") +
        `<br><span class="wsub">${esc(crop.family)}の推奨間隔 ${r.minYears===r.maxYears?`${r.minYears}年`:`${r.minYears}〜${r.maxYears}年`}（${esc((crop.rotation||{}).source||"科の既定値")}）${crop.rotation&&crop.rotation.note?"。"+esc(crop.rotation.note):""}</span>`});
  }
  /* 時期の状態（遅めは注意ではなく案内） */
  const ss = seasonStatus(crop, d);
  if(ss.state==="late") out.push({level:"info", title:"適期を少し過ぎています",
    text:`適期は${jp(ss.win.end)}まで。${jp(ss.win.lateEnd)}までは遅めでも始められます。${esc(crop.start.lateNote||"")}<br><span class="wsub">${esc(crop.start.lateSource||"")}</span>`});
  if(ss.state==="offSeason" || ss.state==="upcoming") out.push({level:"amber", title:"今季の適期外です",
    text:`この時期の${esc(crop.start.action)}は勧められていません。${ss.next?`次の適期は${jp(ss.next.start)}〜です。`:""}`});
  /* 生育期間：霜の期限までに収穫が始まらない見込み（遅れて始めた場合も無視しない） */
  const ht = crop.tasks.find(t=>t.kind==="harvest");
  if(ht){
    const hs = taskSchedule({ id:"__cand", cropId, date:dateStr, slots, status:"active" }, crop, ht);
    const ff = firstFrostAfter(d);
    if(crop.frostKilled && hs.raw > ff) out.push({level:"red", title:"生育期間が足りない見込み",
      text:`収穫が始まる見込み（${jp(hs.raw)}）が、平年の初霜（${jp(ff)}）より後です。霜で枯れる前に収穫できない可能性が高いです。`});
    if(ht.trigger.notAfter){ const lim = anchorDate(ht.trigger.notAfter, d);
      if(hs.raw > lim) out.push({level:"red", title:"生育期間が足りない見込み",
        text:`収穫の目安（${jp(hs.raw)}）が、霜の前の期限（${jp(lim)}）より後です。十分に育つ前に掘り上げることになりそうです。`}); }
  }
  /* 遅霜：平年の終霜からの安全幅より前 */
  if(crop.start.notBefore){
    const nb = anchorDate(crop.start.notBefore, new Date(d.getFullYear(),0,1));
    if(d < nb) out.push({level:"amber", title:"遅霜の心配", text:`平年の終霜（${jp(lastFrost(d.getFullYear()))}）から${crop.start.notBefore.days}日たつ${jp(nb)}より前です。${esc(crop.name)}は霜に弱いので、遅霜に注意してください。`});
  }
  if(crop.winterSunRequired && bed.winterSun==="half")
    out.push({level:"amber", title:"日照注意", text:`${esc(bed.name)}は${esc(bed.note)}。${esc(crop.winterSunNote||"")}日当たりの良い畝を検討してください。`});
  if(crop.shadeOk && bed.winterSun==="half")
    out.push({level:"good", title:"この畝に向いています", text:`${esc(crop.name)}は半日陰でも育ちます。${esc(bed.name)}を使えば、日当たりの良い畝を他の作物に空けられます。`});
  return out;
}
const blocking = ws => ws.some(w=>w.level==="error");
function slotFree(s, dateStr, cropId, ignoreId){
  const cand = interval({ id:"__cand", cropId, date:dateStr, slots:[s], status:"active" });
  return !plantingsIn(s, p=>p.id!==ignoreId).some(p=>overlaps(cand, interval(p)));
}
function extendFrom(anchor, need, dateStr, cropId){
  const bed = slotBed(anchor), i0 = slotIdx(anchor);
  const free = i => i>=1 && i<=DIV && slotFree(bed+i, dateStr, cropId);
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
      if(slots.some(s=>!slotFree(s, date, cropId))) continue;
      const ws = checkPlanting(slots, cropId, date);
      if(!ws.some(w=>w.level!=="good")) return {slots, date};
      if(!fallback && !blocking(ws)) fallback = {slots, date};
    }
  }
  return fallback;
}

/* =============================================================
   霜リスク（Open-Meteo・無料・キー不要）
   判定の目安は暫定。「霜が降りた/降りなかった」の記録がたまったら見直す
   ============================================================= */
let nights = null;   // [{date, tmin, cloud, wind, risk, reason}]
function judge(tmin, cloud, wind){
  const clear = cloud <= 30, calm = wind <= 2;
  let risk = "low";
  if(tmin <= 1 || (tmin <= 3 && clear && calm)) risk = "high";
  else if(tmin <= 3 || (tmin <= 5 && clear && calm)) risk = "mid";
  const why = clear && calm ? "晴れて風が弱く、放射冷却で地面近くは予報気温よりさらに冷えやすい夜です。"
            : clear ? "晴れていますが風があるため、冷え込みはやや和らぎそうです。"
            : calm ? "風は弱いものの雲が多く、冷え込みはやや和らぎそうです。"
            : "雲と風があり、冷え込みはやや和らぎそうです。";
  return { risk, reason:`最低${tmin.toFixed(1)}℃の予報。${why}` };
}
function nightsFrom(j){
  const h = j.hourly || {}, time = h.time || [];
  const at = {}; time.forEach((t,i)=>at[t] = i);
  const out = [], t0 = today();
  for(let k=0;k<7;k++){
    const D = addD(t0,k), N = addD(D,1), ds = fmtD(D), ns = fmtD(N);
    const temps = [], clouds = [], winds = [];
    for(let hr=18; hr<24; hr++){ const i = at[`${ds}T${String(hr).padStart(2,"0")}:00`]; if(i!=null) temps.push(h.temperature_2m[i]); }
    for(let hr=0; hr<=8; hr++){
      const i = at[`${ns}T${String(hr).padStart(2,"0")}:00`]; if(i==null) continue;
      temps.push(h.temperature_2m[i]);
      if(hr<=6){ clouds.push(h.cloud_cover[i]); winds.push(h.wind_speed_10m[i]); }
    }
    const ok = a => a.filter(v=>v!=null);
    if(!ok(temps).length || !ok(clouds).length) continue;
    const avg = a => ok(a).reduce((s,v)=>s+v,0)/ok(a).length;
    const tmin = Math.min(...ok(temps)), cloud = Math.round(avg(clouds)), wind = Math.round(avg(winds)*10)/10;
    out.push(Object.assign({ date:ds, tmin:Math.round(tmin*10)/10, cloud, wind }, judge(tmin, cloud, wind)));
  }
  return out;
}
async function refreshFrost(force){
  if(PREVIEW) return;
  let cache = null; try{ cache = JSON.parse(lsGet("hatake-nights")||"null"); }catch(e){}
  if(!force && cache && Date.now()-cache.at < 3*3600*1000){ nights = cache.nights; snapshotTonight(); renderWeek(); return; }
  try{
    const P = R().forecastPoint;
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${P.lat}&longitude=${P.lon}&hourly=temperature_2m,cloud_cover,wind_speed_10m&wind_speed_unit=ms&timezone=Asia%2FTokyo&forecast_days=8`;
    const j = await (await fetch(u)).json();
    nights = nightsFrom(j);
    lsSet("hatake-nights", JSON.stringify({at:Date.now(), nights}));
    snapshotTonight(); renderWeek();
  }catch(e){ /* 取れなければ表示しないだけ */ }
}
/* 今夜の予報を保存（21時までは最新で上書き、それ以降は固定） */
function snapshotTonight(){
  if(!nights) return;
  const t0 = fmtD(today()), n = nights.find(x=>x.date===t0);
  const ex = state.frost.find(f=>f.id===t0);
  if(ex && (ex.observed || new Date().getHours() >= 21)) return;
  if(!n || n.risk==="low"){ if(ex && new Date().getHours() < 21) removeFrost(ex.id); return; }
  if(ex && ex.tmin===n.tmin && ex.cloud===n.cloud && ex.wind===n.wind && ex.risk===n.risk) return;
  putFrost(Object.assign(ex||{}, { id:t0, targetNight:t0, forecastCapturedAt:Date.now(), tmin:n.tmin, cloud:n.cloud, wind:n.wind, risk:n.risk, observed:"" }));
}
function frostTargets(){
  const t0 = today(), out = [];
  state.plantings.filter(p=>p.status!=="done" && actualStart(p)).forEach(p=>{
    const c = cropById(p.cropId); if(!c || !c.frost) return;
    const age = diffD(t0, actualStart(p));
    const text = (age<=21 && c.frost.spring) ? c.frost.spring : c.frost.autumn;
    if(text) out.push({p, c, text});
  });
  return out;
}
const RISK_LABEL = {high:"高", mid:"中", low:"低"};

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
    const base = actualStart(p) || parseD(p.date);
    const std = ht.trigger.type==="offset" ? addD(base, ht.trigger.days) : resolveCal(ht.trigger.when, base);
    const seasonOff = (state.settings.seasonOffset||{})[seasonOf(base)]|0;
    (by[c.id] = by[c.id] || {c, deltas:[]}).deltas.push(diffD(parseD(hs[0].date), std) - seasonOff);
  });
  return Object.values(by).map(x=>{
    const avg = x.deltas.reduce((s,v)=>s+v,0)/x.deltas.length;
    const suggest = Math.max(-30, Math.min(30, Math.round(avg)));
    const cur = (state.settings.cropOffset||{})[x.c.id]|0;
    return { crop:x.c, n:x.deltas.length, avg:Math.round(avg), suggest, cur };
  }).filter(s=>Math.abs(s.suggest - s.cur) >= 3);
}

/* =============================================================
   収穫の表示用まとめ（保存は1件ずつ、表示は同じ日・同じ作付けで合算）
   ============================================================= */
function groupedLogs(logs){
  const out = [], idx = {};
  logs.forEach(l=>{
    if(l.type!=="harvest"){ out.push({key:l.id, logs:[l], date:l.date, type:l.type, plantingId:l.plantingId, taskId:l.taskId, updatedAt:l.updatedAt||0}); return; }
    const k = l.plantingId+"|"+l.date;
    if(!idx[k]){ idx[k] = {key:k, logs:[], date:l.date, type:"harvest", plantingId:l.plantingId, taskId:l.taskId, qty:0, updatedAt:0}; out.push(idx[k]); }
    idx[k].logs.push(l); idx[k].qty += (l.qty||0); idx[k].updatedAt = Math.max(idx[k].updatedAt, l.updatedAt||0);
  });
  return out;
}

/* =============================================================
   描画
   ============================================================= */
function renderAll(){ if(!state) return; renderWeek(); renderField(); renderLog(); renderSettings(); renderSyncDot(); }

function whenLabel(due, lateOk){
  const n = diffD(due, today());
  if(n<0) return lateOk ? `<b>${-n}日 遅れ</b>${jp(due)}` : `<b>今日</b>${jp(today())}`;
  if(n===0) return `<b>今日</b>${jp(due)}`;
  if(n<=6)  return `<b>${n}日後</b>${jp(due)}`;
  return jp(due);
}
/* 目安日・許容幅・生育段階から、右端の表示を作る */
function dueLabel(x){
  const t0 = today(), n = diffD(x.due, t0);
  if(x.kind==="pending") return `<b>未実施</b>予定 ${jp(x.due)}`;
  if(!x.from) return whenLabel(x.due, x.kind==="normal");
  if(x.cls==="deadline"){
    if(t0 > x.to) return `<b>期限を${diffD(t0, x.to)}日過ぎ</b>${jp(x.to)}まで`;
    if(t0 < x.from) return `<b>${diffD(x.from,t0)}日後から</b>${jp(x.to)}までに`;
    return `<b>期限 ${jp(x.to)}</b>残り${Math.max(0,diffD(x.to,t0))}日`;
  }
  if(x.stage){
    if(t0 < x.from) return `<b>${n}日後</b>${jp(x.due)}ごろ〜`;
    if(t0 > x.to) return `<b class="chk">生育を確認</b>${jp(x.due)}ごろ〜`;
    return `<b>確認</b>${jp(x.due)}ごろ〜`;
  }
  if(t0 > x.to) return `<b>目安を${diffD(t0, x.to)}日過ぎ</b>${jp(x.due)}ごろ`;
  if(t0 >= x.from) return `<b>今が目安</b>〜${jp(x.to)}`;
  return `<b>${n}日後</b>${jp(x.due)}ごろ`;
}
function taskRow(x, cls){
  const bed = bedOf(x.p);
  const stage = x.task.trigger.stage ? (x.stage && x.to && today() > x.to ? `／予定の時期を過ぎています。今の生育を確認してください` : `／${esc(x.task.trigger.stage)}になったら`) : "";
  const fb = x.frostBound && x.task.trigger.notAfter ? `／霜の前に` : "";
  const mp = x.missed ? `／事前準備の確認 ${x.missed}件` : "";
  return `<button class="task ${cls||""}" data-act="open" data-p="${x.p.id}" data-t="${x.task.id}" data-d="${fmtD(x.due)}">
    <span class="bed">${bed?bed.id:"?"}</span>
    <span class="tbody"><span class="tname">${esc(x.task.name)}</span>
      <span class="tmeta">${esc(x.crop.name)}・区画${slotNums(x.p)}${stage}${fb}${mp}</span></span>
    <span class="tdue">${dueLabel(x)}</span>
  </button>`;
}

/* ---------- 今週 ---------- */
function renderWeek(){
  if(!state) return;
  const t0 = today(), all = computeTasks();
  const within = (x,n) => diffD(x.due,t0) <= n;
  const pending = all.filter(x=>x.kind==="pending");
  const routine = all.filter(x=>x.kind==="routine" && within(x,6));
  const season  = all.filter(x=>x.kind==="season");          // 収穫期に入っている作物は、次の収穫日にかかわらず全部
  const normal  = all.filter(x=>x.kind==="normal");
  const stale   = normal.filter(x=>!x.task.trigger.repeat && diffD(t0,x.due) > 21);
  const late    = normal.filter(x=>!stale.includes(x) && !x.stage && x.to && t0 > x.to);
  const week    = normal.filter(x=>!stale.includes(x) && !late.includes(x) && diffD(x.from||x.due, t0) <= 6);
  const later   = normal.filter(x=>!stale.includes(x) && !late.includes(x) && !week.includes(x) && within(x,60));

  let h = "";
  if(state.sample) h += `<div class="banner">サンプルの作付けで表示しています。<button class="btn" data-act="clear-sample">消して自分の畑を登録</button></div>`;

  /* 昨夜の霜：翌朝に1回だけ聞く */
  const yday = fmtD(addD(t0,-1)), ob = state.frost.find(f=>f.id===yday);
  if(ob && !ob.observed && !state.asked[yday]){
    h += `<div class="frost ask">
      <div class="frost-head"><span class="frost-title">昨夜の霜</span><span class="frost-when">${jp(parseD(yday))}の夜・霜リスク${RISK_LABEL[ob.risk]}の予報でした</span></div>
      <div class="frost-cond">最低 ${ob.tmin}℃／雲 ${ob.cloud}%／風 ${ob.wind}m/s</div>
      <div class="frost-q">今朝、畑に霜は降りていましたか？</div>
      <div class="btns"><button class="btn" data-act="frost-obs" data-v="yes">降りていた</button>
        <button class="btn" data-act="frost-obs" data-v="no">降りていなかった</button>
        <button class="btn ghost" data-act="frost-obs" data-v="">見ていない</button></div>
      <div class="frost-src">記録すると、この畑での霜の出やすさを後から見直せます。</div>
    </div>`;
  }

  /* 霜リスク */
  const risky = (nights||[]).find(n=>n.risk!=="low");
  const targets = risky ? frostTargets() : [];
  if(risky && targets.length){
    const fd = parseD(risky.date), n = diffD(fd, t0);
    h += `<div class="frost ${risky.risk}" role="alert">
      <div class="frost-head"><span class="frost-title">霜リスク：${RISK_LABEL[risky.risk]}</span>
        <span class="frost-when">${n===0?"今夜":n===1?"明日の夜":`${n}日後の夜`}　${jp(fd)}</span></div>
      <div class="frost-reason">${esc(risky.reason)}</div>
      <div class="frost-cond">最低 ${risky.tmin}℃／雲 ${risky.cloud}%／風 ${risky.wind}m/s（夜明け前の平均）</div>
      <ul>${targets.map(t=>`<li><b>${esc(t.c.name)}</b>（${esc(bedOf(t.p).name)} 区画${slotNums(t.p)}）${esc(t.text)}</li>`).join("")}</ul>
      <div class="frost-src">${esc(R().forecastPoint.name)}の予報（Open-Meteo）から判定。判定の目安は暫定です。</div>
    </div>`;
  }

  /* 区画の予定の重なり（開始が遅れて終わりがずれた等） */
  const clashes = bookingConflicts();
  if(clashes.length){
    h += `<div class="warn" style="margin-top:14px"><span class="wt">区画の予定が重なっています</span>
      ${clashes.map(k=>`${esc(bedOf(k.a).name)} 区画${k.shared.map(slotIdx).join("・")}：<b>${esc(cropById(k.a.cropId).name)}</b>（〜${jp(interval(k.a).to)}見込み）と <b>${esc(cropById(k.b.cropId).name)}</b>（${jp(interval(k.b).from)}〜）`).join("<br>")}
      <br><span class="wsub">開始が遅れると、終わりの見込みも後ろにずれます。どちらかの日付か区画を修正してください。</span>
      <div class="btns" style="margin-top:8px">${clashes.map(k=>`<button class="btn" data-act="planting" data-p="${k.b.id}">${esc(cropById(k.b.cropId).name)}を開く</button>`).join("")}</div></div>`;
  }
  /* 開始待ち：予定日を過ぎても播種・定植が未実施。後続の作業はまだ出さない */
  if(pending.length){
    h += `<div class="sect"><div class="sect-head"><h2>開始待ち</h2><span class="count">${pending.length}</span></div>
      <div class="stack">${pending.map(x=>taskRow(x,"late")).join("")}</div>
      <div class="hint" style="margin-top:6px">${esc(pending.map(x=>x.crop.name).join("・"))}は、${pending.length>1?"それぞれ":""}${esc(pending[0].task.name)}を完了した日から、その後の作業を計算します。</div></div>`;
  }
  if(routine.length){
    h += `<div class="sect"><div class="sect-head"><h2>見回り</h2><span class="count">${routine.length}</span></div>
      <div class="round"><div class="round-head"><span class="round-title">今週の見回り</span><span class="round-sub">名前をタップで手順</span></div>
        <div class="round-list">${routine.map(x=>`<button class="round-item" data-act="open" data-p="${x.p.id}" data-t="${x.task.id}" data-d="${fmtD(x.due)}">
          <span>${esc(x.task.name)}</span><span class="ri-crop">${esc(x.crop.name)}　${esc(bedOf(x.p).id)}-${slotNums(x.p)}</span></button>`).join("")}</div>
        ${doneDateHtml("round-date","見回った日")}
        <button class="btn primary wide" data-act="round-done">まとめて見回り済みにする</button></div></div>`;
  }
  if(season.length){
    h += `<div class="sect"><div class="sect-head"><h2>収穫期</h2><span class="count">${season.length}</span></div><div class="stack">
      ${season.map(x=>{
        const last = logsFor(x.p.id, x.task.id).slice(-1)[0], bed = bedOf(x.p);
        return `<button class="task" data-act="open" data-p="${x.p.id}" data-t="${x.task.id}" data-d="${fmtD(t0)}">
          <span class="bed">${bed.id}</span>
          <span class="tbody"><span class="tname">${esc(x.crop.name)}　${esc(x.task.name)}</span>
            <span class="tmeta">区画${slotNums(x.p)}・${last?`前回 ${jp(parseD(last.date))}`:"まだ収穫なし"}${x.task.trigger.repeat.everyDays<7?`・${x.task.trigger.repeat.everyDays}日おきが目安`:""}</span></span>
          <span class="tdue">${diffD(x.due,t0)<=0?"<b>採りごろ</b>":`<b>次 ${jp(x.due)}ごろ</b>`}${x.end?`〜${jp(x.end)}${x.frostBound?"（初霜まで）":""}`:""}</span></button>`;}).join("")}
    </div>${(()=>{ const fq = season.filter(x=>x.task.trigger.repeat.everyDays < 7);
      return fq.length ? `<div class="freq" style="margin-top:8px">${fq.map(x=>`${esc(x.crop.name)}（${x.task.trigger.repeat.everyDays}日おき）`).join("・")}は、週1〜2回の収穫だと採り遅れが出やすい作物です。</div>` : ""; })()}</div>`;
  }
  if(stale.length){
    h += `<div class="sect"><div class="round">
      <div class="round-head"><span class="round-title">3週間以上前の作業 ${stale.length}件</span><span class="round-sub">時期が過ぎているので、やらなかったものは見送りにできます</span></div>
      <div class="round-list">${stale.map(x=>`<button class="round-item" data-act="open" data-p="${x.p.id}" data-t="${x.task.id}" data-d="${fmtD(x.due)}">
        <span>${esc(x.task.name)}</span><span class="ri-crop">${esc(x.crop.name)}　${jp(x.due)}</span></button>`).join("")}</div>
      <button class="btn wide" data-act="skip-stale" style="margin-top:10px">まとめて見送りにする</button></div></div>`;
  }
  const group = (title, items, cls) => !items.length ? "" :
    `<div class="sect"><div class="sect-head"><h2>${esc(title)}</h2><span class="count">${items.length}</span></div><div class="stack">${items.map(x=>taskRow(x,cls)).join("")}</div></div>`;
  h += group("目安を過ぎた作業", late, "late");
  h += group(`今週　${jp(t0)}〜${jp(addD(t0,6))}`, week, "soon");
  h += group("この先2か月", later, "");

  if(!state.plantings.length){
    h += `<div class="welcome"><h3>はじめに</h3><ol>
      <li>「畑」タブで、今年作る作物を選ぶ</li>
      <li>畝の区画をタップして、植えた（植える予定の）作物を登録する</li>
      <li>「設定」でスプレッドシートとつなぐと、記録が自動で保存されます</li></ol></div>`;
  }else if(!all.length){
    h += `<div class="sect"><div class="card"><div class="empty">予定されている作業はありません。</div></div></div>`;
  }
  const shop = {};
  normal.filter(x=>within(x,30) && !stale.includes(x)).forEach(x=>(x.task.materials||[]).forEach(m=>shop[m]=(shop[m]||0)+1));
  const keys = Object.keys(shop);
  if(keys.length) h += `<div class="sect"><div class="sect-head"><h2>買うもの</h2><span class="count">30日以内</span></div>
    <div class="chips">${keys.map(k=>`<span class="chip">${esc(k)}${shop[k]>1?` <b>×${shop[k]}</b>`:""}</span>`).join("")}</div></div>`;
  $("#panel-week").innerHTML = h;
  wireDoneDate($("#panel-week"));
}

/* ---------- 畑 ---------- */
function renderField(){
  const t0 = today();
  let h = `<div class="sect"><div class="sect-head"><h2>畝</h2><span class="count">区画をタップ</span></div>`;
  BEDS.forEach(bed=>{
    const ps = state.plantings.filter(p=>p.status!=="done" && bedOf(p).id===bed.id && expectedEnd(p) >= t0).sort((a,b)=>a.date<b.date?-1:1);
    h += `<div class="card bedcard">
      <div class="bedhead"><span class="bed">${bed.id}</span><span class="bedname">${esc(bed.name)}</span><span class="bednote">${esc(bed.note)}</span></div>
      <div class="strip">${slotsOf(bed.id).map(s=>{
        const o = occupantNow(s), p = o.now || o.next[0] || null, c = p ? cropById(p.cropId) : null;
        const planned = p && !o.now, nx = o.now && o.next[0] ? cropById(o.next[0].cropId) : null;
        return `<button class="cell${c?" busy":""}${planned?" plan":""}" data-act="cell" data-s="${s}" aria-label="${esc(bed.name)} 区画${slotIdx(s)} ${c?esc(c.name):"空き"}">
          <span class="cidx">${slotIdx(s)}</span>
          ${c?`<span class="cname">${esc(c.name)}</span><span class="cfam">${planned?`予定 ${jp(parseD(p.date)).replace(/\(.\)/,"")}`:nx?`次：${esc(nx.name)}`:esc(c.family)}</span>`
             :`<span class="cplus">＋</span><span class="cfree">植える</span>`}</button>`;
      }).join("")}</div>
      ${ps.map(p=>{
        const c = cropById(p.cropId), d = parseD(p.date), future = d > t0, n = Math.abs(diffD(t0,d));
        return `<button class="plantrow" data-act="planting" data-p="${p.id}">
          <span class="pname">${esc(c.name)}</span><span class="ptype">区画${slotNums(p)}</span>
          <span class="pdate">${future?`予定 ${jp(d)}・${n}日後`:startPending(p)?`<b class="pend">未実施</b> 予定${jp(d)}`:`${jp(actualStart(p)||d)}〜${jp(expectedEnd(p))}`}</span></button>`;
      }).join("")}
    </div>`;
  });
  h += `</div>`;

  const my = state.settings.myCrops || [], wins = upcomingWindows(60);
  h += `<div class="sect"><div class="sect-head"><h2>作付けの適期</h2><span class="count">60日以内</span></div><div class="card">`;
  h += !wins.length
    ? `<div class="empty">60日以内にまける・植えられる作物はありません。${my.length?"（植え付け済みの作物は除いています）":"下で作る作物を選んでください。"}</div>`
    : wins.map(({crop:c, s:st})=>{
        const when = st.state==="optimal" ? `<b class="now">適期中</b> ${st.left<=0?"今日まで":`残り${st.left}日`}`
                   : st.state==="late" ? `<b class="late">遅め</b> 適期終了から${st.daysLate}日・${jp(st.win.lateEnd)}まで<br><span class="wsub">遅めですが今から始められます</span>`
                   : `<b>${st.daysToNext}日後</b> ${jp(st.next.start)}〜${st.next.frost?`<br><span class="wsub">終霜基準で${jp(st.next.frost)}から</span>`:""}`;
        return `<div class="win">
        <span class="winname">${esc(c.name)}</span><span class="ptype">${esc(c.start.action)}</span>
        <span class="winwhen">${when}</span>
        <button class="btn" data-act="auto-place" data-c="${c.id}">${st.state==="late"?"今から始める":"空き区画に植える"}</button></div>`;}).join("");
  h += `</div></div>`;
  h += `<div class="sect"><div class="sect-head"><h2>作る作物</h2><span class="count">${my.length} / ${DATA.crops.length}</span></div>
    <div class="card"><div class="chips">${DATA.crops.map(c=>{ const on = my.includes(c.id);
      return `<button class="chip${on?" sel":""}" data-act="toggle-crop" data-c="${c.id}" aria-pressed="${on}"><span class="mark">${on?"✓":"＋"}</span>${esc(c.name)}</button>`; }).join("")}</div>
    <div class="hint" style="margin-top:10px">選んだ作物だけが、区画をタップしたときの一覧と適期のお知らせに出ます。外しても、植えてある分のやることは消えません。</div></div></div>`;
  $("#panel-field").innerHTML = h;
}

/* ---------- 記録 ---------- */
let logYear = null, logCrop = "";
function plantingSpan(p){
  const t0 = today();
  const hs = state.logs.filter(l=>l.plantingId===p.id && l.type==="harvest").sort((a,b)=>a.date<b.date?-1:1);
  const start = actualStart(p) || parseD(p.date), planned = start > t0;
  const end = planned ? null : p.status==="done" ? expectedEnd(p) : maxD(t0, lastLogDate(p)||start);
  const hFirst = hs.length ? parseD(hs[0].date) : null;
  let hLast = hs.length ? parseD(hs[hs.length-1].date) : null;
  if(hLast && p.status!=="done" && end && end > hLast) hLast = end;
  const days = [...new Set(hs.map(l=>l.date))];
  return { start, end, hFirst, hLast, days, total: hs.reduce((s,l)=>s+(l.qty||0),0), planned };
}
function monthsBetween(a,b){ return (b.getFullYear()-a.getFullYear())*12 + (b.getMonth()-a.getMonth()); }
function rowEnd(r){ return r.sp.end || expectedEnd(r.p); }

function histRow(g){
  const p = state.plantings.find(x=>x.id===g.plantingId);
  const c = p ? cropById(p.cropId) : null, t = c ? c.tasks.find(x=>x.id===g.taskId) : null;
  const isH = g.type==="harvest";
  const act = isH && g.logs.length>1 ? `data-act="harvest-day" data-p="${g.plantingId}" data-d="${g.date}"` : `data-act="log" data-l="${g.logs[0].id}"`;
  return `<button class="hrow${isH?" harv":""}" ${act}>
    <span class="hd">${esc(g.date.slice(5).replace("-","/"))}</span>
    <span class="hn">${c?esc(c.name):"?"}　<span style="color:var(--ink2);font-size:12.5px">${t?esc(t.name):""}${isH&&g.logs.length>1?`（${g.logs.length}回）`:""}</span></span>
    <span class="hq">${isH?`${g.qty}${esc(c?c.unit:"")}`:g.type==="skip"?`<span style="color:var(--ink3);font-weight:400">見送り</span>`:""}</span></button>`;
}

function renderLog(){
  const t0 = today(), years = new Set([t0.getFullYear()]);
  state.plantings.forEach(p=>{ const sp = plantingSpan(p); years.add(sp.start.getFullYear()); if(sp.end) years.add(sp.end.getFullYear()); });
  const yl = [...years].sort((a,b)=>b-a);
  if(!logYear || !yl.includes(logYear)) logYear = t0.getFullYear();

  let h = "";
  const recent = groupedLogs(state.logs).sort((a,b)=> (b.updatedAt-a.updatedAt) || (a.date<b.date?1:-1)).slice(0,5);
  h += `<div class="sect"><div class="sect-head"><h2>最近の記録</h2></div><div class="card">`;
  h += recent.length ? `<div class="hist" style="border-top:0;margin-top:0">${recent.map(histRow).join("")}</div><div class="hint" style="margin-top:6px">タップで修正・取り消し</div>`
                     : `<div class="empty">まだ記録がありません。やることを「完了」にすると、ここに残ります。</div>`;
  h += `</div></div>`;

  const usedCrops = [...new Set(state.plantings.map(p=>p.cropId))].map(cropById).filter(Boolean);
  h += `<div class="sect"><div class="sect-head"><h2>${logCrop?"年ごとの比較":"年間の作付け"}</h2></div>
    <div class="yearbar">${logCrop ? `<span class="cmp-note">${esc(cropById(logCrop).name)}を年ごとに並べています</span>`
      : `<label for="lg-year" class="muted">年</label><select id="lg-year">${yl.map(y=>`<option value="${y}"${y===logYear?" selected":""}>${y}年</option>`).join("")}</select>`}</div>
    ${usedCrops.length ? `<div class="cropfilter"><button class="chip${!logCrop?" sel":""}" data-act="log-crop" data-c="">すべて</button>
      ${usedCrops.map(c=>`<button class="chip${logCrop===c.id?" sel":""}" data-act="log-crop" data-c="${c.id}">${esc(c.name)}</button>`).join("")}</div>`:""}
    <div class="card" style="margin-top:10px;padding:10px 8px"><div class="gantt-wrap" id="ganttWrap"></div>
      <div class="legend"><span><i class="l-grow"></i>育てている期間</span><span><i class="l-harv"></i>収穫期間</span><span><i class="l-dot"></i>収穫した日</span><span><i class="l-plan"></i>予定</span></div>
    </div></div>`;

  const obs = state.frost.slice().sort((a,b)=>a.targetNight<b.targetNight?1:-1);
  if(obs.length){
    const res = v => v==="yes" ? `<b class="fy">霜あり</b>` : v==="no" ? "霜なし" : `<span class="muted">—</span>`;
    h += `<div class="sect"><div class="sect-head"><h2>霜の記録</h2><span class="count">${obs.length}</span></div><div class="card">
      <div class="tablewrap"><table class="ftable"><thead><tr><th>夜</th><th>予報最低</th><th>雲</th><th>風</th><th>判定</th><th>結果</th></tr></thead><tbody>
      ${obs.map(f=>`<tr><td>${jp(parseD(f.targetNight))}</td><td>${f.tmin}℃</td><td>${f.cloud}%</td><td>${f.wind}m/s</td><td>${RISK_LABEL[f.risk]||"—"}</td><td>${res(f.observed)}</td></tr>`).join("")}
      </tbody></table></div>
      <div class="hint" style="margin-top:6px">霜リスク中・高の夜に、前の晩の予報を保存しています。翌朝の「降りていた／降りていなかった」がたまると、判定の見直しに使えます。</div></div></div>`;
  }

  const done = state.plantings.filter(p=>p.status==="done").sort((a,b)=>a.date<b.date?1:-1);
  if(done.length){
    h += `<div class="sect"><div class="sect-head"><h2>終了した作付け</h2><span class="count">${done.length}</span></div><div class="card">
      ${done.map(p=>{ const c = cropById(p.cropId), sp = plantingSpan(p);
        return `<button class="plantrow" data-act="planting" data-p="${p.id}"><span class="bed" style="width:22px;height:22px;font-size:12px">${bedOf(p).id}</span>
          <span class="pname">${esc(c.name)}</span><span class="ptype">区画${slotNums(p)}</span>
          <span class="pdate">${sp.start.getFullYear()}年${sp.start.getMonth()+1}月〜${sp.total?`・${sp.total}${esc(c.unit)}`:""}</span></button>`;}).join("")}
      </div><div class="hint" style="margin-top:8px">連作チェックはこの履歴を使います。登録が間違いだったものは削除してください。</div></div>`;
  }
  $("#panel-log").innerHTML = h;
  const ys = $("#lg-year"); if(ys) ys.addEventListener("change", ()=>{ logYear = parseInt(ys.value,10); renderLog(); });
  drawGantt();
}

function drawGantt(){
  const wrap = $("#ganttWrap"); if(!wrap) return;
  const t0 = today(), compare = !!logCrop;
  let rows, x0, x1;
  if(compare){
    rows = state.plantings.filter(p=>p.cropId===logCrop).sort((a,b)=>a.date<b.date?-1:1)
      .map(p=>({p, sp:plantingSpan(p), label:`${parseD(p.date).getFullYear()}年`, sub:`${bedOf(p).id}-${slotNums(p)}`}));
    const rel = (d, p) => diffD(d, new Date(parseD(p.date).getFullYear(),0,1));
    let lo = Infinity, hi = -Infinity;
    rows.forEach(r=>{ lo = Math.min(lo, rel(r.sp.start, r.p)); hi = Math.max(hi, rel(rowEnd(r), r.p)); });
    const ref = new Date(2025,0,1), a = addD(ref, isFinite(lo)?lo:0), b = addD(ref, isFinite(hi)?hi:365);
    x0 = new Date(a.getFullYear(), a.getMonth(), 1); x1 = new Date(b.getFullYear(), b.getMonth()+1, 1);
    while(monthsBetween(x0,x1) < 6) x1 = new Date(x1.getFullYear(), x1.getMonth()+1, 1);
    rows.forEach(r=>{ r.map = d => addD(ref, rel(d, r.p)); });
  }else{
    const Y = logYear, ys = new Date(Y,0,1), ye = new Date(Y+1,0,1);
    rows = state.plantings.map(p=>({p, sp:plantingSpan(p)})).filter(r=>r.sp.start < ye && rowEnd(r) >= ys)
      .sort((a,b)=>a.sp.start-b.sp.start).map(r=>Object.assign(r,{ label:cropById(r.p.cropId).name, sub:`${bedOf(r.p).id}-${slotNums(r.p)}`, map:d=>d }));
    let lo = null, hi = null;
    rows.forEach(r=>{ const a = r.sp.start < ys ? ys : r.sp.start, e = rowEnd(r); if(!lo||a<lo) lo = a; if(!hi||e>hi) hi = e; });
    if(!rows.length){ lo = ys; hi = ye; }
    if(t0.getFullYear()===Y){ if(t0<lo) lo = t0; if(t0>hi) hi = t0; }
    const cap = new Date(Y+1,6,1);
    x0 = new Date(lo.getFullYear(), lo.getMonth(), 1);
    x1 = new Date(Math.min(cap, new Date(hi.getFullYear(), hi.getMonth()+1, 1)));
    while(monthsBetween(x0,x1) < 6){ if(x0 > ys) x0 = new Date(x0.getFullYear(), x0.getMonth()-1, 1); else x1 = new Date(x1.getFullYear(), x1.getMonth()+1, 1); }
  }
  if(!rows.length){ wrap.innerHTML = `<div class="empty" style="padding:14px 6px">${compare?"この作物の作付けはまだありません。":`${logYear}年の作付けはまだありません。`}</div>`; return; }

  const W = Math.max(wrap.clientWidth || 320, 300);
  const LBL = W<420 ? 72 : 92, TOT = W<420 ? 50 : 62, TOP = 22, RH = 34, PAD = 8;
  const plotW = W - LBL - TOT - PAD, span = Math.max(1, diffD(x1, x0));
  const toX = d => LBL + Math.max(0, Math.min(plotW, diffD(d, x0) / span * plotW));
  const H = TOP + rows.length*RH + 6;
  let s = `<svg class="gantt" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${compare?"年ごとの比較":"年間の作付け"}">`;
  const step = (plotW / Math.max(1, monthsBetween(x0,x1))) < 18 ? 2 : 1;
  for(let m = new Date(x0); m < x1; m = new Date(m.getFullYear(), m.getMonth()+1, 1)){
    const x = toX(m), nx = toX(new Date(m.getFullYear(), m.getMonth()+1, 1));
    s += `<line class="g-grid" x1="${x}" y1="${TOP-4}" x2="${x}" y2="${H-4}"/>`;
    if((m.getMonth() % step)===0 || m.getMonth()===0) s += `<text class="${m.getMonth()===0&&!compare?"g-year":"g-month"}" x="${(x+nx)/2}" y="${TOP-9}" text-anchor="middle">${m.getMonth()===0&&!compare?`${String(m.getFullYear()).slice(2)}/1`:m.getMonth()+1}</text>`;
  }
  s += `<line class="g-grid" x1="${toX(x1)}" y1="${TOP-4}" x2="${toX(x1)}" y2="${H-4}"/>`;
  if(!compare && t0 >= x0 && t0 <= x1) s += `<line class="g-today" x1="${toX(t0)}" y1="${TOP-4}" x2="${toX(t0)}" y2="${H-4}"/>`;
  rows.forEach((r,i)=>{
    const y = TOP + i*RH, cy = y + RH/2, c = cropById(r.p.cropId), sp = r.sp, m = r.map;
    s += `<g class="g-row" tabindex="0" role="button" data-act="planting" data-p="${r.p.id}" aria-label="${esc(`${r.label} ${r.sub}、${jp(sp.start)}から${sp.total?`、収穫 ${sp.total}${c.unit}`:""}`)}">`;
    s += `<rect class="g-hit" x="0" y="${y+2}" width="${W}" height="${RH-4}" rx="6"/>`;
    s += `<text class="g-label" x="4" y="${cy-1}">${esc(r.label)}</text><text class="g-sub" x="4" y="${cy+11}">${esc(r.sub)}</text>`;
    if(sp.planned){
      const xa = toX(m(sp.start)), xb = Math.max(xa+8, toX(m(expectedEnd(r.p))));
      s += `<rect class="g-plan" x="${xa}" y="${cy-5}" width="${xb-xa}" height="10" rx="5"/>`;
    }else{
      const xa = toX(m(sp.start)), xb = Math.max(xa+6, toX(m(sp.end||t0)));
      s += `<rect class="g-grow" x="${xa}" y="${cy-5}" width="${xb-xa}" height="10" rx="5"/>`;
      if(sp.hFirst){
        const ha = toX(m(sp.hFirst)), hb = Math.max(ha+6, toX(m(sp.hLast||sp.hFirst)));
        s += `<rect class="g-harv" x="${ha}" y="${cy-5}" width="${hb-ha}" height="10" rx="5"/>`;
        sp.days.forEach(d=>{ s += `<circle class="g-dot" cx="${toX(m(parseD(d)))}" cy="${cy}" r="3"/>`; });
      }
    }
    if(sp.total) s += `<text class="g-total" x="${W-4}" y="${cy+1}" text-anchor="end">${sp.total}<tspan class="g-unit" dx="2">${esc(c.unit)}</tspan></text>`;
    s += `</g>`;
  });
  wrap.innerHTML = s + `</svg>`;
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
  const st = syncStatus(); el.hidden = false; el.className = "syncdot " + st.cls;
  el.querySelector("span").textContent = !state.sync.url ? "未同期" : st.cls==="ok" ? "同期済み" : st.cls==="err" ? "同期エラー" : "送信待ち";
}
function renderSettings(){
  const st = syncStatus(), s = state.settings, sugg = offsetSuggestions();
  const offs = Object.entries(s.cropOffset||{}).filter(([k,v])=>v);
  const rg = R();
  let h = `<div class="sect"><div class="sect-head"><h2>スプレッドシート同期</h2></div><div class="card">
    <div class="setrow"><div class="status-line">状態：<b class="${st.cls}">${esc(st.text)}</b></div>
      ${PREVIEW?`<div class="desc">GitHub Pages に置いた版で使えます。</div>`:""}</div>
    ${PREVIEW?"":`<div class="setrow">
      <label class="lbl" for="set-url">保存先のURL（Apps Script のウェブアプリURL）</label>
      <input type="url" id="set-url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(state.sync.url)}" autocomplete="off" spellcheck="false">
      <div class="desc">このURLは合鍵の役割をします。人に見せたり、GitHubのコードに書いたりしないでください。</div>
      <div class="btns"><button class="btn primary" data-act="sync-connect">保存してつなぐ</button>${state.sync.url?`<button class="btn" data-act="sync-now">今すぐ同期</button>`:""}</div></div>
    ${state.sync.url?`<div class="setrow"><div class="lbl">うまく同期できないとき</div>
      <div class="desc">この端末の記録を捨てて、スプレッドシートの内容で作り直します。未送信の変更は失われます。</div>
      <div class="btns"><button class="btn" data-act="sync-restore">スプレッドシートから作り直す</button></div></div>`:""}`}
  </div></div>`;

  const th = themeGet();
  h += `<div class="sect"><div class="sect-head"><h2>表示</h2></div><div class="card">
    <div class="setrow"><div class="lbl">明るさ</div>
      <div class="desc">明るい屋外ではライトが読みやすいです。「自動」はスマホの設定に合わせます。この端末だけの設定です。</div>
      <div class="themechips">${[["auto","自動"],["light","ライト"],["dark","ダーク"]].map(([k,l])=>`<button class="chip${th===k?" sel":""}" data-act="theme" data-t="${k}" aria-pressed="${th===k}">${l}</button>`).join("")}</div></div>
  </div></div>`;

  h += `<div class="sect"><div class="sect-head"><h2>時期の補正</h2></div><div class="card">
    <div class="setrow"><div class="lbl">季節ごとの補正（日）</div>
      <div class="desc">中間地の標準から、その季節に始める作付けのやることを前後にずらします。マイナスで前倒し。</div>
      <div class="seasongrid">${Object.entries(SEASONS).map(([k,label])=>`<label class="seasonf"><span>${label}</span>
        <input type="number" data-season="${k}" value="${s.seasonOffset[k]|0}" min="-30" max="30" step="1" inputmode="numeric"></label>`).join("")}</div></div>
    <div class="setrow"><div class="lbl">作物ごとの補正（実績から提案）</div>
      <div class="desc">収穫の記録がたまると、実際の収穫開始日と標準のずれを作物ごとに計算して、ここに提案します。</div>
      ${sugg.length ? sugg.map(x=>`<div class="sugg"><span class="sname">${esc(x.crop.name)}</span><span class="sdiff">標準より${x.avg>=0?"+":""}${x.avg}日（${x.n}作付け）</span>
          <button class="btn" data-act="apply-off" data-c="${x.crop.id}" data-v="${x.suggest}">補正を${x.suggest>=0?"+":""}${x.suggest}日にする</button></div>`).join("")
        : `<div class="empty" style="padding:4px 0">いまは提案はありません。</div>`}
      ${offs.length?`<div class="offchips">${offs.map(([k,v])=>`<button class="chip" data-act="reset-off" data-c="${k}">${esc(cropById(k)?cropById(k).name:k)} ${v>0?"+":""}${v}日 ✕</button>`).join("")}</div><div class="desc">タップで作物ごとの補正を0に戻します。</div>`:""}
    </div>
    <div class="setrow"><div class="lbl">霜の平年値：${esc(rg.name)}</div>
      <div class="desc">初霜 <b>${rg.firstFrost.md.replace("-","/")}</b>（${esc(rg.firstFrost.period)}）／終霜 <b>${rg.lastFrost.md.replace("-","/")}</b>（${esc(rg.lastFrost.period)}${rg.lastFrost.reference?"・参考値":""}）<br>
        出典：<a href="${esc(rg.url)}" target="_blank" rel="noopener">${esc(rg.source)}</a><br>${esc(rg.note)}<br>
        霜に弱い作物の植え付けは「終霜から14日後」以降、掘り上げなどは「初霜の7日前」まで、を目安にしています（アプリの暫定の安全幅）。</div></div>
  </div></div>`;
  h += `<div class="sect"><div class="muted" style="font-size:11.5px">畑ノート ${APP_VERSION}・作物データ ${DATA.crops.length}種（crops.json）</div></div>`;
  $("#panel-set").innerHTML = h;
  document.querySelectorAll("[data-season]").forEach(inp=>inp.addEventListener("change", ()=>{
    const so = Object.assign({}, state.settings.seasonOffset); so[inp.dataset.season] = Math.max(-30,Math.min(30,parseInt(inp.value,10)||0));
    putSettings({seasonOffset:so}); renderAll();
  }));
}

/* =============================================================
   シート（下から出る画面）
   ============================================================= */
let sheetCtx = null, ps = null, pe = null;
function showSheet(h){ $("#sheet").innerHTML = h; $("#backdrop").hidden = false; $("#sheet").scrollTop = 0; }
function closeSheet(){ $("#backdrop").hidden = true; sheetCtx = null; ps = null; pe = null; }
const warnHtml = ws => ws.map(w=>`<div class="warn ${w.level==="red"||w.level==="error"?"":w.level}"><span class="wt">${esc(w.title)}</span>${w.text}</div>`).join("");

/* ---------- 実施日の選択：普段は「今日」のまま1タップ、まとめて記録するときだけ変える ---------- */
function doneDateHtml(id, label){
  const t = fmtD(today()), y = fmtD(addD(today(),-1));
  return `<div class="donedate" data-for="${id}"><span class="dd-label">${esc(label||"実施日")}</span>
    <button class="chip sel" data-act="dd" data-v="${t}">今日</button><button class="chip" data-act="dd" data-v="${y}">昨日</button>
    <input type="date" id="${id}" value="${t}" max="${t}" aria-label="${esc(label||"実施日")}"></div>`;
}
function pickedDate(id){ const v = ($("#"+id)||{}).value, t = fmtD(today()); return v && v <= t ? v : t; }
function wireDoneDate(root){
  (root||document).querySelectorAll(".donedate input[type=date]").forEach(inp=>inp.addEventListener("change", ()=>{
    inp.closest(".donedate").querySelectorAll("[data-act=dd]").forEach(b=>b.classList.toggle("sel", b.dataset.v===inp.value));
  }));
}

/* ---------- やること（チェックリスト） ---------- */
function openTask(pid, tid, dueStr){
  const p = state.plantings.find(x=>x.id===pid); if(!p) return;
  const crop = cropById(p.cropId), task = crop.tasks.find(t=>t.id===tid); if(!task) return;
  const bed = bedOf(p), due = parseD(dueStr), n = diffD(due, today()), isH = task.kind==="harvest";
  const when = isH && task.trigger.repeat ? "収穫期" : n<0 ? (task.routine?"今週の見回り":`${jp(due)}・${-n}日 遅れ`) : n===0 ? `${jp(due)}・今日` : `${jp(due)}・${n}日後`;
  sheetCtx = {pid, tid, isH, isStart: task===startTaskOf(crop) && startPending(p)};
  const todays = isH ? state.logs.filter(l=>l.plantingId===pid && l.type==="harvest" && l.date===fmtD(today())) : [];
  let h = `<h3>${esc(task.name)}</h3><div class="sheet-sub">${esc(bed.name)} 区画${slotNums(p)}／${esc(crop.name)}　${esc(when)}</div>`;
  if(task.note) h += `<div class="sheet-sub" style="margin-top:6px">${esc(task.note)}</div>`;
  if(task.trigger.stage){
    const w = taskWindow(p, crop, task, due), past = today() > w.to;
    h += `<div class="stagebox${past?" past":""}"><b>${esc(task.trigger.stage)}</b>になったら実施します。<br><span class="wsub">${past
      ? `予定の時期（${jp(due)}ごろ）を過ぎています。今の生育を確認してください。まだその状態なら今やってかまいません。すでに過ぎていたら、次の作業に合わせるか「見送り」にしてください。`
      : `${jp(due)}ごろは確認を始める目安です。それより早くても遅くても、この状態になっていればやってかまいません。`}</span></div>`;
  }
  if(isH && task.trigger.repeat && task.trigger.repeat.everyDays < 7) h += `<div class="freq">収穫の目安：<b>${task.trigger.repeat.everyDays}日おき</b>。週1〜2回だと採り遅れが出やすい作物です。</div>`;
  if(task.trigger.notAfter){
    const na = task.trigger.notAfter, lim = anchorDate(na, clockBase(p));
    h += `<div class="sheet-sub" style="margin-top:6px">期限：<b>${jp(lim)}</b>まで${na.anchor==="firstFrost" ? `（平年の初霜 ${jp(firstFrostAfter(clockBase(p)))} の${-na.days}日前）` : task.deadlineNote ? `（${esc(task.deadlineNote)}）` : ""}</div>`;
  }
  const isStart = task===startTaskOf(crop) && startPending(p);
  if(isStart){
    const miss = missedPrep(p);
    if(miss.length){
      const shown = miss.filter(t=>lateMode(t)!=="skip");
      if(shown.length) h += `<div class="precheck"><div class="pc-head">事前準備の確認</div>
        <div class="pc-sub">次の工程は、本来は${esc(crop.start.action)}の前に済ませておくものです。すでに${esc(crop.start.action)}の日を迎えているので、特に書いていない限り、今からそのまま行うという意味ではありません。</div>
        ${shown.map(t=>{ const ls = t.lateStart || {}, mode = lateMode(t);
          return `<div class="pc-item"><div class="pc-name">${esc(t.name)}<span class="pc-when">本来は${esc(crop.start.action)}の${-t.trigger.days}日前ごろ</span></div>
          ${ls.message?`<div class="pc-note">${esc(ls.message)}</div>`:""}
          ${mode==="doNow" && ls.doNow ? `<div class="pc-now">今からでもやること</div><ul>${ls.doNow.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`
            : ""}
          <details class="pc-orig"><summary>本来の手順を見る</summary><ul>${t.steps.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>
            ${t.caution?`<div class="pc-caution">${esc(t.caution)}</div>`:""}</details></div>`; }).join("")}
      </div>`;
    }
  }
  if(task.materials && task.materials.length) h += `<div class="label-s">使うもの</div><div class="chips" style="margin-top:6px">${task.materials.map(m=>`<span class="chip">${esc(m)}</span>`).join("")}</div>`;
  h += `<div class="label-s">手順</div><ul class="steps">${task.steps.map((s,i)=>`<li><input type="checkbox" id="st-${i}"><label for="st-${i}">${esc(s)}</label></li>`).join("")}</ul>`;
  if(task.caution) h += `<div class="warn"><span class="wt">つまずきポイント</span>${esc(task.caution)}</div>`;
  h += doneDateHtml("done-date", isStart ? `${crop.start.action}した日` : isH ? "収穫した日" : "実施日");
  if(isStart) h += `<div class="hint" style="margin-top:6px">この日から、間引き・追肥などその後の作業を計算します（予定日は${jp(parseD(p.date))}）。</div>`;
  if(isH) h += `<div class="qty"><label for="q-in">収穫量</label><input type="number" id="q-in" min="0" inputmode="numeric" placeholder="0"><span class="unit">${esc(crop.unit)}</span></div>
    ${todays.length?`<div class="hint" style="margin-top:6px">今日はすでに ${todays.reduce((s,l)=>s+(l.qty||0),0)}${esc(crop.unit)} 記録済み。入力した分を追加で記録します。</div>`:""}`;
  h += `<div class="sheet-foot"><button class="btn" data-act="close">閉じる</button><button class="btn primary" data-act="done">${isH?"収穫を記録":"完了にする"}</button></div>`;
  showSheet(h); wireDoneDate($("#sheet"));
}
function completeTask(){
  if(!sheetCtx) return;
  const {pid, tid, isH, isStart} = sheetCtx;
  const d = pickedDate("done-date");
  const before = bookingConflicts().length;
  if(isH) putLog({id:uid("l"), plantingId:pid, taskId:tid, date:d, type:"harvest", qty: parseInt(($("#q-in")||{}).value,10)||0});
  else putLog({id:uid("l"), plantingId:pid, taskId:tid, date:d, type:"work"});
  closeSheet(); renderAll();
  if(isStart && bookingConflicts().length > before) toast("開始が遅れたため、区画の予定が次の作付けと重なりました");
  else toast(isH ? "収穫を記録しました" : isStart ? `${jp(parseD(d))}を起点に、その後の作業を計算しました` : "完了にしました");
}

/* ---------- 区画 → 作物を選ぶ → 登録 ---------- */
function openCell(slot){
  const o = occupantNow(slot);
  if(o.now || o.next.length){ openPlanting((o.now||o.next[0]).id); return; }
  ps = { anchor:slot, bed:slotBed(slot), cropId:null, slots:[slot], date:null, count:10, after:null };
  renderPlantSheet();
}
/* 使用中の区画に「次の作付け」を予定する */
function planNext(slot){
  const last = plantingsIn(slot, p=>p.status!=="done").pop();
  const after = last ? addD(expectedEnd(last), 1) : null;
  ps = { anchor:slot, bed:slotBed(slot), cropId:null, slots:[slot], date:null, count:10, after };
  renderPlantSheet();
}
function renderPlantSheet(){
  const bed = bedById(ps.bed);
  let h = "";
  if(!ps.cropId){
    const my = (state.settings.myCrops||[]).length ? state.settings.myCrops : DATA.crops.map(c=>c.id);
    const rows = my.map(id=>{
      const c = cropById(id); if(!c) return null;
      const from = earliestAfter(c, ps.after), d = defaultDate(c, from), st = seasonStatus(c, from || today());
      const slots = extendFrom(ps.anchor, needOf(id), d, id);
      const ws = checkPlanting(slots, id, d);
      const err = blocking(ws), red = ws.some(x=>x.level==="red"), mid = ws.some(x=>x.title.startsWith("連作：")),
            sun = ws.some(x=>x.title==="日照注意"), good = ws.some(x=>x.level==="good"), short = slots.length < needOf(id);
      const so = {optimal:0, late:1, upcoming:2, offSeason:3}[st.state];
      return {c, st, d, err, red, mid, sun, good, short, rank:(err?200:0)+(red?100:0)+(short?50:0)+(mid?30:0)+(sun?20:0)+so*10+Math.min(Math.max(0,diffD(parseD(d),today())),365)/40};
    }).filter(Boolean).sort((a,b)=>a.rank-b.rank);
    h = `<h3>${esc(bed.name)}・区画${slotIdx(ps.anchor)}に${ps.after?"次に":""}植える</h3>
      <div class="sheet-sub">${esc(bed.note)}。${ps.after?`今の作付けが終わる${jp(addD(ps.after,-1))}より後で判定しています。`:"この区画での連作・日照・広さを判定して並べています。"}</div>
      <div class="croplist">${rows.map(r=>{
        const when = statusChip(r.st);
        const tags = [ r.err?`<span class="tag red">使用中</span>`:"", r.red?`<span class="tag red">連作リスク高</span>`:"", r.mid?`<span class="tag amber">連作やや短い</span>`:"",
          r.sun?`<span class="tag amber">日照</span>`:"", r.short?`<span class="tag amber">狭い</span>`:"", r.good?`<span class="tag good">半日陰◎</span>`:"",
          needOf(r.c.id)>1&&!r.short?`<span class="tag">${esc(shareLabel(needOf(r.c.id)))}</span>`:"" ].join("");
        return `<button class="croprow${r.red||r.err||r.st.state==="offSeason"?" ng":""}" data-act="ps-crop" data-c="${r.c.id}"><span class="crname">${esc(r.c.name)}</span><span class="crtags">${tags}</span><span class="crwhen">${when}</span></button>`;
      }).join("")}</div>
      <div class="sheet-foot"><button class="btn" data-act="close">閉じる</button></div>`;
  }else{
    const c = cropById(ps.cropId), need = needOf(ps.cropId);
    const ws = checkPlanting(ps.slots, ps.cropId, ps.date);
    if(ps.slots.length && ps.slots.length < need) ws.push({level:"amber", title:"区画が足りないかも", text:`${esc(c.name)}は${esc(shareLabel(need))}ほど場所を使います（${esc(c.start.spacing)}）。`});
    const E = expectedEnd({id:"__c", cropId:ps.cropId, date:ps.date, slots:ps.slots, status:"active"});
    h = `<button class="linkback" data-act="ps-back">← 作物を選び直す</button>
      <h3>${esc(c.name)}を植える</h3>
      <div class="sheet-sub">${esc(bed.name)}／適期 ${esc(junLabel(c.start.window))}（${esc(c.start.action)}）／${esc(c.start.spacing)}</div>
      <div class="label-s">使う区画${need>1?`（目安 ${need}区画）`:""}</div>
      <div class="picker">${slotsOf(ps.bed).map(s=>{
        const free = slotFree(s, ps.date, ps.cropId), sel = ps.slots.includes(s);
        const o = !free ? plantingsIn(s).find(p=>overlaps(interval({id:"__c",cropId:ps.cropId,date:ps.date,slots:[s],status:"active"}), interval(p))) : null;
        const oc = o ? cropById(o.cropId) : null;
        return `<button class="slot${sel?" sel":""}${oc?" occ":""}" data-act="ps-slot" data-s="${s}" aria-pressed="${sel}"${oc&&!sel?" disabled":""}>
          <span class="sidx">区画${slotIdx(s)}</span><span class="sname">${oc?esc(oc.name):sel?esc(c.name):"空き"}</span></button>`;
      }).join("")}</div>
      <div class="row2">
        <div class="field"><label for="ps-date">${esc(c.start.action)}日</label><input type="date" id="ps-date" value="${ps.date}"></div>
        <div class="field"><label for="ps-count">株数・本数</label><input type="number" id="ps-count" min="1" value="${ps.count}" inputmode="numeric"></div>
      </div>
      ${parseD(ps.date) <= today() ? `<div class="startchoice" role="radiogroup" aria-label="${esc(c.start.action)}の状況">
        <label><input type="radio" name="ps-start" value="0"${ps.startDone?"":" checked"}> これから${verbOf(c).now}</label>
        <label><input type="radio" name="ps-start" value="1"${ps.startDone?" checked":""}> もう${verbOf(c).past}（${jp(parseD(ps.date))}）</label></div>` : ""}
      <div class="hint" style="margin-top:6px">この区画を使う期間の見込み：${jp(bookingStart({cropId:ps.cropId,date:ps.date}))}〜${jp(E)}（準備作業から収穫の終わりまで）</div>
      ${warnHtml(ws)}
      <div class="sheet-foot"><button class="btn" data-act="close">やめる</button>
        <button class="btn primary" data-act="ps-save"${ps.slots.length&&!blocking(ws)?"":" disabled"}>登録する</button></div>`;
  }
  $("#sheet").innerHTML = h; $("#backdrop").hidden = false;
  const di = $("#ps-date"); if(di) di.addEventListener("change", ()=>{ ps.date = di.value||ps.date; ps.startDone = parseD(ps.date) < today(); renderPlantSheet(); });
  const ci = $("#ps-count"); if(ci) ci.addEventListener("change", ()=>{ ps.count = parseInt(ci.value,10)||1; });
  document.querySelectorAll('input[name="ps-start"]').forEach(r=>r.addEventListener("change", ()=>{ ps.startDone = r.value==="1" && r.checked; }));
}
function savePlanting(){
  if(!ps || !ps.cropId || !ps.slots.length) return;
  const ci = $("#ps-count"); if(ci) ps.count = parseInt(ci.value,10)||1;
  const ws = checkPlanting(ps.slots, ps.cropId, ps.date);
  if(blocking(ws)) return;
  const warn = ws.filter(w=>w.level==="red"||w.level==="amber");
  if(warn.length && !confirm(warn.map(w=>w.title).join("・")+"があります。このまま登録しますか？")) return;
  if(state.sample){ state.plantings = []; state.logs = []; state.sample = false; }
  const slots = ps.slots.slice().sort((a,b)=>slotIdx(a)-slotIdx(b)), pid = uid("p");
  putPlanting({id:pid, bedId:ps.bed, slots, cropId:ps.cropId, date:ps.date, count:ps.count, status:"active", memo:""});
  // 登録＝計画。「もう始めた」を選んだときだけ、開始作業をその日の完了として記録する
  const st = startTaskOf(cropById(ps.cropId));
  if(st && ps.startDone && parseD(ps.date) <= today()) putLog({id:uid("l"), plantingId:pid, taskId:st.id, date:ps.date, type:"work"});
  closeSheet(); renderAll(); toast("登録しました");
}

/* ---------- 作付けの詳細 ---------- */
function openPlanting(pid){
  const p = state.plantings.find(x=>x.id===pid); if(!p) return;
  const c = cropById(p.cropId), bed = bedOf(p), t0 = today(), d = parseD(p.date);
  const future = d > t0, n = Math.abs(diffD(t0,d)), isDone = p.status==="done";
  const next = computeTasks().filter(x=>x.p.id===pid).slice(0,4);
  const logs = state.logs.filter(l=>l.plantingId===pid).sort((a,b)=>a.date<b.date?1:-1);
  const hs = logs.filter(l=>l.type==="harvest"), total = hs.reduce((s,l)=>s+(l.qty||0),0), hDays = new Set(hs.map(l=>l.date)).size;
  ps = null;
  let h = `<h3>${esc(c.name)}</h3>
    <div class="sheet-sub">${esc(bed.name)} 区画${slotNums(p)}（${esc(shareLabel(p.slots.length))}）・${p.count}株</div>
    <div class="sheet-sub">${(()=>{ const a = actualStart(p);
      if(a) return `${esc(c.start.action)} ${jp(a)}${a.getTime()!==d.getTime()?`（予定は${jp(d)}）`:""}${isDone?"":`・${diffD(t0,a)}日目`}`;
      if(isDone) return `${esc(c.start.action)} ${jp(d)}`;
      return future ? `${esc(c.start.action)}予定 ${jp(d)}（${n}日後）` : `<b>${esc(c.start.action)}は未実施</b>（予定 ${jp(d)}）`; })()}
      ${isDone&&p.endDate?`〜 ${jp(parseD(p.endDate))} 終了`:isDone?"":`・終了見込み ${jp(expectedEnd(p))}`}${hs.length?`／収穫 ${hDays}日・計<b>${total}${esc(c.unit)}</b>`:""}</div>
    ${isDone?`<div class="sheet-sub" style="margin-top:6px"><b>終了済み</b>（連作の履歴として残っています）</div>`:""}
    ${p.memo?`<div class="memo">${esc(p.memo)}</div>`:""}
    ${bookingConflicts().filter(k=>k.a.id===p.id||k.b.id===p.id).map(k=>{ const o = k.a.id===p.id ? k.b : k.a;
      return `<div class="warn"><span class="wt">区画の予定が重なっています</span>区画${k.shared.map(slotIdx).join("・")}：<b>${esc(cropById(o.cropId).name)}</b>（${jp(interval(o).from)}〜${jp(interval(o).to)}）と期間が重なります。日付か区画を修正してください。</div>`; }).join("")}`;
  if(!isDone){
    h += `<div class="label-s">次のやること</div>`;
    h += next.length ? `<div class="stack" style="margin-top:8px">${next.map(x=>taskRow(x, x.kind==="normal"&&x.due<t0?"late":diffD(x.due,t0)<=6?"soon":"")).join("")}</div>` : `<div class="empty">予定されている作業はありません。</div>`;
  }
  h += `<div class="label-s">記録（${logs.length}件）</div>`;
  h += logs.length ? `<div class="hist">${groupedLogs(logs).map(histRow).join("")}</div>` : `<div class="empty">まだ記録がありません。</div>`;
  h += `<div class="sheet-foot">
      ${!isDone && !future && c.tasks.some(t=>t.kind==="harvest") ? `<button class="btn" data-act="quick-harvest" data-p="${p.id}">収穫を記録</button>`:""}
      ${isDone?`<button class="btn" data-act="reopen" data-p="${p.id}">作付けを再開</button>`:`<button class="btn ghost" data-act="finish" data-p="${p.id}">作付けを終了</button>`}
    </div>
    ${!isDone?`<div class="sheet-foot" style="margin-top:8px"><button class="btn" data-act="plan-next" data-s="${p.slots[0]}">この区画の次の作付けを予定</button></div>`:""}
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
      const free = slotFree(s, pe.date, p.cropId, p.id), sel = pe.slots.includes(s);
      return `<button class="slot${sel?" sel":""}${!free?" occ":""}" data-act="pe-slot" data-s="${s}" aria-pressed="${sel}"${!free&&!sel?" disabled":""}>
        <span class="sidx">区画${slotIdx(s)}</span><span class="sname">${!free?"使用中":sel?esc(c.name):"空き"}</span></button>`;
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
      <button class="btn primary" data-act="pe-save"${pe.slots.length&&!blocking(ws)?"":" disabled"}>保存</button></div>
    <div class="dangerzone">
      <div class="hint">登録そのものが間違いだった場合は削除します。記録${nLogs}件も一緒に消え、連作の履歴にも残りません。収穫を終えただけなら「作付けを終了」を使ってください。</div>
      <button class="btn danger wide" data-act="pe-del" data-p="${p.id}">この作付けを削除</button>
    </div>`;
  const keep = $("#sheet").scrollTop;
  $("#sheet").innerHTML = h; $("#backdrop").hidden = false; $("#sheet").scrollTop = top ? 0 : keep;
  const di = $("#pe-date"); if(di) di.addEventListener("change", ()=>{ pe.date = di.value||pe.date; syncPe(); renderPlantingEdit(); });
}
function syncPe(){ const ci = $("#pe-count"); if(ci) pe.count = parseInt(ci.value,10)||1; const mi = $("#pe-memo"); if(mi) pe.memo = mi.value; }

/* ---------- 記録の修正 ---------- */
function openLog(id){
  const l = state.logs.find(x=>x.id===id); if(!l) return;
  const p = state.plantings.find(x=>x.id===l.plantingId), c = p ? cropById(p.cropId) : null;
  const t = c ? c.tasks.find(x=>x.id===l.taskId) : null, isH = l.type==="harvest";
  showSheet(`<h3>${t?esc(t.name):"作業の記録"}</h3>
    <div class="sheet-sub">${c?esc(c.name):""}${p?`／${esc(bedOf(p).name)} 区画${slotNums(p)}`:""}</div>
    <div class="row2"><div class="field"><label for="lg-date">日付</label><input type="date" id="lg-date" value="${l.date}"></div>
      ${isH?`<div class="field"><label for="lg-qty">収穫量（${esc(c?c.unit:"")}）</label><input type="number" id="lg-qty" min="0" inputmode="numeric" value="${l.qty||0}"></div>`:""}</div>
    <div class="hint" style="margin-top:10px">${isH?"削除すると収穫の合計からも差し引かれます。":(l.type==="skip"?"見送りにした作業です。":"")+"削除すると、この作業は未完了に戻ってやることリストに再び出ます。"}</div>
    <div class="sheet-foot"><button class="btn danger" data-act="log-del" data-l="${l.id}">削除</button><button class="btn primary" data-act="log-save" data-l="${l.id}">保存</button></div>
    <div class="sheet-foot" style="margin-top:8px"><button class="btn" data-act="close">閉じる</button></div>`);
}
/* 同じ日の収穫（複数件）の一覧 */
function openHarvestDay(pid, date){
  const p = state.plantings.find(x=>x.id===pid); if(!p) return;
  const c = cropById(p.cropId), ls = state.logs.filter(l=>l.plantingId===pid && l.type==="harvest" && l.date===date).sort((a,b)=>(a.updatedAt||0)-(b.updatedAt||0));
  showSheet(`<h3>${esc(c.name)}の収穫　${jp(parseD(date))}</h3>
    <div class="sheet-sub">${esc(bedOf(p).name)} 区画${slotNums(p)}・${ls.length}回で計 <b>${ls.reduce((s,l)=>s+(l.qty||0),0)}${esc(c.unit)}</b></div>
    <div class="hist">${ls.map((l,i)=>`<button class="hrow harv" data-act="log" data-l="${l.id}"><span class="hd">${i+1}回目</span><span class="hn">${l.updatedAt?new Date(l.updatedAt).toTimeString().slice(0,5)+" に記録":""}</span><span class="hq">${l.qty||0}${esc(c.unit)}</span></button>`).join("")}</div>
    <div class="hint" style="margin-top:6px">1件ずつ保存しています。タップで修正・削除できます。</div>
    <div class="sheet-foot"><button class="btn" data-act="close">閉じる</button></div>`);
}

/* ---------- トースト（取り消し付き） ---------- */
let toastTimer = null;
function toast(msg, undo){
  let el = $("#toast");
  if(!el){ el = document.createElement("div"); el.id = "toast"; el.setAttribute("role","status"); document.body.appendChild(el); }
  el.innerHTML = `<span>${esc(msg)}</span>${undo?`<button data-act="undo">取り消す</button>`:""}`;
  el.className = "show"; toast.undo = undo || null;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>{ el.className = ""; toast.undo = null; }, undo ? 7000 : 2400);
}

/* =============================================================
   操作
   ============================================================= */
document.addEventListener("click", e=>{
  const tab = e.target.closest('[role="tab"]'); if(tab){ selectTab(tab.id); return; }
  const el = e.target.closest("[data-act]");
  if(!el){ if(e.target.id==="backdrop") closeSheet(); return; }
  handle(el.dataset.act, el);
});
document.addEventListener("keydown", e=>{
  if(e.key==="Escape" && !$("#backdrop").hidden) closeSheet();
  if((e.key==="Enter"||e.key===" ") && e.target.matches && e.target.matches("g.g-row")){ e.preventDefault(); handle("planting", e.target); }
});

async function handle(act, el){
  const d = el.dataset, P = id => state.plantings.find(x=>x.id===id);
  switch(act){
    case "open": openTask(d.p, d.t, d.d); break;
    case "close": closeSheet(); break;
    case "done": completeTask(); break;
    case "undo": if(toast.undo){ toast.undo(); toast.undo = null; $("#toast").className = ""; } break;
    case "go-settings": selectTab("tab-set"); break;
    case "theme": setTheme(d.t); renderSettings(); break;
    case "dd": {
      const box = el.closest(".donedate"), inp = box && box.querySelector("input[type=date]");
      if(inp){ inp.value = d.v; box.querySelectorAll("[data-act=dd]").forEach(b=>b.classList.toggle("sel", b===el)); }
      break;
    }
    case "round-done": case "skip-stale": {
      const t0 = today(), round = act==="round-done", when = round ? pickedDate("round-date") : fmtD(t0);
      const items = computeTasks().filter(x=> round ? (x.kind==="routine" && diffD(x.due,t0)<=6) : (x.kind==="normal" && !x.task.trigger.repeat && diffD(t0,x.due) > 21));
      const ids = items.map(x=>{ const l = {id:uid("l"), plantingId:x.p.id, taskId:x.task.id, date:when, type: round?"work":"skip"}; putLog(l); return l.id; });
      renderAll();
      toast(round ? `見回り${ids.length}件を記録しました` : `${ids.length}件を見送りにしました`, ()=>{ ids.forEach(removeLog); renderAll(); });
      break;
    }
    case "clear-sample": state.plantings = []; state.logs = []; state.sample = false; save(); renderAll(); break;
    case "frost-obs": {
      const id = fmtD(addD(today(),-1)), f = state.frost.find(x=>x.id===id);
      state.asked[id] = Date.now();
      if(f && d.v){ f.observed = d.v; putFrost(f); } else save();
      renderAll(); if(d.v) toast("霜の記録を残しました");
      break;
    }
    case "finish": {
      const p = P(d.p);
      if(p && confirm(`${cropById(p.cropId).name}の作付けを終了します。区画が空き、やることからも消えます（記録と連作の履歴は残ります）。`)){
        p.status = "done"; p.endDate = fmtD(today()); putPlanting(p); closeSheet(); renderAll(); toast("作付けを終了しました");
      }
      break;
    }
    case "reopen": {
      const p = P(d.p); if(!p) break;
      const probe = Object.assign({}, p, {status:"active"}); delete probe.endDate;
      const clash = p.slots.filter(s=>plantingsIn(s, x=>x.id!==p.id).some(x=>overlaps(interval(probe), interval(x))));
      if(clash.length){ alert(`区画${clash.map(slotIdx).join("・")}は、その時期に別の作物が使っています。先に「修正」で区画を変えてください。`); break; }
      p.status = "active"; delete p.endDate; putPlanting(p); renderAll(); openPlanting(p.id); break;
    }
    case "toggle-crop": {
      const my = state.settings.myCrops || [];
      putSettings({ myCrops: my.includes(d.c) ? my.filter(x=>x!==d.c) : my.concat([d.c]), myCropsTouched:true }); renderField(); break;
    }
    case "cell": openCell(d.s); break;
    case "plan-next": planNext(d.s); break;
    case "planting": openPlanting(d.p); break;
    case "ps-crop":
      ps.cropId = d.c; ps.date = defaultDate(cropById(d.c), earliestAfter(cropById(d.c), ps.after)); ps.slots = extendFrom(ps.anchor, needOf(d.c), ps.date, d.c);
      ps.startDone = parseD(ps.date) < today();
      renderPlantSheet(); $("#sheet").scrollTop = 0; break;
    case "ps-back": ps.cropId = null; ps.slots = [ps.anchor]; ps.date = null; renderPlantSheet(); break;
    case "ps-slot": ps.slots = ps.slots.includes(d.s) ? ps.slots.filter(x=>x!==d.s) : ps.slots.concat([d.s]); renderPlantSheet(); break;
    case "ps-save": savePlanting(); break;
    case "auto-place": {
      const got = autoPlace(d.c);
      if(!got){ alert("その時期に空いている区画がありません。どれかの作付けを終了するか、日付をずらしてください。"); break; }
      ps = { anchor:got.slots[0], bed:slotBed(got.slots[0]), cropId:d.c, slots:got.slots, date:got.date, count:10, after:null };
      renderPlantSheet(); $("#sheet").scrollTop = 0; break;
    }
    case "quick-harvest": {
      const p = P(d.p); if(!p) break;
      const ht = cropById(p.cropId).tasks.find(t=>t.kind==="harvest"); if(ht) openTask(p.id, ht.id, fmtD(today())); break;
    }
    case "log": openLog(d.l); break;
    case "harvest-day": openHarvestDay(d.p, d.d); break;
    case "log-save": {
      const l = state.logs.find(x=>x.id===d.l); if(!l) break;
      const nd = ($("#lg-date")||{}).value; if(nd) l.date = nd;
      const q = $("#lg-qty"); if(q) l.qty = parseInt(q.value,10)||0;
      putLog(l); closeSheet(); renderAll(); toast("保存しました"); break;
    }
    case "log-del": {
      const l = state.logs.find(x=>x.id===d.l); if(!l) break;
      const copy = Object.assign({}, l); delete copy._v;
      removeLog(l.id); closeSheet(); renderAll();
      toast("記録を削除しました", ()=>{ copy.id = uid("l"); putLog(copy); renderAll(); });
      break;
    }
    case "pe-open": openPlantingEdit(d.p); break;
    case "pe-slot": syncPe(); pe.slots = pe.slots.includes(d.s) ? pe.slots.filter(x=>x!==d.s) : pe.slots.concat([d.s]); renderPlantingEdit(); break;
    case "pe-save": {
      const p = P(pe.pid); if(!p || !pe.slots.length) break;
      syncPe();
      const ws = checkPlanting(pe.slots, p.cropId, pe.date, p.id);
      if(blocking(ws)) break;
      const warn = ws.filter(w=>w.level==="red"||w.level==="amber");
      if(warn.length && !confirm(warn.map(w=>w.title).join("・")+"があります。このまま保存しますか？")) break;
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
    case "reset-off": { const co = Object.assign({}, state.settings.cropOffset||{}); delete co[d.c]; putSettings({cropOffset:co}); renderAll(); break; }

    /* ---- 同期 ---- */
    case "sync-connect": {
      const url = ($("#set-url").value||"").trim();
      if(url && !/^https:\/\/script\.google(usercontent)?\.com\//.test(url)){ alert("Apps Script のウェブアプリURL（https://script.google.com/macros/s/…/exec）を貼ってください。"); break; }
      state.sync.url = url; state.sync.lastErr = ""; save();
      if(!url){ renderAll(); break; }
      el.disabled = true; el.textContent = "確認中…";
      await sync(true);
      toast(state.sync.lastErr ? "つながりませんでした。URLと公開設定（アクセス：全員）を確認してください" : "つながりました");
      break;
    }
    case "sync-now": await sync(true); toast(state.sync.lastErr ? "送受信できませんでした" : "同期しました"); break;
    case "sync-restore": {
      if(!confirm("この端末の記録を捨てて、スプレッドシートの内容で作り直します。未送信の変更は失われます。よろしいですか？")) break;
      const keep = state.sync.url, asked = state.asked;
      state = emptyState(); state.sync.url = keep; state.asked = asked; state.settings.myCrops = DATA.crops.map(c=>c.id);
      save(); await sync(true); toast(state.sync.lastErr ? "作り直せませんでした" : "スプレッドシートから作り直しました"); break;
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
   起動：手元のデータで先に表示し、同期と天気は裏で
   ============================================================= */
async function boot(){
  applyTheme(themeGet());
  try{ DATA = window.CROPS_DATA || await (await fetch("crops.json", {cache:"no-cache"})).json(); }
  catch(e){ document.querySelector("main").innerHTML = `<div class="warn" style="margin-top:20px">作物データ（crops.json）を読み込めませんでした。電波のある場所で開き直してください。</div>`; return; }
  load();
  const t0 = today();
  $("#todayLabel").textContent = `${t0.getFullYear()}年${t0.getMonth()+1}月${t0.getDate()}日（${"日月火水木金土"[t0.getDay()]}）`;
  renderAll();
  if(!PREVIEW){
    try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(e){}
    if("serviceWorker" in navigator && location.protocol==="https:") navigator.serviceWorker.register("sw.js").catch(()=>{});
    refreshFrost();
    if(state.sync.url) sync(true);
  }
}
boot();
