export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const ico = (n, c = "") => `<svg class="ico ${c}"><use href="vendor/icons.svg#i-${n}"/></svg>`;
export const iniciales = (t) => (String(t).trim().split(/\s+/).slice(0, 2).map((x) => x[0] || "").join("") || "?").toUpperCase();
export const fmtISO = (d) => d.toISOString().slice(0, 10);
export const fmtFechaHora = (t) => t ? new Date(t).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "—";
export function toast(msg, tipo = "") {
  const t = document.createElement("div"); t.className = `toast ${tipo}`; t.textContent = msg; $("toasts").append(t);
  setTimeout(() => t.remove(), tipo === "error" ? 7000 : 4500);
}
export const leerLS = (k, def) => { try { return JSON.parse(localStorage.getItem(k) || "null") ?? def; } catch { return def; } };
export const escribirLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignorar */ } };
/** Ejecuta una acción asíncrona deshabilitando el botón y mostrando el error como toast. */
export async function conBoton(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); }
  catch (e) { toast(e.message || String(e), "error"); return undefined; }
  finally { if (btn) btn.disabled = false; }
}
