// index.html（GitHub用）と preview.html（claude.ai プレビュー用・1ファイル）を作る
const fs = require("fs");
const tpl = fs.readFileSync("src/index.template.html","utf8");
const css = fs.readFileSync("src/style.css","utf8");
const app = fs.readFileSync("app.js","utf8");
const crops = fs.readFileSync("crops.json","utf8");
// 置き換えは関数で渡す（文字列だと、本文中の $` や $& が特別な意味に解釈されて壊れる）
const page = tpl.replace("/*__STYLE__*/", ()=>css);
fs.writeFileSync("index.html", page.replace("<!--__DATA__-->\n", ""));
// プレビュー：外部ファイルなし・同期なし・サンプル入り
let pv = page
  .replace(/<!doctype html>[\s\S]*?<title>/, "<title>")
  .replace(/<link rel="manifest"[^>]*>\n|<link rel="apple-touch-icon"[^>]*>\n|<link rel="icon"[^>]*>\n/g, "")
  .replace(/<meta name="(theme-color|apple-[^"]*)"[^>]*>\n/g, "")
  .replace(/<\/head>\n<body>\n/, "")
  .replace(/<\/body>\n<\/html>\n?$/, "")
  .replace("<!--__DATA__-->", ()=>`<script>window.HATAKE_PREVIEW=true;window.CROPS_DATA=${crops.trim()};</script>`)
  .replace('<script src="app.js"></script>', ()=>`<script>\n${app}\n</script>`);
fs.mkdirSync("dist",{recursive:true});
fs.writeFileSync("dist/preview.html", pv);
console.log("index.html", fs.statSync("index.html").size, "preview.html", fs.statSync("dist/preview.html").size);
