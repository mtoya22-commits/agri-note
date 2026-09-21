/**
 * 畑ノート ─ スプレッドシート保存用スクリプト（v5）
 *
 * 使い方は README の「3. Googleスプレッドシートとつなぐ」を参照。
 *   1. 新しいGoogleスプレッドシートを作る
 *   2. 拡張機能 → Apps Script を開き、このファイルの中身をすべて貼り付けて保存
 *   3. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *        次のユーザーとして実行：自分／アクセスできるユーザー：全員
 *   4. 表示された「ウェブアプリのURL」を、畑ノートの設定画面に貼る
 *
 * シート（plantings / logs / frost / settings）は自動で作られます。
 *
 * 同期のしくみ
 *   - 行は消さず、削除は deletedAt に日時を入れて残す（ほかの端末に削除を伝えるため）
 *   - 行ごとに version を持つ。端末は「どの version を見て編集したか」(baseVersion) を送り、
 *     シートの現在の version と違えば「競合」として書き込まずに返す
 *   - シートを手で直すと onEdit が version を1つ上げる。端末側の古い編集で上書きされない
 *   - changeSeq はシート全体の通し番号（変更の順番の記録）
 *
 * 集計は別のシートで行ってください。updatedAt / deletedAt / version / changeSeq の4列は
 * 同期用なので触らないでください（触ろうとすると警告が出ます）。
 *
 * v5 の追加：plantings の右端に spots 列（畝の中の位置）と variety 列（品種）を足しました。
 *   古いシートは、最初の読み書きのときに見出しを自動で追加します（既存の行はそのまま）。
 *   書き方の例：株170 ／ 群300-390×3 ／ 帯300-390 ／ 修飾「/幅0-35」「/終2026-08-01」「/区画」
 */

const SCHEMA = 5;
const META = ['updatedAt', 'deletedAt', 'version', 'changeSeq'];
// 列は「基本の列 → 同期用の4列 → あとから足した列」の順。足した列は古いシートに自動で追加する
const BASE = {
  plantings: ['id','bedId','slots','cropId','cropName','date','count','status','endDate','memo'],
  logs:      ['id','plantingId','cropName','taskId','taskName','date','type','qty','unit'],
  frost:     ['id','targetNight','forecastCapturedAt','tmin','cloud','wind','risk','observed'],
  settings:  ['id','value']
};
const ADDED = { plantings: ['spots', 'variety'] };
const TABLES = {};
Object.keys(BASE).forEach(function (t) { TABLES[t] = BASE[t].concat(META, ADDED[t] || []); });
const TEXT_COLS = ['id','plantingId','slots','memo','value','taskId','cropId','bedId','type','status','risk','observed','spots','variety'];

/* ---------------- 入口 ---------------- */
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'ping';
  try {
    if (action === 'dump') return json_(dump_());
    return json_({ ok: true, app: 'hatake-note', schema: SCHEMA });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return json_({ ok: false, error: 'bad json' }); }
  if (body.action !== 'apply' || !Array.isArray(body.ops)) return json_({ ok: false, error: 'unknown action' });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return json_({ ok: true, results: apply_(body.ops), changeSeq: seq_() });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

