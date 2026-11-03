// Genera docs/vendor/icons.svg (sprite) con los íconos Lucide usados por la app.
import fs from "node:fs";
const usados = ["layout-dashboard","users","truck","building-2","settings","log-out","search","bell","upload","download","file-text",
  "calendar","triangle-alert","clock","circle-check","hourglass","chevron-down","chevron-right","plus","x","funnel","refresh-cw",
  "trash-2","folder","link","shield-check","database","history","user-cog","panel-left","file-spreadsheet","circle-alert","sliders-horizontal","inbox","pencil","archive","archive-restore","key-round","user-plus","eye","lock","lock-keyed","square-pen","building","ban","check","info"];
const out = ['<svg xmlns="http://www.w3.org/2000/svg" style="display:none">'];
for (const n of usados) {
  const f = `node_modules/lucide-static/icons/${n}.svg`;
  if (!fs.existsSync(f)) { console.error("falta", n); continue; }
  const inner = fs.readFileSync(f, "utf8").replace(/<!--[\s\S]*?-->/g, "").replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").trim();
  out.push(`<symbol id="i-${n}" viewBox="0 0 24 24">${inner}</symbol>`);
}
out.push("</svg>");
fs.writeFileSync("docs/vendor/icons.svg", out.join("\n"));
console.log("íconos:", usados.length);
