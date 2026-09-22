/* =============================================================
   畑ノート v4
   - 作物データ・地域の霜平年値は crops.json（GitHub上で直接編集できる）
   - 記録はこの端末に保存し、Googleスプレッドシートと双方向に同期
   ============================================================= */
"use strict";

const APP_VERSION = "5.4";
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
/* 「冬は半日陰」の冬：11/1〜2月末。栽培期間がここに30日以上かかる作付けだけ、日当たりを判定に使う */
const WINTER = { from:[11,1], to:[2,28], minDays:30 };
function winterDays(iv){
  let n = 0;
  for(let y = iv.from.getFullYear()-1; y <= iv.to.getFullYear(); y++){
    const ws = new Date(y, WINTER.from[0]-1, WINTER.from[1]), we = new Date(y+1, WINTER.to[0]-1, WINTER.to[1]);
    const a = iv.from > ws ? iv.from : ws, b = iv.to < we ? iv.to : we;
    if(a <= b) n += diffD(b, a) + 1;
  }
  return n;
}
const slotsOf  = b => Array.from({length:DIV}, (_,i) => b+(i+1));
const slotIdx  = s => parseInt(s.slice(1),10);
const slotBed  = s => String(s||"")[0];
const ALL_SLOTS = BEDS.flatMap(b => slotsOf(b.id));
const bedById  = id => BEDS.find(b => b.id===id);
const cropById = id => DATA.crops.find(c => c.id===id);
const needOf   = id => (cropById(id)||{}).slotsNeeded || 1;
const shareLabel = n => n>=DIV ? "畝まるごと" : n===DIV/2 ? "畝の半分" : `${n}/${DIV}畝`;
const bedOf    = p => bedById(p.bedId || slotBed((p.slots||[])[0]));

/* =============================================================
   位置（v5）
   作付けは畝の中の「位置」を持つ（spots）。保存するのは事実としての位置だけ：
     株      { kind:"plant", center, space }     … 植えた中心（左端からのcm）と、置いたときの株間（その株の栽培スペースの幅。
                                                  あとで作物データの株間を直しても、過去の株のスペースは変わらない）
     まとまり { kind:"group", from, to, n, rows } … その群植が占有する栽培スペース（両端の半株間を含む）と株数・条数。
                                                  株が並んでいる範囲（最初〜最後の株の中心）ではない。
                                                  例：5株・2条・株間30cm → 90cm＝15｜●─30─●─30─●｜15。
                                                  個々の株の位置は保存せず、必要なときに groupCenters() で計算する。
                                                  lost＝どれか不明の減少数、ended＝終わった株 [{row, index, endDate}]（n は変えない）
     帯      { kind:"band",  from, to }          … すじまき・点まきの範囲
   共通の任意項目：crossFrom / crossTo（幅方向。未指定＝畝の幅全体）、endDate（その位置だけ終わった日）、
   precision（"slot"＝4区画から変換した粗い位置／"exact"＝畝の中で置いた位置）
   株間は作物の条件（spacingCm）として別に持ち、判断のたびに計算する。
   位置を持たない古い作付けは、読むたびに slots（1/4畝）から変換する（書き戻さない）。
   ============================================================= */
const BED_DEFAULTS = { a:{lengthCm:500, widthCm:70}, b:{lengthCm:500, widthCm:70}, c:{lengthCm:400, widthCm:70} };   // 概算（設定で変更可）
const PLANT_HALF = 5;      // 株どうしは中心が10cm未満なら「同じ場所」＝使用中
const ROT_BUFFER = 10;     // 連作判定で、畝の中で置いた位置に足す根の広がり（アプリの仮の目安）
const GRID = 5;            // 位置は5cm刻み
/* 作物の株間（crops.json の spacingCm）。未設定は null＝不明。不明を仮の数字で「知っていること」にしない：
   株間の注意もおすすめの材料にも使わない。同じ場所の判定（中心10cm未満・帯の中）はできる */
function spacingOf(crop){
  const s = crop && crop.spacingCm; if(!s || !(Number(s.min) > 0)) return null;
  return { min:Number(s.min), preferred:Number(s.preferred) > 0 ? Number(s.preferred) : Number(s.min) };
}
const layoutOf = crop => (crop && crop.layout) || "plant";
function bedDims(id){
  const d = BED_DEFAULTS[id] || {lengthCm:400, widthCm:70};
  const s = ((state && state.settings && state.settings.beds) || {})[id] || {};
  const n = v => Number(v) > 0 ? Number(v) : null;
  return { lengthCm: n(s.lengthCm) || d.lengthCm, widthCm: n(s.widthCm) || d.widthCm };
}
function slotRange(s){ const L = bedDims(slotBed(s)).lengthCm, i = slotIdx(s); return { from: L*(i-1)/DIV, to: L*i/DIV }; }
function slotSpot(s){ const r = slotRange(s); return { kind:"band", from:r.from, to:r.to, precision:"slot", slot:s }; }
/* 位置が読めない（シートの spots 列が壊れている）かつ区画もない作付けは、畝全体を使っているものとして扱う（空きにしない） */
const spotsUnknown = p => !!p.spotsRaw && !(Array.isArray(p.spots) && p.spots.length);
function spotsOf(p){
  if(Array.isArray(p.spots) && p.spots.length) return p.spots;
  if((p.slots||[]).length) return p.slots.map(slotSpot);
  if(p.spotsRaw && p.bedId) return [{ kind:"band", from:0, to:bedDims(p.bedId).lengthCm, precision:"unknown" }];
  return [];
}
/* 畝の中で置いた位置のうち、畝の長さを超えているもの（寸法を短く直したとき）。位置は動かさない */
function spotsOutside(p, L){
  const b = bedOf(p); if(!b || !Array.isArray(p.spots)) return [];
  L = L || bedDims(b.id).lengthCm;
  return p.spots.filter(sp=>sp.precision==="exact" && (sp.kind==="plant" ? (sp.center < 0 || sp.center > L) : (sp.from < 0 || sp.to > L)));
}
function spotLabel(sp){
  if(sp.slot) return `区画${slotIdx(sp.slot)}`;
  return sp.kind==="plant" ? `左から${sp.center}cm` : `左から${sp.from}〜${sp.to}cm`;
}
const rangeHit = (a,b) => a.from < b.to && b.from < a.to;          // 端が接するだけは重ならない
function spotAlong(sp){ return sp.kind==="plant" ? { from:sp.center-PLANT_HALF, to:sp.center+PLANT_HALF } : { from:sp.from, to:sp.to }; }
function spotCross(sp, bedId){
  const W = bedDims(bedId).widthCm;
  return { from: sp.crossFrom!=null ? sp.crossFrom : 0, to: sp.crossTo!=null ? sp.crossTo : W };
}
/* 同じ場所か（長さ方向と幅方向の両方が重なる） */
function spotsClash(a, b, bedId){ return rangeHit(spotAlong(a), spotAlong(b)) && rangeHit(spotCross(a,bedId), spotCross(b,bedId)); }
/* 連作判定に使う範囲：株は株間ぶんの広がり、畝の中で置いた位置には根の余白を足す（区画から変換した位置はそのまま） */
function rotAlong(sp, crop){
  const sc = spacingOf(crop);
  const h = sp.space > 0 ? sp.space/2 : sc ? sc.preferred/2 : 0;     // 置いたときの株間 → なければ今の作物データ → 不明なら中心＋根の余白だけ
  let r = sp.kind==="plant" ? { from:sp.center-h, to:sp.center+h } : { from:sp.from, to:sp.to };
  if(sp.precision==="exact") r = { from:r.from-ROT_BUFFER, to:r.to+ROT_BUFFER };
  return r;
}
function spotsRotHit(a, ca, b, cb, bedId){ return rangeHit(rotAlong(a,ca), rotAlong(b,cb)) && rangeHit(spotCross(a,bedId), spotCross(b,bedId)); }
/* その位置の終わり：作付けの終わりか、その位置だけ先に終わった日 */
function spotEnd(p, sp, e){ e = e || expectedEnd(p); return sp.endDate ? minD(e, parseD(sp.endDate)) : e; }
/* 場所 area と重なる作付け（同じ畝）を、時期の早い順に */
function plantingsAt(area, bedId, pred){
  return state.plantings.filter(p=>{ const b = bedOf(p); return b && b.id===bedId && spotsOf(p).some(sp=>spotsClash(sp, area, bedId)) && (!pred||pred(p)); })
    .sort((a,b)=>a.date<b.date?-1:1);
}
/* 作付け p が場所 area を使う期間（重なる位置のうち一番遅い終わりまで） */
function intervalAt(p, area, bedId){
  const e = expectedEnd(p); let to = null;
  spotsOf(p).forEach(sp=>{ if(spotsClash(sp, area, bedId)){ const x = spotEnd(p, sp, e); if(!to || x > to) to = x; } });
  return { from: bookingStart(p), to: to || e };
}
/* 位置が触れている区画（表示用：区画1・2 など） */
function slotsTouched(p){
  if(!(Array.isArray(p.spots) && p.spots.length)) return (p.slots||[]).slice();
  const b = bedOf(p); if(!b) return [];
  return slotsOf(b.id).filter(s=>p.spots.some(sp=>spotsClash(sp, slotSpot(s), b.id)));
}
const slotNums = p => slotsTouched(p).map(slotIdx).sort((x,y)=>x-y).join("・");
/* まとまりの中の株の位置（保存はしない）：栽培スペースを1条あたりの株数で等分し、各区間の中央に株を置く。
   5株・2条・320〜410 → 1条目 335・365・395／2条目 335・365 */
function groupCenters(sp){
  if(!sp || sp.kind!=="group") return [];
  const n = Math.max(1, sp.n||1), rows = Math.max(1, sp.rows||1), per = Math.ceil(n / rows), w = (sp.to - sp.from) / per, out = [];
  for(let r=0, left=n; r<rows && left>0; r++){ const k = Math.min(per, left); for(let i=0;i<k;i++) out.push({ row:r+1, center: sp.from + w*(i+0.5) }); left -= k; }
  return out;
}
const hasExactSpots = p => Array.isArray(p.spots) && p.spots.some(sp=>sp.precision!=="slot");

/* スプレッドシートの spots 列（人が読める短い書き方）
   株170　群300-390×3　帯300-390　／ 修飾：/幅0-35 /終2026-08-01 /区画 */