/* シートを手で編集したら、その行の version を上げる（複数行の貼り付けにも対応） */
function onEdit(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  const cols = TABLES[sh.getName()];
  if (!cols) return;
  const first = Math.max(2, e.range.getRow());
  const last = e.range.getRow() + e.range.getNumRows() - 1;
  if (last < first) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const n = last - first + 1;
    const rng = sh.getRange(first, 1, n, cols.length);
    const values = rng.getValues();
    const iU = cols.indexOf('updatedAt'), iV = cols.indexOf('version'), iS = cols.indexOf('changeSeq');
    let changed = false;
    values.forEach(function (r) {
      if (r[0] === '' || r[0] === null) return;
      r[iV] = (Number(r[iV]) || 0) + 1;
      r[iU] = Date.now();
      r[iS] = nextSeq_();
      changed = true;
    });
    if (changed) rng.setValues(values);
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- 書き込み ---------------- */
function apply_(ops) {
  const results = [];
  Object.keys(TABLES).forEach(function (table) {
    const mine = ops.filter(function (o) { return o.table === table; });
    if (!mine.length) return;
    const cols = TABLES[table];
    const iV = cols.indexOf('version'), iS = cols.indexOf('changeSeq');
    const sh = sheet_(table);
    const last = sh.getLastRow();
    const data = last > 1 ? sh.getRange(2, 1, last - 1, cols.length).getValues() : [];
    const index = {};
    data.forEach(function (r, i) { if (r[0] !== '') index[String(r[0])] = i; });
    const dirty = {};
    const appends = [];

    mine.forEach(function (o) {
      const id = String(o.id);
      const at = index[id];
      const cur = at === undefined ? null : (at >= 0 ? data[at] : appends[-at - 1]);
      const curVersion = cur ? (Number(cur[iV]) || 0) : 0;
      const base = Number(o.baseVersion) || 0;
      if (base !== curVersion) {
        results.push({ table: table, id: id, status: 'conflict', current: cur ? toObj_(cols, cur) : null });
        return;
      }
      const values = cols.map(function (c) { return clean_(o.row ? o.row[c] : ''); });
      values[0] = id;
      values[iV] = curVersion + 1;
      values[iS] = nextSeq_();
      if (cur === null) { appends.push(values); index[id] = -appends.length; }
      else if (at >= 0) { data[at] = values; dirty[at] = true; }
      else { appends[-at - 1] = values; }
      results.push({ table: table, id: id, status: 'ok', version: values[iV], changeSeq: values[iS] });
    });

    Object.keys(dirty).forEach(function (k) {
      const i = Number(k);
      sh.getRange(i + 2, 1, 1, cols.length).setValues([data[i]]);
    });
    if (appends.length) sh.getRange(sh.getLastRow() + 1, 1, appends.length, cols.length).setValues(appends);
  });
  return results;
}

/* ---------------- 読み出し（全件） ---------------- */
function dump_() {
  const out = { ok: true, changeSeq: seq_(), schema: SCHEMA };
  Object.keys(TABLES).forEach(function (table) {
    const cols = TABLES[table];
    const sh = sheet_(table);
    const last = sh.getLastRow();
    out[table] = last < 2 ? [] : sh.getRange(2, 1, last - 1, cols.length).getValues()
      .filter(function (r) { return r[0] !== ''; })
      .map(function (r) { return toObj_(cols, r); });
  });
  return out;
}

/* ---------------- 下回り ---------------- */
function toObj_(cols, r) {
  const tz = Session.getScriptTimeZone();
  const o = {};
  cols.forEach(function (c, i) {
    let v = r[i];
    if (v instanceof Date) v = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    o[c] = v;
  });
  return o;
}

function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cols = TABLES[name];
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
    TEXT_COLS.forEach(function (c) {
      const i = cols.indexOf(c);
      if (i >= 0) sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
    });
    // 同期用の列は、触ろうとすると警告を出す
    const p = sh.getRange(1, cols.indexOf(META[0]) + 1, sh.getMaxRows(), META.length).protect();
    p.setDescription('畑ノートの同期用の列です（手で変更しないでください）');
    p.setWarningOnly(true);
  } else {
    const head = sh.getRange(1, 1, 1, cols.length).getValues()[0].map(String);
    let n = head.length; while (n > 0 && head[n - 1] === '') n--;           // 右端の空の見出しは数えない
    const minLen = BASE[name].length + META.length;
    const prefixOk = n >= minLen && head.slice(0, n).join(',') === cols.slice(0, n).join(',');
    if (!prefixOk) {
      throw new Error('シート「' + name + '」の列の並びが違います。1行目の見出しを元に戻すか、新しいスプレッドシートで作り直してください。');
    }
    if (n < cols.length) {                                                 // 古いシート：足した列の見出しを右端に追加
      const add = cols.slice(n);
      sh.getRange(1, n + 1, 1, add.length).setValues([add]).setFontWeight('bold');
      add.forEach(function (c, k) {
        if (TEXT_COLS.indexOf(c) >= 0) sh.getRange(2, n + 1 + k, sh.getMaxRows() - 1, 1).setNumberFormat('@');
      });
    }
  }
  return sh;
}

function seq_() { return Number(PropertiesService.getScriptProperties().getProperty('changeSeq')) || 0; }
function nextSeq_() {
  const n = seq_() + 1;
  PropertiesService.getScriptProperties().setProperty('changeSeq', String(n));
  return n;
}

/* 数式として解釈されないようにする */
function clean_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
  return v;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