function spotsText(p){
  if(!(Array.isArray(p.spots) && p.spots.length)) return p.spotsRaw ? String(p.spotsRaw) : "";
  return p.spots.map(sp=>{
    let t = sp.kind==="plant" ? `株${sp.center}${sp.space>0?`/間${sp.space}`:""}` : sp.kind==="group" ? `群${sp.from}-${sp.to}×${sp.n||1}${(sp.rows||1)>1?`/${sp.rows}条`:""}` : `帯${sp.from}-${sp.to}`;
    if(sp.crossFrom!=null && sp.crossTo!=null) t += `/幅${sp.crossFrom}-${sp.crossTo}`;
    if(sp.kind==="group" && sp.lost) t += `/減${sp.lost}`;
    if(sp.kind==="group") (sp.ended||[]).forEach(e=>{ t += `/終株${e.row}-${e.index}@${e.endDate}`; });
    if(sp.endDate) t += `/終${sp.endDate}`;
    if(sp.precision==="slot") t += "/区画";
    return t;
  }).join(" ");
}
function parseSpots(txt){
  const src = String(txt==null ? "" : txt).trim();
  if(!src) return { spots:null };
  const N = "(\\d+(?:\\.\\d+)?)", out = [];
  for(const tok of src.split(/\s+/)){
    const [head, ...mods] = tok.split("/"); let m, sp;
    if((m = head.match(new RegExp(`^株${N}$`)))) sp = { kind:"plant", center:+m[1] };
    else if((m = head.match(new RegExp(`^群${N}-${N}[×xX]${N}$`)))) sp = { kind:"group", from:+m[1], to:+m[2], n:Math.max(1, Math.round(+m[3])) };
    else if((m = head.match(new RegExp(`^帯${N}-${N}$`)))) sp = { kind:"band", from:+m[1], to:+m[2] };
    else return { error:tok };
    if(sp.kind!=="plant" && !(sp.to > sp.from)) return { error:tok };
    for(const md of mods){
      if((m = md.match(new RegExp(`^幅${N}-${N}$`))) && +m[2] > +m[1]){ sp.crossFrom = +m[1]; sp.crossTo = +m[2]; }
      else if((m = md.match(/^終(\d{4}-\d{2}-\d{2})$/))) sp.endDate = m[1];
      else if(md==="区画") sp.precision = "slot";
      else if((m = md.match(/^(\d)条$/)) && sp.kind==="group" && +m[1] >= 1) sp.rows = +m[1];
      else if((m = md.match(new RegExp(`^間${N}$`))) && sp.kind==="plant" && +m[1] > 0) sp.space = +m[1];
      else if((m = md.match(/^減(\d+)$/)) && sp.kind==="group") sp.lost = +m[1];
      else if((m = md.match(/^終株(\d+)-(\d+)@(\d{4}-\d{2}-\d{2})$/)) && sp.kind==="group") (sp.ended = sp.ended || []).push({ row:+m[1], index:+m[2], endDate:m[3] });
      else return { error:tok };
    }
    if(!sp.precision) sp.precision = "exact";
    out.push(sp);
  }
  return { spots:out };
}

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
  state.plantings.forEach(p=>{ if(!p.bedId) p.bedId = slotBed((p.slots||[])[0]); if(!Array.isArray(p.slots)) p.slots = []; });
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
      date:o.date, count:o.count||0, status:o.status, endDate:o.endDate||"", memo:o.memo||"", spots:spotsText(o), variety:o.variety||"" }, meta);
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
  return Object.assign({ id:"settings", value:JSON.stringify({seasonOffset:s.seasonOffset, cropOffset:s.cropOffset, myCrops:s.myCrops, myCropsTouched:s.myCropsTouched, beds:s.beds||{}}) }, meta);
}
function fromRow(table, r){
  const num = v => v===""||v==null ? 0 : Number(v);
  if(table==="plantings"){
    const o = { id:String(r.id), bedId:String(r.bedId||slotBed(String(r.slots))), slots:String(r.slots||"").split(",").filter(Boolean),
      cropId:String(r.cropId), date:String(r.date).slice(0,10), count:num(r.count), status:String(r.status||"active"),
      endDate:r.endDate?String(r.endDate).slice(0,10):undefined, memo:r.memo?String(r.memo):"", updatedAt:num(r.updatedAt), _v:num(r.version) };
    if("spots" in r){
      const ps = parseSpots(r.spots);
      if(ps.error) o.spotsRaw = String(r.spots);        // 読めない書き方：捨てずに残し、区画の位置で動かす
      else if(ps.spots) o.spots = ps.spots;
    }else o._noSpotsCol = true;                        // 古いスクリプト（spots列なし）
    if("variety" in r){ if(r.variety) o.variety = String(r.variety); }
    else o._noVarietyCol = true;
    return o;
  }
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
  if(table==="plantings" && o._noSpotsCol){         // 列がないシートから来た行で、端末側の位置を消さない
    delete o._noSpotsCol;
    if(i>=0){ if(arr[i].spots) o.spots = arr[i].spots; if(arr[i].spotsRaw) o.spotsRaw = arr[i].spotsRaw; }
  }
  if(table==="plantings" && o._noVarietyCol){
    delete o._noVarietyCol;
    if(i>=0 && arr[i].variety) o.variety = arr[i].variety;
  }
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
  state.sync.changeSeq = d.changeSeq||0; state.sync.lastPull = Date.now(); state.sync.schema = Number(d.schema)||4;
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
/* 区画 slot（1/4畝の範囲）と場所が重なる作付け。中身は位置（spots）で判定する */
function plantingsIn(slot, pred){ return plantingsAt(slotSpot(slot), slotBed(slot), pred); }
function intervalIn(p, slot){ return intervalAt(p, slotSpot(slot), slotBed(slot)); }
/* 今日の時点で区画にいる作付け（なければ次の予定） */
function occupantNow(slot){
  const t0 = today();
  const act = plantingsIn(slot, p=>p.status!=="done" && intervalIn(p, slot).to >= t0);
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
    const a = act[i], b = act[j], bed = bedOf(a);
    if(!bed || !bedOf(b) || bed.id!==bedOf(b).id) continue;
    const ea = expectedEnd(a), eb = expectedEnd(b), sa = bookingStart(a), sb = bookingStart(b);
    const shared = new Set();
    spotsOf(a).forEach(x=>spotsOf(b).forEach(y=>{
      if(!spotsClash(x, y, bed.id)) return;
      if(!overlaps({from:sa, to:spotEnd(a,x,ea)}, {from:sb, to:spotEnd(b,y,eb)})) return;
      const ax = spotAlong(x), ay = spotAlong(y), cut = { kind:"band", from:Math.max(ax.from, ay.from), to:Math.min(ax.to, ay.to) };
      slotsOf(bed.id).forEach(s=>{ if(rangeHit(spotAlong(slotSpot(s)), cut)) shared.add(s); });
    }));
    if(shared.size) out.push({ a, b, shared:[...shared].sort((m,n)=>slotIdx(m)-slotIdx(n)) });
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
/* 候補の位置（cands）ごとに、同じ畝で連作の範囲が重なる作付けを比べる。区画の候補は区画ごと、株の候補は株ごと */
function rotationCheckAt(cands, bedId, cropId, dateStr, ignoreId){
  const crop = cropById(cropId);
  const cand = candPlanting(cands, bedId, cropId, dateStr);
  const S = parseD(dateStr), E = expectedEnd(cand);
  const out = [];
  cands.forEach(mine=>{
    let worst = null;
    state.plantings.forEach(p=>{
      if(p.id===ignoreId) return;
      const b = bedOf(p); if(!b || b.id!==bedId) return;
      const c2 = cropById(p.cropId); if(!c2 || c2.family!==crop.family) return;
      const e = expectedEnd(p); let E2 = null;                // 連作の範囲が重なる位置のうち、一番遅い終わり
      spotsOf(p).forEach(sp=>{ if(spotsRotHit(mine, crop, sp, c2, bedId)){ const x = spotEnd(p, sp, e); if(!E2 || x > E2) E2 = x; } });
      if(!E2) return;
      const S2 = clockBase(p);
      let gap, rule, dir;
      if(E2 < S){ gap = diffD(S, E2); rule = rotationFor(crop); dir = "past"; }
      else if(E < S2){ gap = diffD(S2, E); rule = rotationFor(c2); dir = "future"; }
      else return;                                            // 期間が重なる → 場所の重複として別に扱う
      const y = gap / YEAR;
      const level = y < rule.minYears ? 2 : y < rule.maxYears ? 1 : 0;
      if(!level) return;
      const hit = { slot:mine.slot, label:spotLabel(mine), p, c2, S2, E2, gap, rule, dir, level };
      if(!worst || hit.level > worst.level || (hit.level===worst.level && hit.gap < worst.gap)) worst = hit;
    });
    if(worst) out.push(worst);
  });
  return out;
}
function rotationCheck(slots, cropId, dateStr, ignoreId){
  if(!slots || !slots.length) return [];
  return rotationCheckAt(slots.map(slotSpot), slotBed(slots[0]), cropId, dateStr, ignoreId);
}
function rotationText(h){
  const r = h.rule, need = y => Math.max(0, Math.round(y*YEAR) - h.gap);
  const lines = [];
  if(h.dir==="past") lines.push(`${h.label}：前作 <b>${esc(h.c2.name)}</b> ${h.p.status==="done"?"終了":"終了予定"} ${slash(h.E2)}`);
  else lines.push(`${h.label}：後作 <b>${esc(h.c2.name)}</b>（${slash(h.S2)} 予定）`);
  lines.push(`${h.dir==="past"?"経過":"間隔"} ${span(h.gap)}`);
  if(h.level===2) lines.push(`最低目安${r.minYears}年まであと${span(need(r.minYears))}`);
  else lines.push(`最低目安はクリア／十分な間隔${r.maxYears}年まであと${span(need(r.maxYears))}`);
  return lines.join("　");
}
/* 候補の作付け（計算用）。区画の候補は slots、畝の中の位置の候補は spots で持つ */
function candPlanting(cands, bedId, cropId, dateStr){
  const bySlot = cands.every(c=>c.slot);
  return bySlot ? { id:"__cand", cropId, bedId, date:dateStr, slots:cands.map(c=>c.slot), status:"active" }
                : { id:"__cand", cropId, bedId, date:dateStr, slots:[], spots:cands, status:"active" };
}
/* 株間：同じ時期に隣にいる株との距離（両方の株間が分かっているときだけ判定） */
function spacingIssues(sp, bedId, cropId, dateStr, ignoreId){
  if(sp.kind!=="plant") return [];
  const mine = spacingOf(cropById(cropId)); if(!mine) return [];
  const cand = interval(candPlanting([sp], bedId, cropId, dateStr)), out = [];
  state.plantings.forEach(p=>{
    if(p.id===ignoreId || p.status==="done") return;
    const b = bedOf(p); if(!b || b.id!==bedId) return;
    const other = spacingOf(cropById(p.cropId)); if(!other) return;
    const e = expectedEnd(p), sb = bookingStart(p);
    spotsOf(p).forEach(o=>{
      if(o.kind!=="plant" || o.precision!=="exact") return;
      if(!rangeHit(spotCross(sp,bedId), spotCross(o,bedId))) return;
      if(!overlaps(cand, {from:sb, to:spotEnd(p,o,e)})) return;
      const dist = Math.abs(o.center - sp.center);
      const need = p.cropId===cropId ? mine.min : Math.ceil((mine.min + other.min)/2);
      if(dist >= 2*PLANT_HALF && dist < need) out.push({ p, o, dist, need });
    });
  });
  return out;
}
/* 置く前の検査（区画でも畝の中の位置でも同じ） */
function checkAt(cands, bedId, cropId, dateStr, ignoreId){
  const out = [], crop = cropById(cropId);
  if(!crop || !cands || !cands.length || !dateStr) return out;
  const bed = bedById(bedId), d = parseD(dateStr), bySlot = cands.every(c=>c.slot);
  const candObj = candPlanting(cands, bedId, cropId, dateStr), cand = interval(candObj);

  /* 畝の外（寸法より外の位置） */
  if(!bySlot){
    const L = bedDims(bedId).lengthCm;
    const outside = cands.filter(sp=>sp.kind==="plant" ? (sp.center < 0 || sp.center > L) : (sp.from < 0 || sp.to > L));
    if(outside.length) out.push({level:"error", title:"畝の外です", text:`${esc(bed.name)}の長さは${L}cmです。${outside.map(spotLabel).join("・")}は畝の外になります。`});
  }
  /* 場所の重複（期間が重なる） */
  const clash = [];
  cands.forEach(sp=> plantingsAt(sp, bedId, p=>p.id!==ignoreId).forEach(p=>{
    const iv = intervalAt(p, sp, bedId); if(overlaps(cand, iv)) clash.push({sp, p, iv});
  }));
  if(clash.length){
    out.push({level:"error", title: bySlot ? "区画が使用中です" : "同じ場所に作物があります",
      text: clash.map(x=>`${spotLabel(x.sp)}は、その時期 <b>${esc(cropById(x.p.cropId).name)}</b>（${jp(x.iv.from)}〜${jp(x.iv.to)}${x.p.status==="done"?"":"予定"}）が使っています${spotsUnknown(x.p)?"（位置不明のため畝全体として扱っています）":""}`).join("<br>")
        + (bySlot ? "<br>日付をずらすか、別の区画を選んでください。" : "<br>少し動かすか、日付をずらしてください。")});
  }
  /* 株間（分かっているときだけ） */
  if(!bySlot){
    const iss = cands.flatMap(sp=>spacingIssues(sp, bedId, cropId, dateStr, ignoreId));
    if(iss.length) out.push({level:"amber", title:"株間が狭い",
      text: iss.map(x=>`<b>${esc(cropById(x.p.cropId).name)}</b>（${spotLabel(x.o)}）との間が${x.dist}cm。目安は${x.need}cm以上です。`).join("<br>")
        + `<br><span class="wsub">目安：${esc(crop.name)} ${esc(crop.start.spacing||"")}</span>`});
  }
  /* 連作（最も厳しい位置を全体の判定に） */
  const rot = rotationCheckAt(cands, bedId, cropId, dateStr, ignoreId);
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
    const hs = taskSchedule(candObj, crop, ht);
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
  const inWinter = bed.winterSun==="half" && winterDays(cand) >= WINTER.minDays;
  if(crop.winterSunRequired && inWinter)
    out.push({level:"amber", title:"日照注意", text:`${esc(bed.name)}は${esc(bed.note)}。${esc(crop.winterSunNote||"")}日当たりの良い畝を検討してください。`});
  if(crop.shadeOk && inWinter)
    out.push({level:"good", title:"この畝に向いています", text:`${esc(crop.name)}は半日陰でも育ちます。${esc(bed.name)}を使えば、日当たりの良い畝を他の作物に空けられます。`});
  return out;
}
function checkPlanting(slots, cropId, dateStr, ignoreId){
  if(!slots || !slots.length) return [];
  return checkAt(slots.map(slotSpot), slotBed(slots[0]), cropId, dateStr, ignoreId);
}
const blocking = ws => ws.some(w=>w.level==="error");
function slotFree(s, dateStr, cropId, ignoreId){
  const cand = interval({ id:"__cand", cropId, date:dateStr, slots:[s], status:"active" });
  return !plantingsIn(s, p=>p.id!==ignoreId).some(p=>overlaps(cand, intervalIn(p, s)));
}
function extendFrom(anchor, need, dateStr, cropId){
  const bed = slotBed(anchor), i0 = slotIdx(anchor);
  const free = i => i>=1 && i<=DIV && slotFree(bed+i, dateStr, cropId);
  const got = [i0]; let r = i0+1, l = i0-1;
  while(got.length < need && (free(r) || free(l))){ if(free(r)) got.push(r++); else got.push(l--); }
  return got.sort((a,b)=>a-b).map(i=>bed+i);
}
/* 置き場所の点数（小さいほど良い）。使用中は候補にしない
   連作の赤 100／黄色の注意 10／半日陰向き −5／冬を越す作物を冬に半日陰の畝へ置く 3（警告は出さない軽い後回し） */
const PLACE_W = { red:100, amber:10, good:-5, winterShade:3 };
function placeScore(slots, cropId, date){
  const crop = cropById(cropId), bed = bedById(slotBed(slots[0]));
  const ws = checkPlanting(slots, cropId, date);
  if(blocking(ws)) return null;
  let score = 0;
  ws.forEach(w=>{ score += PLACE_W[w.level] || 0; });
  const cand = interval({ id:"__cand", cropId, date, slots, status:"active" });
  if(!crop.shadeOk && !crop.winterSunRequired && bed.winterSun==="half" && winterDays(cand) >= WINTER.minDays) score += PLACE_W.winterShade;
  return { slots, score, ws };
}
/* 1つの畝の中で一番良い並び（必要な区画数が続けて空いている所） */
function bestInBed(bedId, cropId, date){
  const need = needOf(cropId); let best = null;
  for(let i=1;i<=DIV-need+1;i++){
    const slots = Array.from({length:need},(_,k)=>bedId+(i+k));
    if(slots.some(s=>!slotFree(s, date, cropId))) continue;
    const r = placeScore(slots, cropId, date);
    if(r && (!best || r.score < best.score)) best = r;
  }
  return best;
}
function placeReason(best, crop){
  const warn = best.ws.filter(w=>w.level==="red"||w.level==="amber");
  if(warn.length) return `注意のない場所が空いていないため、注意が一番軽い場所にしました（${warn.map(w=>w.title).join("・")}）。`;
  if(best.ws.some(w=>w.level==="good")) return `${crop.name}は半日陰でも育つので、日当たりの良い畝を他の作物に空けておけるこの畝にしました。`;
  const bed = bedById(slotBed(best.slots[0]));
  if(bed.winterSun!=="half" && (crop.winterSunRequired || best.winter)) return "冬を越す作物なので、冬も日当たりの良い畝から選びました。連作の注意もありません。";
  return "連作・日照・霜の注意がない場所です。";
}
function autoPlace(cropId, dateStr){
  const crop = cropById(cropId), date = dateStr || defaultDate(crop);
  let best = null;
  BEDS.forEach(b=>{ const r = bestInBed(b.id, cropId, date); if(r && (!best || r.score < best.score)) best = r; });
  if(!best) return null;
  best.winter = winterDays(interval({ id:"__cand", cropId, date, slots:best.slots, status:"active" })) >= WINTER.minDays;
  return { slots:best.slots, date, bed:slotBed(best.slots[0]), reason:placeReason(best, crop) };
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
    <span class="bed" data-b="${bed?bed.id:""}">${bed?bed.id:"?"}</span>
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
          <span class="bed" data-b="${bed.id}">${bed.id}</span>
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
  let h = `<div class="sect"><div class="sect-head"><h2>畝</h2><span class="count">タップして植える</span></div>`;
  BEDS.forEach(bed=>{
    const ps = state.plantings.filter(p=>p.status!=="done" && bedOf(p).id===bed.id && expectedEnd(p) >= t0).sort((a,b)=>a.date<b.date?-1:1);
    h += `<div class="card bedcard" data-b="${bed.id}">
      <div class="bedhead"><span class="bed" data-b="${bed.id}">${bed.id}</span><span class="bedname">${esc(bed.name)}</span><span class="bednote">${esc(bed.note)}</span></div>
      ${bedBarHtml(bed.id)}
      <div class="barfoot"><span class="hint">空いている所をタップして株を置く</span><span class="barbtns"><button class="btn small" data-act="seq-open" data-b="${bed.id}">左から順に登録</button><button class="btn small" data-act="place-open" data-b="${bed.id}">＋ 株を置く</button></span></div>
      <div class="label-s striplabel">区画でかんたん登録（1/4畝ずつ）</div>
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
          <span class="pname">${esc(c.name)}</span><span class="ptype">${posLabel(p)}</span>${posTags(p)}
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
        return `<button class="plantrow" data-act="planting" data-p="${p.id}"><span class="bed" data-b="${bedOf(p).id}" style="width:22px;height:22px;font-size:12px">${bedOf(p).id}</span>
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
  h += `<div class="sect"><div class="sect-head"><h2>畝の寸法</h2></div><div class="card">
    <div class="setrow"><div class="desc">だいたいの長さと幅（cm）。区画や、この先の「畝の中の位置」の計算に使います。あとから直せます。</div>
      <div class="bedgrid">${BEDS.map(b=>{ const d = bedDims(b.id);
        return `<div class="bedrow"><span class="bed" data-b="${b.id}">${b.id}</span>
          <label>長さ<input type="number" data-bedlen="${b.id}" value="${d.lengthCm}" min="50" max="5000" step="10" inputmode="numeric"></label>
          <label>幅<input type="number" data-bedwid="${b.id}" value="${d.widthCm}" min="20" max="500" step="5" inputmode="numeric"></label></div>`; }).join("")}</div>
      ${state.sync.url && (state.sync.schema||4) < 5 ? `<div class="desc" style="margin-top:8px">スプレッドシート側のスクリプト（Code.gs）が古い版です。今のままでも同期できますが、次の段階（畝の中に株を置く）の前に更新が必要です。</div>` : ""}</div>
  </div></div>`;
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
  document.querySelectorAll("[data-bedlen],[data-bedwid]").forEach(inp=>inp.addEventListener("change", ()=>{
    const id = inp.dataset.bedlen || inp.dataset.bedwid, key = inp.dataset.bedlen ? "lengthCm" : "widthCm";
    const lim = key==="lengthCm" ? [50,5000] : [20,500], v = Math.round(Number(inp.value));
    if(!(v >= lim[0] && v <= lim[1])){ inp.value = bedDims(id)[key]; toast(`${lim[0]}〜${lim[1]}cmで入れてください`); return; }
    if(key==="lengthCm"){
      const hit = state.plantings.filter(p=>p.status!=="done" && bedOf(p) && bedOf(p).id===id).flatMap(p=>spotsOutside(p, v).map(sp=>({p, sp})));
      if(hit.length && !confirm(`${bedById(id).name}を${v}cmにすると、${hit.length}件の配置が新しい長さを超えます（${hit.slice(0,3).map(x=>`${cropById(x.p.cropId).name} ${spotLabel(x.sp)}`).join("・")}${hit.length>3?"ほか":""}）。\n位置は動かしません。変更して、あとで位置を直しますか？`)){ inp.value = bedDims(id)[key]; return; }
    }
    const beds = JSON.parse(JSON.stringify(state.settings.beds||{}));
    beds[id] = Object.assign({}, bedDims(id), beds[id]||{}, {[key]:v});
    putSettings({beds}); renderAll(); toast(`${bedById(id).name}の${key==="lengthCm"?"長さ":"幅"}を${v}cmにしました`);
  }));
  document.querySelectorAll("[data-season]").forEach(inp=>inp.addEventListener("change", ()=>{
    const so = Object.assign({}, state.settings.seasonOffset); so[inp.dataset.season] = Math.max(-30,Math.min(30,parseInt(inp.value,10)||0));
    putSettings({seasonOffset:so}); renderAll();
  }));
}

/* =============================================================
   シート（下から出る画面）
   ============================================================= */
let sheetCtx = null, ps = null, pe = null, pp = null, sq = null;
function showSheet(h){ $("#sheet").innerHTML = h; $("#backdrop").hidden = false; $("#sheet").scrollTop = 0; }
function closeSheet(){ $("#backdrop").hidden = true; sheetCtx = null; ps = null; pe = null; pp = null; sq = null; es = null; }
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
    const rec = autoPlace(ps.cropId, ps.date);
    const bedTag = b => {
      const r = bestInBed(b.id, ps.cropId, ps.date);
      if(!r) return {cls:"none", text:"空きなし", off:true};
      if(rec && rec.bed===b.id) return {cls:"rec", text:"おすすめ"};
      if(r.ws.some(w=>w.level==="red")) return {cls:"red", text:"連作注意"};
      if(r.ws.some(w=>w.level==="amber")) return {cls:"amber", text:"注意あり"};
      return {cls:"", text:"空きあり"};
    };
    h = `<button class="linkback" data-act="ps-back">← 作物を選び直す</button>
      <h3>${esc(c.name)}を植える</h3>
      <div class="sheet-sub">適期 ${esc(junLabel(c.start.window))}（${esc(c.start.action)}）／${esc(c.start.spacing)}</div>
      <div class="label-s">畝</div>
      <div class="bedpick">${BEDS.map(b=>{ const t = bedTag(b), sel = b.id===ps.bed;
        return `<button class="bedopt${sel?" sel":""}" data-act="ps-bed" data-b="${b.id}" aria-pressed="${sel}"${t.off&&!sel?" disabled":""}>
          <span class="bed" data-b="${b.id}">${b.id}</span><span class="bo-name">${esc(b.name)}</span><span class="bo-note">${esc(b.note)}</span>
          <span class="bo-tag ${t.cls}">${t.text}</span></button>`; }).join("")}</div>
      ${rec && rec.bed===ps.bed && rec.slots.join()===ps.slots.slice().sort().join() ? `<div class="recwhy"><b>おすすめの理由</b>${esc(rec.reason)}</div>` : ""}
      <div class="label-s">${esc(bed.name)}の使う区画${need>1?`（目安 ${need}区画）`:""}</div>
      <div class="picker">${slotsOf(ps.bed).map(s=>{
        const free = slotFree(s, ps.date, ps.cropId), sel = ps.slots.includes(s);
        const o = !free ? plantingsIn(s).find(p=>overlaps(interval({id:"__c",cropId:ps.cropId,date:ps.date,slots:[s],status:"active"}), intervalIn(p, s))) : null;
        const oc = o ? cropById(o.cropId) : null;
        return `<button class="slot${sel?" sel":""}${oc?" occ":""}" data-act="ps-slot" data-s="${s}" aria-pressed="${sel}"${oc&&!sel?" disabled":""}>
          <span class="sidx">${ps.bed}-${slotIdx(s)}</span><span class="sname">${oc?esc(oc.name):sel?esc(c.name):"空き"}</span></button>`;
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

/* =============================================================
   畝のバー（畝の中の位置）と、株を置く
   ============================================================= */
const snapCm = x => Math.round(x / GRID) * GRID;
const iconOf = c => (c && c.icon) || (c ? c.name.slice(0,1) : "?");
function posLabel(p){
  if(spotsUnknown(p)) return "位置不明";
  if(!hasExactSpots(p)) return `区画${slotNums(p)}`;
  const pl = p.spots.filter(sp=>sp.kind==="plant").map(sp=>sp.center).sort((a,b)=>a-b);
  const other = p.spots.filter(sp=>sp.kind!=="plant").map(sp=>`${sp.from}〜${sp.to}`);
  return `左から${pl.concat(other).join("・")}cm`;
}
function posTags(p){
  if(spotsUnknown(p)) return `<span class="tag red">位置不明</span>`;
  if(spotsOutside(p).length) return `<span class="tag red">畝の外</span>`;
  return "";
}
function posWarnHtml(p){
  let h = "";
  if(spotsUnknown(p)) h += `<div class="warn"><span class="wt">位置情報を読み取れませんでした</span>元データ（<code>${esc(p.spotsRaw)}</code>）は保持しています。読めない間は、この作付けが${esc(bedOf(p).name)}全体を使っているものとして扱い、ほかの作物を勧めません。スプレッドシートの spots 列を直すと戻ります。</div>`;
  const out = spotsOutside(p);
  if(out.length) h += `<div class="warn"><span class="wt">畝の外の位置があります</span>${esc(bedOf(p).name)}の長さ（${bedDims(bedOf(p).id).lengthCm}cm）を超えています：${out.map(spotLabel).join("・")}。位置は自動では動かしていません。</div>`;
  return h;
}
/* バーに出すもの：終わっていない作付けの、まだ終わっていない位置 */
function barItems(bedId){
  const t0 = today(), out = [];
  state.plantings.forEach(p=>{
    const b = bedOf(p); if(!b || b.id!==bedId || p.status==="done") return;
    const c = cropById(p.cropId); if(!c) return;
    const e = expectedEnd(p), planned = bookingStart(p) > t0;
    spotsOf(p).forEach((sp,i)=>{ if(spotEnd(p, sp, e) >= t0) out.push({p, c, sp, i, planned}); });
  });
  return out;
}
function bedBarHtml(bedId, opt){
  opt = opt || {};
  const L = bedDims(bedId).lengthCm, pc = x => Math.max(0, Math.min(100, x / L * 100));
  const items = barItems(bedId);
  let h = "";
  for(let m=100; m<L; m+=100) h += `<i class="bb-tick" style="left:${pc(m)}%"></i>`;
  items.filter(x=>x.sp.kind!=="plant").forEach(x=>{
    const a = pc(x.sp.from), w = Math.max(0.5, pc(x.sp.to) - a), exact = x.sp.precision==="exact";
    const cls = x.sp.precision==="slot" ? " slot" : x.sp.precision==="unknown" ? " unk" : x.sp.kind==="group" ? " grp" : "";
    const label = x.sp.precision==="unknown" ? "位置不明："+x.c.name : x.sp.kind==="group" ? `${iconOf(x.c)}×${aliveOf(x.sp)<(x.sp.n||1)?`${aliveOf(x.sp)}/`:""}${x.sp.n||1}` : x.c.name;
    const act = opt.mini ? "" : exact ? `data-act="spot" data-p="${x.p.id}" data-i="${x.i}" role="button" aria-label="${esc(x.c.name)} ${esc(spotLabel(x.sp))}"` : `data-act="planting" data-p="${x.p.id}"`;
    h += `<span class="bb-band${cls}${x.planned?" plan":""}" ${act} style="left:${a}%;width:${w}%" title="${esc(x.c.name)}"><span>${esc(label)}</span></span>`;
  });
  items.filter(x=>x.sp.kind==="plant").forEach(x=>{
    const out = x.sp.center > L || x.sp.center < 0;
    const tag = opt.mini ? "span" : "button";
    h += `<${tag} class="bb-plant${x.planned?" plan":""}${out?" out":""}" ${opt.mini?"":`data-act="spot" data-p="${x.p.id}" data-i="${x.i}" aria-label="${esc(x.c.name)} 左から${x.sp.center}cm"`} style="left:${out?(x.sp.center<0?0:100):pc(x.sp.center)}%">${esc(iconOf(x.c))}</${tag}>`;
  });
  (opt.cands||[]).forEach(cd=>{
    const cs = cd.spot, out = cs.kind==="plant" ? cs.center > L : cs.to > L;
    if(cs.kind==="plant") h += `<span class="bb-plant cand soft${out?" out":""}" style="left:${pc(cs.center)}%">${esc(iconOf(cd.crop))}</span>`;
    else { const a = pc(cs.from), w = Math.max(0.5, pc(cs.to) - a); h += `<span class="bb-band cand soft" style="left:${a}%;width:${w}%"><span>${esc(cd.crop.name)}</span></span>`; }
  });
  if(opt.cand){
    const cs = opt.cand.spot;
    if(cs.kind==="plant") h += `<span class="bb-plant cand" style="left:${pc(cs.center)}%">${esc(iconOf(opt.cand.crop))}</span>`;
    else { const a = pc(cs.from), w = Math.max(0.5, pc(cs.to) - a);
      h += `<span class="bb-band cand" style="left:${a}%;width:${w}%"><span>${esc(cs.kind==="group" ? `${iconOf(opt.cand.crop)}×${cs.n}` : opt.cand.crop.name)}</span></span>`; }
  }
  const scale = `<div class="bb-scale"><span>0</span><span>${(L/200).toFixed(L%200?2:0).replace(/\.?0+$/,"")}m</span><span>${(L/100).toFixed(L%100?1:0)}m</span></div>`;
  return `<div class="bedbar${opt.mini?" mini":""}" data-b="${bedId}" ${opt.mini?"":`data-act="bar" role="button" aria-label="${esc(bedById(bedId).name)}：タップした場所に株を置く"`}>${h}</div>${scale}`;
}

/* ---------- 株・まとまり・帯を置く（空いている所・株の左右） ----------
   位置の初期値のきまり（株間が分からないものを、分かっていることにしない）
   ・両方の株間が分かる → 平均（同じ作物ならその株間）
   ・片方だけ分かる     → 分かっている側の株間を初期距離に使い「株間は要確認」と出す
   ・両方分からない     → 重ならない最小の距離に「仮置き」するだけ（推奨の距離とは言わない）
   タップした場所があれば、そこを初期位置にする（位置の指定がないときだけ左から探す） */
const KIND_LABEL = { plant:"株", group:"まとまり", band:"帯" };
const kindsFor = c => layoutOf(c)==="band" ? ["band"] : ["plant","group","band"];
const BAND_DEFAULT = 100, GROUP_DEFAULT_N = 3, LEN_STEP = 10;
function openPlace(bedId, x, anchor){
  pp = { bed:bedId, x0:x, anchor, cropId:null, kind:"plant", date:null, add:null, variety:"", startDone:false,
         x:x, from:0, len:BAND_DEFAULT, n:GROUP_DEFAULT_N, rows:1, count:"", note:"" };
  renderPlaceSheet();
}
/* 同じ栽培のまとまり（作付け）に追加できるか：作物・畝・開始日・品種がすべて同じ、畝の中の位置で置いた作付けだけ */
function startDateOf(p){ const a = actualStart(p); return a ? fmtD(a) : p.date; }
function batchesFor(bedId, cropId, date, variety){
  return state.plantings.filter(p=>p.status!=="done" && p.cropId===cropId && bedOf(p) && bedOf(p).id===bedId
    && hasExactSpots(p) && !(p.slots||[]).length && startDateOf(p)===date && (p.variety||"").trim()===(variety||"").trim());
}
function latestBatch(bedId, cropId){
  return state.plantings.filter(p=>p.status!=="done" && p.cropId===cropId && bedOf(p) && bedOf(p).id===bedId && hasExactSpots(p) && !(p.slots||[]).length)
    .sort((a,b)=>a.date<b.date?1:-1)[0] || null;
}
/* 株の位置。置いたときの株間（推奨）をスナップショットとして持たせる */
function plantSpot(x, cropId){
  const sp = { kind:"plant", center:x, precision:"exact" };
  const sc = cropId ? spacingOf(cropById(cropId)) : null; if(sc) sp.space = sc.preferred;
  return sp;
}
function ppSpot(){
  if(pp.kind==="plant"){ const sp = plantSpot(pp.x, pp.cropId); if(pp.edit && pp.keepSpace) sp.space = pp.keepSpace; if(pp.edit && !pp.keepSpace) delete sp.space; return sp; }
  const sp = { kind:pp.kind, from:pp.from, to:pp.from + pp.len, precision:"exact" };
  if(pp.kind==="group"){ sp.n = pp.n; sp.rows = pp.rows; }
  return sp;
}
const addWhat = () => pp.kind==="plant" ? "1株" : pp.kind==="group" ? `${pp.n}株` : "帯を";
const ppRange = () => pp.kind==="plant" ? {from:pp.x, to:pp.x} : {from:pp.from, to:pp.from + pp.len};
/* まとまりの長さ：株間が分かれば 株数÷条数（切り上げ）×株間。分からなければ決めない（null） */
function groupLen(c, n, rows){ const sc = spacingOf(c); return sc ? Math.ceil(n / Math.max(1, rows)) * sc.min : null; }
const roundUp = v => Math.ceil(v / GRID) * GRID;
function anchorSpot(){ const a = pp.anchor && state.plantings.find(p=>p.id===pp.anchor.pid); return a ? { p:a, sp:spotsOf(a)[pp.anchor.i], c:cropById(a.cropId) } : null; }
/* 隣に置くときの開始位置（株なら中心、まとまり・帯なら左端）。prev＝隣の位置 {sp, cropId}
   株と株：両方の株間が分かれば平均（同じ作物ならその株間）／片方だけなら分かる側の株間＋「要確認」／どちらも不明なら「仮置き」
   株の隣にまとまり・帯：その株の株間の半分をあける／まとまり・帯の隣に株：置く株の株間の半分をあける／まとまり・帯どうし：接する */
function adjacentStart(prev, cropId, kind, len, right){
  const c = cropById(cropId), pc = cropById(prev.cropId), mine = spacingOf(c), theirs = spacingOf(pc), P = prev.sp;
  let start, note = "";
  if(P.kind==="plant" && kind==="plant"){
    let dist;
    if(mine && theirs) dist = roundUp(prev.cropId===cropId ? mine.min : (mine.min + theirs.min)/2);
    else if(mine || theirs){ dist = roundUp((mine||theirs).min); note = `株間は要確認（${esc((!mine?c:pc).name)}の株間の目安なし）。${esc((mine?c:pc).name)}の株間を初期の距離にしています。`; }
    else { dist = 2*PLANT_HALF; note = "仮置き：どちらも株間の目安がないため、距離は決めていません。位置を確認してください。"; }
    start = P.center + (right ? dist : -dist);
  }else if(P.kind==="plant"){
    const half = theirs ? roundUp(theirs.min/2) : PLANT_HALF;
    if(!theirs) note = `仮置き：${esc(pc.name)}の株間の目安がないため、間隔は決めていません。位置を確認してください。`;
    start = right ? P.center + half : P.center - half - len;
  }else if(kind==="plant"){
    const half = mine ? roundUp(mine.min/2) : PLANT_HALF;
    if(!mine) note = `仮置き：${esc(c.name)}の株間の目安がないため、間隔は決めていません。位置を確認してください。`;
    start = right ? P.to + half : P.from - half;
  }else start = right ? P.to : P.from - len;
  return { start: snapCm(start), note };
}
/* 初期位置 */
function placeInitial(){
  const c = cropById(pp.cropId), L = bedDims(pp.bed).lengthCm, date = pp.date;
  const errs = () => checkAt([ppSpot()], pp.bed, pp.cropId, date).some(w=>w.level==="error");
  const inBed = () => { const r = ppRange(); return r.from >= 0 && r.to <= L; };
  const setAt = v => { if(pp.kind==="plant") pp.x = v; else pp.from = v; };
  const cur = () => pp.kind==="plant" ? pp.x : pp.from;
  pp.note = "";
  const A = anchorSpot();
  if(A && A.sp){
    const right = pp.anchor.side!=="left";
    const adj = adjacentStart({ sp:A.sp, cropId:A.p.cropId }, pp.cropId, pp.kind, pp.len, right);
    const start = adj.start; pp.note = adj.note;
    setAt(snapCm(start));
    for(let k=0; k<200 && (errs() || !inBed()); k++){ setAt(cur() + (right ? GRID : -GRID)); if(!inBed()) break; }
    if(!inBed()) setAt(snapCm(start));
    return;
  }
  if(pp.x0!=null){                                            // タップした所を初期位置に（まとまり・帯はその所を中心に）
    if(pp.kind==="plant") pp.x = pp.x0;
    else pp.from = Math.max(0, Math.min(L - pp.len, snapCm(pp.x0 - pp.len/2)));
    return;
  }
  const tight = () => pp.kind==="plant" && spacingIssues(ppSpot(), pp.bed, pp.cropId, date).length > 0;
  let fb = null;                                               // 左から、重ならず株間も足りる所 → なければ重ならない所
  const sc0 = spacingOf(c), v0 = pp.kind==="plant" ? (sc0 ? roundUp(sc0.min/2) : PLANT_HALF) : 0;   // 株は畝の端から株間の半分あける
  for(let v=v0; v<=L; v+=GRID){ setAt(v); if(!inBed()) break; if(!errs()){ if(!tight()) return; if(fb==null) fb = v; } }
  setAt(fb!=null ? fb : 0);
}
function setKind(kind){
  const c = cropById(pp.cropId);
  pp.kind = kind;
  if(kind==="group"){ pp.rows = c.rows || 1; const g = groupLen(c, pp.n, pp.rows); pp.len = g || 50; }
  if(kind==="band") pp.len = BAND_DEFAULT;
  placeInitial();
}
function placeChoose(cropId){
  const c = cropById(cropId); pp.cropId = cropId;
  const lb = latestBatch(pp.bed, cropId);
  pp.date = lb ? startDateOf(lb) : defaultDate(c);
  pp.variety = lb ? (lb.variety||"") : "";
  pp.startDone = parseD(pp.date) < today();
  pp.n = GROUP_DEFAULT_N; pp.count = "";
  setKind(kindsFor(c)[0]);
  const bs = batchesFor(pp.bed, cropId, pp.date, pp.variety);
  pp.add = bs.length ? bs[0].id : null;
  renderPlaceSheet(); $("#sheet").scrollTop = 0;
}
function ppSync(){
  if(!pp || !pp.cropId) return;
  const di = $("#pp-date"), vi = $("#pp-variety"), ci = $("#pp-count"), ad = document.querySelector('input[name="pp-add"]:checked'), st = document.querySelector('input[name="pp-start"]:checked');
  if(di && di.value) pp.date = di.value;
  if(vi) pp.variety = vi.value;
  if(ci) pp.count = ci.value;
  if(ad) pp.add = ad.value || null;
  if(st) pp.startDone = st.value==="1";
}
function ppAdjust(what, v){
  const c = cropById(pp.cropId);
  if(what==="move"){ if(pp.kind==="plant") pp.x += v; else pp.from += v; }
  if(what==="len") pp.len = Math.max(LEN_STEP, pp.len + v);
  if(what==="n"){ pp.n = Math.max(1, pp.n + v); const g = groupLen(c, pp.n, pp.rows); if(g) pp.len = g; }
  if(what==="rows"){ pp.rows = v; const g = groupLen(c, pp.n, pp.rows); if(g) pp.len = g; }
}
function scriptTooOld(){ return !!state.sync.url && (state.sync.schema||4) < 5; }
/* 両隣：候補の範囲の端から、いちばん近い作物の端まで */
function neighborsOf(r){
  let L = null, R = null;
  barItems(pp.bed).forEach(x=>{
    const a = x.sp.kind==="plant" ? x.sp.center : x.sp.from, b = x.sp.kind==="plant" ? x.sp.center : x.sp.to;
    if(b <= r.from && (!L || r.from - b < L.d)) L = { name:x.c.name, d:r.from - b };
    if(a >= r.to && (!R || a - r.to < R.d)) R = { name:x.c.name, d:a - r.to };
  });
  return { L, R };
}
function renderPlaceSheet(){
  if(pp.edit) return renderEditSheet();
  const bed = bedById(pp.bed), L = bedDims(pp.bed).lengthCm;
  let h = "";
  const A = anchorSpot();
  const where = A ? `${A.c.name}の${pp.anchor.side==="left"?"左":"右"}` : pp.x0!=null ? `左から${pp.x0}cm付近` : "空いている所";
  if(!pp.cropId){
    const my = (state.settings.myCrops||[]).length ? state.settings.myCrops : DATA.crops.map(c=>c.id);
    const order = {optimal:0, late:1, upcoming:2, offSeason:3};
    const rows = my.map(cropById).filter(Boolean).map(c=>({c, st:seasonStatus(c)})).sort((a,b)=>order[a.st.state]-order[b.st.state]);
    h = `<h3>${esc(bed.name)}・${esc(where)}に植える</h3>
      <div class="sheet-sub">作物を選ぶと、株・まとまり・帯を選べます。</div>
      <div class="croplist">${rows.map(r=>{ const sc = spacingOf(r.c);
        return `<button class="croprow" data-act="pp-crop" data-c="${r.c.id}">
        <span class="crname">${esc(iconOf(r.c))} ${esc(r.c.name)}</span>
        <span class="crtags">${layoutOf(r.c)==="band" ? `<span class="tag">帯</span>` : sc ? `<span class="tag">株間${sc.min}cm〜</span>` : `<span class="tag">株間の目安なし</span>`}</span>
        <span class="crwhen">${statusChip(r.st)}</span></button>`; }).join("")}</div>
      <div class="sheet-foot"><button class="btn" data-act="close">閉じる</button></div>`;
    showSheet(h); return;
  }
  const c = cropById(pp.cropId), sc = spacingOf(c), sp = ppSpot(), r = ppRange();
  const bs = batchesFor(pp.bed, pp.cropId, pp.date, pp.variety);
  if(pp.add && !bs.some(b=>b.id===pp.add)) pp.add = null;
  const batch = pp.add ? state.plantings.find(p=>p.id===pp.add) : null;
  const date = batch ? startDateOf(batch) : pp.date;
  const ws = checkAt([sp], pp.bed, pp.cropId, date);
  const old = scriptTooOld(), nb = neighborsOf(r);
  const kinds = kindsFor(c), gUnknown = pp.kind==="group" && !groupLen(c, pp.n, pp.rows);
  const posText = pp.kind==="plant" ? `左から${pp.x}cm` : `左から${pp.from}〜${pp.from+pp.len}cm（${pp.len}cm）`;
  h = `<button class="linkback" data-act="pp-back">← 作物を選び直す</button>
    <h3>${esc(iconOf(c))} ${esc(c.name)}を置く</h3>
    <div class="sheet-sub">${esc(bed.name)}（${L}cm）／${sc ? `株間の目安 ${sc.min}cm${sc.preferred!==sc.min?`〜${sc.preferred}cm`:""}` : "株間の目安なし"}（${esc(c.start.spacing||"")}）</div>
    ${kinds.length>1 ? `<div class="kindchips" role="radiogroup" aria-label="植え方">${kinds.map(k=>`<button class="chip${pp.kind===k?" sel":""}" data-act="pp-kind" data-k="${k}" aria-pressed="${pp.kind===k}">${KIND_LABEL[k]}</button>`).join("")}</div>` : `<div class="hint" style="margin-top:6px">すじまき・帯で置く作物です。</div>`}
    ${bedBarHtml(pp.bed, {mini:true, cand:{spot:sp, crop:c}})}
    <div class="posrow">
      <button class="btn" data-act="pp-adj" data-w="move" data-v="-${GRID}" aria-label="左へ${GRID}cm">◀</button>
      <div class="posval"><b>${posText}</b><span>${nb.L?`左の${esc(nb.L.name)}まで${nb.L.d}cm`:"左は空き"}／${nb.R?`右の${esc(nb.R.name)}まで${nb.R.d}cm`:"右は空き"}</span></div>
      <button class="btn" data-act="pp-adj" data-w="move" data-v="${GRID}" aria-label="右へ${GRID}cm">▶</button>
    </div>
    ${pp.kind==="group" ? `<div class="sizerow"><span class="lbl">株数</span>
        <button class="btn" data-act="pp-adj" data-w="n" data-v="-1" aria-label="1株へらす">−</button><b>${pp.n}株</b><button class="btn" data-act="pp-adj" data-w="n" data-v="1" aria-label="1株ふやす">＋</button>
        <span class="lbl">条</span>${[1,2].map(k=>`<button class="chip${pp.rows===k?" sel":""}" data-act="pp-adj" data-w="rows" data-v="${k}">${k}条</button>`).join("")}</div>
      ${gUnknown ? `<div class="sizerow"><span class="lbl">長さ</span><button class="btn" data-act="pp-adj" data-w="len" data-v="-${LEN_STEP}">−</button><b>${pp.len}cm</b><button class="btn" data-act="pp-adj" data-w="len" data-v="${LEN_STEP}">＋</button></div>
        <div class="hint">株間の目安がないため、長さは決めていません（仮の長さ）。実際に合わせてください。</div>`
        : `<div class="hint">長さ ${pp.len}cm（${pp.n}株÷${pp.rows}条×株間${sc.min}cm）</div>`}` : ""}
    ${pp.kind==="band" ? `<div class="sizerow"><span class="lbl">長さ</span><button class="btn" data-act="pp-adj" data-w="len" data-v="-${LEN_STEP}" aria-label="${LEN_STEP}cm短く">−</button><b>${pp.len}cm</b><button class="btn" data-act="pp-adj" data-w="len" data-v="${LEN_STEP}" aria-label="${LEN_STEP}cm長く">＋</button></div>` : ""}
    ${pp.note ? `<div class="warn note"><span class="wt">位置の確認</span>${pp.note}</div>` : ""}
    ${bs.length ? `<div class="label-s">どの作付けにするか</div><div class="startchoice" role="radiogroup">
      ${bs.map(b=>`<label><input type="radio" name="pp-add" value="${b.id}"${pp.add===b.id?" checked":""}> ${esc(c.name)}（${jp(parseD(startDateOf(b)))}${b.variety?`・${esc(b.variety)}`:""}・${b.count}株）に${addWhat()}追加</label>`).join("")}
      <label><input type="radio" name="pp-add" value=""${pp.add?"":" checked"}> 新しい作付けにする</label></div>` : ""}
    ${pp.kind==="band" ? `<div class="field" style="margin-top:8px"><label for="pp-count">株数・本数（任意）</label><input type="number" id="pp-count" min="0" value="${esc(String(pp.count))}" inputmode="numeric"></div>` : ""}
    ${batch ? `<div class="hint" style="margin-top:6px">追加する分は、この作付けの${esc(c.start.action)}日・品種・やることをそのまま使います。</div>` : `
    <div class="row2">
      <div class="field"><label for="pp-date">${esc(c.start.action)}日</label><input type="date" id="pp-date" value="${pp.date}"></div>
      <div class="field"><label for="pp-variety">品種（任意）</label><input type="text" id="pp-variety" value="${esc(pp.variety)}" placeholder="例：桃太郎" autocomplete="off"></div>
    </div>
    ${parseD(pp.date) <= today() ? `<div class="startchoice" role="radiogroup" aria-label="${esc(c.start.action)}の状況">
      <label><input type="radio" name="pp-start" value="0"${pp.startDone?"":" checked"}> これから${verbOf(c).now}</label>
      <label><input type="radio" name="pp-start" value="1"${pp.startDone?" checked":""}> もう${verbOf(c).past}（${jp(parseD(pp.date))}）</label></div>` : ""}`}
    ${old ? `<div class="warn"><span class="wt">スクリプトの更新が必要です</span>畝の中に置くには、スプレッドシート側の Code.gs を v5 に更新してください（README「11」）。更新前に置くと、位置がシートに残りません。</div>` : ""}
    ${warnHtml(ws)}
    <div class="sheet-foot"><button class="btn" data-act="close">やめる</button>
      <button class="btn primary" data-act="pp-save"${!old && !blocking(ws) ? "" : " disabled"}>${batch?`${addWhat()}追加する`:"置く"}</button></div>`;
  showSheet(h);
  const rebatch = ()=>{ ppSync(); pp.add = null; const b2 = batchesFor(pp.bed, pp.cropId, pp.date, pp.variety); if(b2.length) pp.add = b2[0].id; renderPlaceSheet(); };
  const di = $("#pp-date"); if(di) di.addEventListener("change", ()=>{ ppSync(); pp.startDone = parseD(pp.date) < today(); rebatch(); });
  const vi = $("#pp-variety"); if(vi) vi.addEventListener("change", rebatch);
  const ci = $("#pp-count"); if(ci) ci.addEventListener("change", ()=>ppSync());
  document.querySelectorAll('input[name="pp-add"]').forEach(x=>x.addEventListener("change", ()=>{ ppSync(); renderPlaceSheet(); }));
  document.querySelectorAll('input[name="pp-start"]').forEach(x=>x.addEventListener("change", ()=>ppSync()));
}
function savePlace(){
  if(pp && pp.edit){ if(!scriptTooOld()) saveEdit(); return; }
  if(!pp || !pp.cropId || scriptTooOld()) return;
  ppSync();
  const c = cropById(pp.cropId), batch = pp.add ? state.plantings.find(p=>p.id===pp.add) : null;
  const date = batch ? startDateOf(batch) : pp.date, sp = ppSpot();
  const ws = checkAt([sp], pp.bed, pp.cropId, date);
  if(blocking(ws)) return;
  const warn = ws.filter(w=>w.level==="red"||w.level==="amber");
  if(warn.length && !confirm(warn.map(w=>w.title).join("・")+"があります。このまま置きますか？")) return;
  if(state.sample){ state.plantings = []; state.logs = []; state.sample = false; }
  const n = sp.kind==="plant" ? 1 : sp.kind==="group" ? sp.n : Math.max(0, parseInt(pp.count,10) || 0);
  if(batch){
    batch.spots = batch.spots.concat([sp]).sort((a,b)=>(a.center??a.from)-(b.center??b.from));
    batch.count = (batch.count||0) + n;
    putPlanting(batch);
  }else{
    const pid = uid("p");
    putPlanting({ id:pid, bedId:pp.bed, slots:[], spots:[sp], cropId:pp.cropId, date:pp.date, count:n, status:"active", memo:"", variety:(pp.variety||"").trim() || undefined });
    const st = startTaskOf(c);
    if(st && pp.startDone && parseD(pp.date) <= today()) putLog({id:uid("l"), plantingId:pid, taskId:st.id, date:pp.date, type:"work"});
  }
  const what = sp.kind==="plant" ? "1株" : sp.kind==="group" ? `${sp.n}株のまとまり` : "帯";
  const msg = `${c.name}の${what}を${batch?"追加":"置き"}ました（${spotLabel(sp)}）`;
  closeSheet(); renderAll(); toast(msg);
}
/* 置いた位置をタップ：左右に植える・作付けを開く */
function openSpot(pid, i){
  const p = state.plantings.find(x=>x.id===pid); if(!p) return;
  const c = cropById(p.cropId), sp = spotsOf(p)[i]; if(!sp) return;
  const what = sp.kind==="plant" ? "" : sp.kind==="group" ? `×${sp.n}${(sp.rows||1)>1?`・${sp.rows}条`:""}${aliveOf(sp)<(sp.n||1)?`（生育中${aliveOf(sp)}）`:""}` : "（帯）";
  showSheet(`<h3>${esc(iconOf(c))} ${esc(c.name)}${what}（${esc(spotLabel(sp))}）</h3>
    <div class="sheet-sub">${esc(bedOf(p).name)}・${jp(parseD(startDateOf(p)))}${p.variety?`・${esc(p.variety)}`:""}・この作付けは${p.count}株</div>
    <div class="sidebtns">
      <button class="btn" data-act="spot-side" data-p="${p.id}" data-i="${i}" data-side="left">◀ 左に植える</button>
      <button class="btn" data-act="spot-side" data-p="${p.id}" data-i="${i}" data-side="right">右に植える ▶</button>
    </div>
    ${sp.precision==="exact" && !sp.endDate ? (sp.kind==="group"
      ? `<div class="label-s">枯れた・抜いた・収穫が終わった</div><div class="sidebtns"><button class="btn" data-act="end-open" data-p="${p.id}" data-i="${i}" data-m="lost">1株減った（どれか不明）</button><button class="btn" data-act="end-open" data-p="${p.id}" data-i="${i}" data-m="pick">株を選んで終える</button></div>`
      : `<div class="label-s">枯れた・抜いた・収穫が終わった</div><div class="sidebtns one"><button class="btn" data-act="end-open" data-p="${p.id}" data-i="${i}" data-m="spot">${sp.kind==="band"?"この帯を終える":"この株を終える"}</button></div>`) : ""}
    ${sp.precision==="exact" ? `<div class="label-s">置き間違いの修正</div><div class="sidebtns"><button class="btn" data-act="spot-edit" data-p="${p.id}" data-i="${i}">位置を直す</button><button class="btn ghost" data-act="spot-del" data-p="${p.id}" data-i="${i}">この位置を消す</button></div>` : ""}
    <div class="sheet-foot"><button class="btn" data-act="planting" data-p="${p.id}">作付けを開く</button><button class="btn" data-act="close">閉じる</button></div>`);
}

/* ---------- 左から順に登録（植えた順に作物をタップしていく） ----------
   株の作物は1株ずつ、帯の作物は1mの帯を、前のものの右に「隣に置くときのきまり」で並べる。
   同じ作物は同じ作付けにまとめる（同じ畝・同じ日・品種なしの作付けがすでにあれば、そこへ追加。外すこともできる） */
function openSeq(bedId){
  sq = { bed:bedId, date:fmtD(today()), startDone:true, items:[], join:true, variety:{} };
  renderSeqSheet(true);
}
function seqPrev(){
  let best = null;
  barItems(sq.bed).forEach(x=>{ const r = x.sp.kind==="plant" ? x.sp.center : x.sp.to; if(!best || r > best.r) best = { r, sp:x.sp, cropId:x.p.cropId }; });
  return best;
}
function seqLayout(){
  const L = bedDims(sq.bed).lengthCm, out = [];
  let prev = seqPrev();
  sq.items.forEach(it=>{
    const c = cropById(it), kind = layoutOf(c)==="band" ? "band" : "plant", len = BAND_DEFAULT;
    let start, note = "";
    if(prev){ const a = adjacentStart(prev, it, kind, len, true); start = a.start; note = a.note; }
    else { const sc = spacingOf(c); start = kind==="plant" ? (sc ? roundUp(sc.min/2) : PLANT_HALF) : 0; if(kind==="plant" && !sc) note = "仮置き：株間の目安がないため、位置を確認してください。"; }
    const sp = kind==="plant" ? plantSpot(start, it) : { kind:"band", from:start, to:start+len, precision:"exact" };
    out.push({ cropId:it, crop:c, sp, note, over: kind==="plant" ? (start > L) : (start + len > L) });
    prev = { sp, cropId:it };
  });
  return out;
}
/* 作物ごとの登録の予定（既存の作付けに追加 or 新しい作付け） */
function seqPlan(lay){
  const by = {};
  lay.forEach(x=>{ (by[x.cropId] = by[x.cropId] || { cropId:x.cropId, crop:x.crop, spots:[] }).spots.push(x.sp); });
  return Object.values(by).map(g=>{
    const n = g.spots.filter(s=>s.kind==="plant").length;
    const variety = (sq.variety[g.cropId]||"").trim();
    const batch = sq.join ? batchesFor(sq.bed, g.cropId, sq.date, variety)[0] || null : null;
    return Object.assign(g, { n, batch, variety });
  });
}
function renderSeqSheet(top){
  const bed = bedById(sq.bed), L = bedDims(sq.bed).lengthCm, lay = seqLayout(), plan = seqPlan(lay);
  const my = ((state.settings.myCrops||[]).length ? state.settings.myCrops : DATA.crops.map(c=>c.id)).map(cropById).filter(Boolean);
  const errs = [], warns = [], notes = [];
  lay.forEach(x=>{
    if(x.over) errs.push(`${esc(x.crop.name)}（${esc(spotLabel(x.sp))}）が畝の長さ（${L}cm）を超えます`);
    checkAt([x.sp], sq.bed, x.cropId, sq.date).forEach(w=>{
      if(w.level==="error") errs.push(`${esc(x.crop.name)}（${esc(spotLabel(x.sp))}）：${esc(w.title)}`);
      else if(w.level==="red" || w.level==="amber") warns.push(`${esc(x.crop.name)}：${esc(w.title)}`);
    });
    if(x.note) notes.push(`${esc(x.crop.name)}（${esc(spotLabel(x.sp))}）：${x.note}`);
  });
  const uniq = a => [...new Set(a)];
  const old = scriptTooOld(), total = lay.filter(x=>x.sp.kind==="plant").length;
  const last = lay[lay.length-1], used = last ? (last.sp.kind==="plant" ? last.sp.center : last.sp.to) : 0;
  const h = `<h3>${esc(bed.name)}：左から順に登録</h3>
    <div class="sheet-sub">植えた順に作物をタップします。株の作物は1株ずつ、すじまきの作物は1mの帯を、前の右に並べます（あとで位置を直せます）。</div>
    <div class="row2">
      <div class="field"><label for="sq-date">植えた日（まいた日）</label><input type="date" id="sq-date" value="${sq.date}"></div>
      <div class="field"><label>状況</label><div class="startchoice tight" role="radiogroup">
        <label><input type="radio" name="sq-start" value="1"${sq.startDone?" checked":""}> もう植えた</label>
        <label><input type="radio" name="sq-start" value="0"${sq.startDone?"":" checked"}> これから</label></div></div>
    </div>
    ${bedBarHtml(sq.bed, {mini:true, cands:lay.map(x=>({spot:x.sp, crop:x.crop}))})}
    <div class="seqline">${lay.length ? lay.map(x=>`<span class="seqitem${x.over?" over":""}" title="${esc(x.crop.name)} ${esc(spotLabel(x.sp))}">${esc(iconOf(x.crop))}</span>`).join("") : `<span class="muted">まだありません</span>`}
      <span class="seqlen">${lay.length ? `${used}cm / ${L}cm` : ""}</span></div>
    <div class="btns" style="margin-top:6px"><button class="btn small" data-act="sq-undo"${lay.length?"":" disabled"}>1つ戻す</button><button class="btn small" data-act="sq-clear"${lay.length?"":" disabled"}>全部消す</button></div>
    <div class="label-s">作物（タップした順に右へ並びます）</div>
    <div class="seqpal">${my.map(c=>`<button class="seqbtn" data-act="sq-add" data-c="${c.id}"><span class="si">${esc(iconOf(c))}</span><span class="sn">${esc(c.name)}</span></button>`).join("")}</div>
    ${plan.length ? `<div class="label-s">登録の内容</div><div class="seqplan">${plan.map(g=>`<div class="planrow"><div>${esc(iconOf(g.crop))} <b>${esc(g.crop.name)}</b> ${g.n?`${g.n}株`:""}${g.spots.some(s=>s.kind==="band")?`帯${g.spots.filter(s=>s.kind==="band").length}本`:""} → ${g.batch?`既存の作付け（${jp(parseD(startDateOf(g.batch)))}${g.batch.variety?`・${esc(g.batch.variety)}`:""}・${g.batch.count}株）に追加`:"新しい作付け"}</div>
        <input type="text" class="sqv" data-c="${g.cropId}" value="${esc(sq.variety[g.cropId]||"")}" placeholder="品種（任意）" autocomplete="off" aria-label="${esc(g.crop.name)}の品種"></div>`).join("")}</div>
      <label class="checkline"><input type="checkbox" id="sq-join"${sq.join?" checked":""}> 同じ作物・同じ日・同じ品種の作付けがこの畝にあれば、そこへ追加する</label>` : ""}
    ${notes.length ? `<div class="warn note"><span class="wt">位置の確認</span>${uniq(notes).join("<br>")}</div>` : ""}
    ${errs.length ? `<div class="warn"><span class="wt">このままでは登録できません</span>${uniq(errs).join("<br>")}<br>「1つ戻す」で減らすか、畝の寸法を確認してください。</div>` : ""}
    ${warns.length ? `<div class="warn amber"><span class="wt">注意</span>${uniq(warns).join("<br>")}</div>` : ""}
    ${old ? `<div class="warn"><span class="wt">スクリプトの更新が必要です</span>畝の中に置くには、スプレッドシート側の Code.gs を v5 に更新してください。</div>` : ""}
    <div class="sheet-foot"><button class="btn" data-act="close">やめる</button>
      <button class="btn primary" data-act="sq-save"${lay.length && !errs.length && !old ? "" : " disabled"}>登録する${lay.length?`（${plan.length}作付け・${total}株${lay.length>total?`・帯${lay.length-total}`:""}）`:""}</button></div>`;
  const keep = $("#sheet").scrollTop;
  $("#sheet").innerHTML = h; $("#backdrop").hidden = false;
  $("#sheet").scrollTop = top ? 0 : keep;
  const di = $("#sq-date"); if(di) di.addEventListener("change", ()=>{ if(di.value){ sq.date = di.value; if(parseD(sq.date) > today()) sq.startDone = false; } renderSeqSheet(); });
  document.querySelectorAll('input[name="sq-start"]').forEach(r=>r.addEventListener("change", ()=>{ sq.startDone = r.value==="1" && r.checked; }));
  const jn = $("#sq-join"); if(jn) jn.addEventListener("change", ()=>{ sq.join = jn.checked; renderSeqSheet(); });
  document.querySelectorAll(".sqv").forEach(inp=>inp.addEventListener("change", ()=>{ sq.variety[inp.dataset.c] = inp.value; renderSeqSheet(); }));
}
function saveSeq(){
  if(!sq || !sq.items.length || scriptTooOld()) return;
  const lay = seqLayout();
  if(lay.some(x=>x.over) || lay.some(x=>checkAt([x.sp], sq.bed, x.cropId, sq.date).some(w=>w.level==="error"))) return;
  const warn = [...new Set(lay.flatMap(x=>checkAt([x.sp], sq.bed, x.cropId, sq.date).filter(w=>w.level==="red"||w.level==="amber").map(w=>w.title)))];
  if(warn.length && !confirm(warn.join("・")+"があります。このまま登録しますか？")) return;
  if(state.sample){ state.plantings = []; state.logs = []; state.sample = false; }
  const plan = seqPlan(lay), sortPos = (a,b)=>(a.center??a.from)-(b.center??b.from);
  const done = sq.startDone && parseD(sq.date) <= today();
  plan.forEach(g=>{
    if(g.batch){
      g.batch.spots = g.batch.spots.concat(g.spots).sort(sortPos);
      g.batch.count = (g.batch.count||0) + g.n;
      putPlanting(g.batch);
    }else{
      const pid = uid("p");
      putPlanting({ id:pid, bedId:sq.bed, slots:[], spots:g.spots.slice().sort(sortPos), cropId:g.cropId, date:sq.date, count:g.n, status:"active", memo:"", variety:g.variety || undefined });
      const st = startTaskOf(g.crop);
      if(st && done) putLog({id:uid("l"), plantingId:pid, taskId:st.id, date:sq.date, type:"work"});
    }
  });
  const n = lay.filter(x=>x.sp.kind==="plant").length;
  closeSheet(); renderAll(); toast(`${plan.length}作付け・${n}株${lay.length>n?`・帯${lay.length-n}`:""}を登録しました`);
}

/* ---------- 位置を直す・消す（置き間違いの修正） ---------- */
/* その位置だけを外して判定する（同じ作付けのほかの株とは重なりを調べる） */
function withoutSpot(p, i, fn){
  const orig = p.spots; p.spots = orig.filter((_,k)=>k!==i);
  try{ return fn(); } finally { p.spots = orig; }
}
function openSpotEdit(pid, i){
  const p = state.plantings.find(x=>x.id===pid); if(!p || !p.spots || !p.spots[i]) return;
  const sp = p.spots[i];
  pp = { edit:{pid, i}, bed:bedOf(p).id, cropId:p.cropId, kind:sp.kind, x:sp.center, from:sp.from, len:(sp.to||0)-(sp.from||0),
         n:sp.n||1, rows:sp.rows||1, keepSpace:sp.space, anchor:null, x0:null, date:startDateOf(p), note:"", add:null };
  if(sp.kind==="plant"){ pp.from = 0; pp.len = BAND_DEFAULT; }
  renderEditSheet();
}
function editedSpot(){
  const p = state.plantings.find(x=>x.id===pp.edit.pid), orig = p.spots[pp.edit.i], sp = ppSpot();
  if(orig.endDate) sp.endDate = orig.endDate;
  return sp;
}
function renderEditSheet(){
  const p = state.plantings.find(x=>x.id===pp.edit.pid); if(!p) return;
  const c = cropById(p.cropId), L = bedDims(pp.bed).lengthCm, sp = editedSpot();
  let ws, bar, nb;
  withoutSpot(p, pp.edit.i, ()=>{ ws = checkAt([sp], pp.bed, p.cropId, pp.date); bar = bedBarHtml(pp.bed, {mini:true, cand:{spot:sp, crop:c}}); nb = neighborsOf(ppRange()); });
  const posText = pp.kind==="plant" ? `左から${pp.x}cm` : `左から${pp.from}〜${pp.from+pp.len}cm（${pp.len}cm）`;
  const h = `<h3>位置を直す：${esc(iconOf(c))} ${esc(c.name)}${pp.kind==="group"?`×${pp.n}`:pp.kind==="band"?"（帯）":""}</h3>
    <div class="sheet-sub">${esc(bedById(pp.bed).name)}（${L}cm）／置き間違いの修正用です。この位置だけを動かします。</div>
    ${bar}
    <div class="posrow">
      <button class="btn" data-act="pp-adj" data-w="move" data-v="-${GRID}" aria-label="左へ${GRID}cm">◀</button>
      <div class="posval"><b>${posText}</b><span>${nb.L?`左の${esc(nb.L.name)}まで${nb.L.d}cm`:"左は空き"}／${nb.R?`右の${esc(nb.R.name)}まで${nb.R.d}cm`:"右は空き"}</span></div>
      <button class="btn" data-act="pp-adj" data-w="move" data-v="${GRID}" aria-label="右へ${GRID}cm">▶</button>
    </div>
    ${pp.kind==="group" ? `<div class="sizerow"><span class="lbl">株数</span><button class="btn" data-act="pp-adj" data-w="n" data-v="-1">−</button><b>${pp.n}株</b><button class="btn" data-act="pp-adj" data-w="n" data-v="1">＋</button>
      <span class="lbl">条</span>${[1,2].map(k=>`<button class="chip${pp.rows===k?" sel":""}" data-act="pp-adj" data-w="rows" data-v="${k}">${k}条</button>`).join("")}</div>
      <div class="sizerow"><span class="lbl">長さ</span><button class="btn" data-act="pp-adj" data-w="len" data-v="-${LEN_STEP}">−</button><b>${pp.len}cm</b><button class="btn" data-act="pp-adj" data-w="len" data-v="${LEN_STEP}">＋</button></div>` : ""}
    ${pp.kind==="band" ? `<div class="sizerow"><span class="lbl">長さ</span><button class="btn" data-act="pp-adj" data-w="len" data-v="-${LEN_STEP}">−</button><b>${pp.len}cm</b><button class="btn" data-act="pp-adj" data-w="len" data-v="${LEN_STEP}">＋</button></div>` : ""}
    ${warnHtml(ws.filter(w=>["error","red","amber"].includes(w.level) && !/適期外|遅霜|生育期間|日照/.test(w.title)))}
    <div class="sheet-foot"><button class="btn" data-act="close">やめる</button>
      <button class="btn primary" data-act="pp-save"${blocking(ws) || scriptTooOld() ? " disabled" : ""}>保存</button></div>`;
  showSheet(h);
}
function saveEdit(){
  const p = state.plantings.find(x=>x.id===pp.edit.pid); if(!p) return;
  const i = pp.edit.i, orig = p.spots[i], sp = editedSpot();
  const ws = withoutSpot(p, i, ()=>checkAt([sp], pp.bed, p.cropId, pp.date));
  if(blocking(ws)) return;
  const warn = ws.filter(w=>(w.level==="red"||w.level==="amber") && /株間|連作/.test(w.title));
  if(warn.length && !confirm(warn.map(w=>w.title).join("・")+"があります。このまま保存しますか？")) return;
  if(orig.kind==="group") p.count = Math.max(0, (p.count||0) + (sp.n||0) - (orig.n||0));
  p.spots = p.spots.map((x,k)=>k===i ? sp : x);
  putPlanting(p);
  closeSheet(); renderAll(); toast(`位置を直しました（${spotLabel(sp)}）`);
}
function removeSpot(pid, i){
  const p = state.plantings.find(x=>x.id===pid); if(!p || !p.spots || !p.spots[i]) return;
  const c = cropById(p.cropId), sp = p.spots[i];
  if(p.spots.length===1){ alert("この作付けの最後の位置なので消せません。作付けごと消すときは、作付けを開いて「修正・メモ・削除」から削除してください。"); return; }
  if(!confirm(`${c.name}（${spotLabel(sp)}）の位置を消しますか？\n置き間違いの修正用です。作付けのやることや記録はそのまま残ります。`)) return;
  const n = sp.kind==="plant" ? 1 : sp.kind==="group" ? (sp.n||0) : 0;
  p.spots = p.spots.filter((_,k)=>k!==i); p.count = Math.max(0, (p.count||0) - n);
  putPlanting(p);
  closeSheet(); renderAll(); toast(`${c.name}の位置を1つ消しました`);
}

/* ---------- 一部終了（枯れた・抜いた・収穫が終わった） ----------
   株・帯：その位置に終了日をつける（その日から空く）
   まとまり：植えた株数 n は事実として変えない（中の株の位置の計算に使うため）
     ・「1株減った（どれか不明）」→ lost（不明な減少の数）を1つ増やす
     ・「この株が終わった」       → ended に {row, index, endDate} を記録（1条目の3株目 など）
     ・不明な減少を、あとで特定した株の記録に振り替えるときは lost を1つ減らす（二重に数えない）
     ・まとまりの場所は、全部の株が終わる（生育中が0になる）までは使用中のまま。個別の終了は履歴の精度を上げるためで、
       その場所をすぐ別の株に使う機能ではない（必要なら、まとまりを株に分けて置き直す）
   全部の位置が終わったら、作付けも終了にする（終了日は最後の位置の終了日） */
function aliveOf(sp){
  if(sp.endDate) return 0;
  if(sp.kind==="plant") return 1;
  if(sp.kind==="group") return Math.max(0, (sp.n||1) - (sp.lost||0) - (sp.ended||[]).length);
  return 0;
}
const plantedOf = sp => sp.kind==="plant" ? 1 : sp.kind==="group" ? (sp.n||1) : 0;
function autoDone(p){
  if(!Array.isArray(p.spots) || !p.spots.length || !p.spots.every(sp=>sp.endDate)) return false;
  p.status = "done"; p.endDate = p.spots.map(sp=>sp.endDate).sort().pop();
  return true;
}
function saveEnded(p, msg){
  const done = autoDone(p);
  putPlanting(p); closeSheet(); renderAll();
  toast(done ? `${msg}。全部の位置が終わったので、作付けを終了にしました` : msg);
}
function endSpot(p, i, date){ p.spots[i] = Object.assign({}, p.spots[i], { endDate:date }); saveEnded(p, `${cropById(p.cropId).name}（${spotLabel(p.spots[i])}）を終了にしました`); }
function groupLose(p, i, date){
  const sp = Object.assign({}, p.spots[i]); sp.lost = (sp.lost||0) + 1;
  if(aliveOf(sp)===0) sp.endDate = date;
  p.spots[i] = sp; saveEnded(p, `${cropById(p.cropId).name}のまとまりで1株減りました（どれかは不明）`);
}
function groupEndPlant(p, i, row, index, date, convert){
  const sp = Object.assign({}, p.spots[i], { ended:(p.spots[i].ended||[]).slice() });
  if(sp.ended.some(e=>e.row===row && e.index===index)) return;
  const needConvert = (sp.n||1) - (sp.lost||0) - sp.ended.length <= 0;          // 生育中が0なのに特定の株を終える＝不明な減少がその株だった
  if((convert || needConvert) && (sp.lost||0) > 0) sp.lost -= 1;
  sp.ended.push({ row, index, endDate:date });
  sp.ended.sort((a,b)=>a.row-b.row || a.index-b.index);
  if(aliveOf(sp)===0) sp.endDate = [date].concat(sp.ended.map(e=>e.endDate)).sort().pop();
  p.spots[i] = sp;
  saveEnded(p, `${cropById(p.cropId).name}（${row}条目の${index}株目）を終了にしました`);
}
/* まとまりの中の株（1条目の1株目…）と、その状態 */
function groupPlants(sp){
  const byRow = {};
  return groupCenters(sp).map(g=>{ byRow[g.row] = (byRow[g.row]||0) + 1; const index = byRow[g.row];
    const e = (sp.ended||[]).find(x=>x.row===g.row && x.index===index);
    return { row:g.row, index, center:Math.round(g.center), ended: e ? e.endDate : null }; });
}
let es = null;
function openEnd(pid, i, mode){
  const p = state.plantings.find(x=>x.id===pid); if(!p || !p.spots || !p.spots[i]) return;
  es = { pid, i, mode, pick:null, convert:true };
  renderEndSheet();
}
function renderEndSheet(){
  const p = state.plantings.find(x=>x.id===es.pid), sp = p.spots[es.i], c = cropById(p.cropId);
  const title = es.mode==="lost" ? "1株減った（どれかは不明）" : es.mode==="pick" ? "株を選んで終える" : sp.kind==="band" ? "この帯を終える" : "この株を終える";
  let body = "";
  if(sp.kind==="group"){
    const pl = groupPlants(sp), alive = aliveOf(sp);
    body += `<div class="sheet-sub">植えた${sp.n}株・生育中${alive}株${sp.lost?`（どれか不明の減少${sp.lost}株）`:""}${(sp.ended||[]).length?`・終了${sp.ended.length}株`:""}</div>`;
    if(es.mode==="pick"){
      const rows = [...new Set(pl.map(x=>x.row))];
      body += `<div class="label-s">終わった株を選ぶ（左から）</div>` + rows.map(r=>`<div class="gprow"><span class="lbl">${r}条目</span>${pl.filter(x=>x.row===r).map(x=>
        `<button class="chip${es.pick && es.pick.row===x.row && es.pick.index===x.index?" sel":""}" data-act="es-pick" data-r="${x.row}" data-x="${x.index}"${x.ended?" disabled":""}>${x.index}株目<small>${x.center}cm${x.ended?`・終了${jp(parseD(x.ended)).replace(/\(.\)/,"")}`:""}</small></button>`).join("")}</div>`).join("");
      if(sp.lost) body += `<label class="checkline"><input type="checkbox" id="es-conv"${es.convert?" checked":""}> 不明な減少（${sp.lost}株）のうち1株を、この株の記録に振り替える（同じ株を二重に数えない）</label>`;
    }
    body += `<div class="warn note"><span class="wt">まとまりの場所</span>全部の株が終わるまで、まとまりの場所（${sp.from}〜${sp.to}cm）は使用中のままです。個別の終了は記録の精度を上げるためのものです。</div>`;
  }else if(sp.kind==="plant") body += `<div class="sheet-sub">${esc(spotLabel(sp))}。終わった日から、この場所は空きになります。作付けのやることや記録はそのまま残ります。</div>`;
  else body += `<div class="sheet-sub">${esc(spotLabel(sp))}。終わった日から、この帯の場所は空きになります。</div>`;
  showSheet(`<h3>${esc(iconOf(c))} ${esc(c.name)}：${title}</h3>${body}${doneDateHtml("es-date","終わった日")}
    <div class="sheet-foot"><button class="btn" data-act="close">やめる</button><button class="btn primary" data-act="es-save"${es.mode==="pick" && !es.pick ? " disabled" : ""}>記録する</button></div>`);
  wireDoneDate($("#sheet"));
  const cv = $("#es-conv"); if(cv) cv.addEventListener("change", ()=>{ es.convert = cv.checked; });
}
function saveEnd(){
  const p = state.plantings.find(x=>x.id===es.pid); if(!p) return;
  const date = pickedDate("es-date"), sp = p.spots[es.i];
  if(es.mode==="lost") return groupLose(p, es.i, date);
  if(es.mode==="pick"){ if(!es.pick) return; return groupEndPlant(p, es.i, es.pick.row, es.pick.index, date, es.convert); }
  endSpot(p, es.i, date);
}
/* 終了の取り消し（記録の間違い） */
function unendSpot(pid, i, what, k){
  const p = state.plantings.find(x=>x.id===pid); if(!p || !p.spots || !p.spots[i]) return;
  const sp = Object.assign({}, p.spots[i]);
  if(what==="spot") delete sp.endDate;
  if(what==="lost"){ sp.lost = Math.max(0, (sp.lost||0) - 1); if(!sp.lost) delete sp.lost; delete sp.endDate; }
  if(what==="ended"){ sp.ended = (sp.ended||[]).filter((_,j)=>j!==k); if(!sp.ended.length) delete sp.ended; delete sp.endDate; }
  p.spots[i] = sp;
  if(p.status==="done" && !p.spots.every(x=>x.endDate)){ p.status = "active"; delete p.endDate; }
  putPlanting(p); renderAll(); openPlanting(p.id); toast("終了の記録を取り消しました");
}
/* 作付けの詳細：位置ごとの状態 */
function spotsListHtml(p){
  if(!hasExactSpots(p)) return "";
  const rows = p.spots.map((sp,i)=>{
    const base = `${sp.kind==="group"?`まとまり ${sp.n}株${(sp.rows||1)>1?`・${sp.rows}条`:""}`:sp.kind==="band"?"帯":"株"}（${esc(spotLabel(sp))}）`;
    let st = sp.endDate ? `終了 ${jp(parseD(sp.endDate))} <button class="linkbtn" data-act="spot-unend" data-p="${p.id}" data-i="${i}" data-w="spot">取り消す</button>` : "生育中";
    let sub = "";
    if(sp.kind==="group" && !sp.endDate) st = `生育中 ${aliveOf(sp)}株`;
    if(sp.kind==="group"){
      const pl = groupPlants(sp);
      sub += (sp.ended||[]).map((e,k)=>{ const x = pl.find(y=>y.row===e.row && y.index===e.index);
        return `<div class="spsub">${e.row}条目の${e.index}株目（${x?x.center:"?"}cm）終了 ${jp(parseD(e.endDate))} <button class="linkbtn" data-act="spot-unend" data-p="${p.id}" data-i="${i}" data-w="ended" data-k="${k}">取り消す</button></div>`; }).join("");
      if(sp.lost) sub += `<div class="spsub">どれか不明の減少 ${sp.lost}株 <button class="linkbtn" data-act="spot-unend" data-p="${p.id}" data-i="${i}" data-w="lost">1株取り消す</button></div>`;
    }
    return `<div class="sprow${sp.endDate?" ended":""}"><div><span>${base}</span><span class="spst">${st}</span></div>${sub}</div>`;
  }).join("");
  const planted = p.spots.reduce((s,x)=>s+plantedOf(x),0), alive = p.spots.reduce((s,x)=>s+aliveOf(x),0);
  return `<div class="label-s">位置（植えた${planted}株・生育中${alive}株）</div><div class="splist">${rows}</div>`;
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
    <div class="sheet-sub">${esc(bed.name)} ${hasExactSpots(p) ? `${posLabel(p)}` : `区画${slotNums(p)}（${esc(shareLabel(slotsTouched(p).length))}）`}・${p.count}株${p.variety?`・${esc(p.variety)}`:""}</div>
    ${posWarnHtml(p)}
    ${spotsListHtml(p)}
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
    ${!isDone?`<div class="sheet-foot" style="margin-top:8px"><button class="btn" data-act="plan-next" data-s="${slotsTouched(p)[0]}">この区画の次の作付けを予定</button></div>`:""}
    <div class="sheet-foot" style="margin-top:8px"><button class="btn" data-act="pe-open" data-p="${p.id}">修正・メモ・削除</button><button class="btn" data-act="close">閉じる</button></div>`;
  showSheet(h);
}

/* ---------- 作付けの修正 ---------- */
function openPlantingEdit(pid){
  const p = state.plantings.find(x=>x.id===pid); if(!p) return;
  pe = { pid, slots:slotsTouched(p), date:p.date, count:p.count, memo:p.memo||"" };
  renderPlantingEdit(true);
}
function renderPlantingEdit(top){
  const p = state.plantings.find(x=>x.id===pe.pid); if(!p) return;
  const c = cropById(p.cropId), bed = bedOf(p), bedId = bed.id;
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
  handle(el.dataset.act, el, e);
});
document.addEventListener("keydown", e=>{
  if(e.key==="Escape" && !$("#backdrop").hidden) closeSheet();
  if((e.key==="Enter"||e.key===" ") && e.target.matches && e.target.matches("g.g-row")){ e.preventDefault(); handle("planting", e.target); }
});

async function handle(act, el, ev){
  const d = el.dataset, P = id => state.plantings.find(x=>x.id===id);
  switch(act){
    case "open": openTask(d.p, d.t, d.d); break;
    case "close": closeSheet(); break;
    case "bar": {
      if(!ev) break;
      const r = el.getBoundingClientRect(), L = bedDims(d.b).lengthCm;
      const x = Math.max(0, Math.min(L, snapCm((ev.clientX - r.left) / r.width * L)));
      openPlace(d.b, x, null); break;
    }
    case "place-open": openPlace(d.b, null, null); break;
    case "spot": openSpot(d.p, Number(d.i)); break;
    case "spot-side": { const p = P(d.p); if(!p) break; openPlace(bedOf(p).id, null, {pid:p.id, i:Number(d.i), side:d.side}); break; }
    case "pp-crop": placeChoose(d.c); break;
    case "pp-back": pp.cropId = null; renderPlaceSheet(); break;
    case "pp-adj": ppSync(); ppAdjust(d.w, Number(d.v)); renderPlaceSheet(); break;
    case "pp-kind": ppSync(); setKind(d.k); renderPlaceSheet(); break;
    case "pp-save": savePlace(); break;
    case "seq-open": openSeq(d.b); break;
    case "sq-add": if(sq){ sq.items.push(d.c); renderSeqSheet(); } break;
    case "sq-undo": if(sq){ sq.items.pop(); renderSeqSheet(); } break;
    case "sq-clear": if(sq){ sq.items = []; renderSeqSheet(); } break;
    case "sq-save": saveSeq(); break;
    case "spot-edit": openSpotEdit(d.p, Number(d.i)); break;
    case "spot-del": removeSpot(d.p, Number(d.i)); break;
    case "end-open": openEnd(d.p, Number(d.i), d.m); break;
    case "es-pick": if(es){ es.pick = { row:Number(d.r), index:Number(d.x) }; const dv = pickedDate("es-date"); renderEndSheet(); const di = $("#es-date"); if(di){ di.value = dv; di.closest(".donedate").querySelectorAll("[data-act=dd]").forEach(b=>b.classList.toggle("sel", b.dataset.v===dv)); } } break;
    case "es-save": saveEnd(); break;
    case "spot-unend": unendSpot(d.p, Number(d.i), d.w, Number(d.k)); break;
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
      const clash = slotsTouched(p).filter(s=>plantingsIn(s, x=>x.id!==p.id).some(x=>overlaps(interval(probe), intervalIn(x, s))));
      if(clash.length){ alert(`区画${clash.map(slotIdx).join("・")}は、その時期に別の作物が使っています。先に「修正」で区画を変えてください。`); break; }
      // 全部の位置が終わって自動で終了になった作付けを再開：最後に終わった位置（作付けの終了日と同じ日）だけ再開する
      if(Array.isArray(p.spots) && p.endDate) p.spots = p.spots.map(sp=>sp.endDate && sp.endDate >= p.endDate ? (({endDate, ...rest})=>rest)(sp) : sp);
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
    case "ps-bed": {
      ps.bed = d.b; const got = bestInBed(d.b, ps.cropId, ps.date);
      ps.slots = got ? got.slots : []; ps.anchor = ps.slots[0] || d.b+"1";
      renderPlantSheet(); break;
    }
    case "auto-place": {
      const got = autoPlace(d.c);
      if(!got){ alert("その時期に空いている区画がありません。どれかの作付けを終了するか、日付をずらしてください。"); break; }
      ps = { anchor:got.slots[0], bed:got.bed, cropId:d.c, slots:got.slots, date:got.date, count:10, after:null };
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
      const nextSlots = pe.slots.slice().sort((a,b)=>slotIdx(a)-slotIdx(b));
      // 区画を変えたときだけ位置を区画に置き換える（変えていなければ、畝の中の位置はそのまま残す）
      if(nextSlots.join()!==slotsTouched(p).join()){ p.slots = nextSlots; delete p.spots; delete p.spotsRaw; }
      p.bedId = slotBed(nextSlots[0]);
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
