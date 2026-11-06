// Importación semanal de Excel (solo administrador): el archivo reemplaza los datos de la organización elegida.
import { nombreEmpresa, norm } from "../loader.js";
import { $, esc, ico, toast, conBoton, leerLS, escribirLS } from "../util.js";
import { st, orgsActivas, orgNombre } from "../estado.js";
import { filasAEntidades, diffImportacion, TIPOS } from "../modelo.js";
import { confirmar, modal, valor } from "../ui/modal.js";

const archivos = [];                       // estado que sobrevive a los re-renders
let seq = 0, worker, esperando = new Map();
function parsear(buffer, nombre) {
  if (!worker) {
    worker = new Worker("js/worker.bundle.js");
    worker.onmessage = (e) => { const p = esperando.get(e.data.id); esperando.delete(e.data.id); e.data.ok ? p.resolve(e.data) : p.reject(new Error(e.data.error)); };
  }
  return new Promise((resolve, reject) => { const id = ++seq; esperando.set(id, { resolve, reject }); worker.postMessage({ id, buffer, nombre, empresa: "" }, [buffer]); });
}
// Los mismos archivos se cargan todas las semanas: se recuerda (en este navegador) a qué organización fue cada uno.
const LS_ORGS = "sicop.importar.orgPorArchivo";
const claveArchivo = (nombre) => norm(nombre.replace(/\.[^.]+$/, "").replace(/\s*\(\d+\)$/, ""));
const recordarOrg = (nombre, orgId) => escribirLS(LS_ORGS, { ...leerLS(LS_ORGS, {}), [claveArchivo(nombre)]: orgId });
const compacto = (t) => norm(t).replace(/[^a-z0-9]+/g, "");
export function sugerirOrg(nombre, orgs = orgsActivas()) {
  const recordada = leerLS(LS_ORGS, {})[claveArchivo(nombre)];
  if (recordada && orgs.some((o) => o.id === recordada)) return recordada;
  const n = norm(nombreEmpresa(nombre));
  const exacta = n && orgs.find((o) => norm(o.nombre) === n);
  if (exacta) return exacta.id;
  // El nombre de la organización aparece dentro del nombre del archivo (p. ej. "SICOP <EMPRESA> S.A.xlsx").
  const arch = compacto(nombre.replace(/\.[^.]+$/, ""));
  const cand = orgs.filter((o) => compacto(o.nombre).length >= 3 && arch.includes(compacto(o.nombre)));
  return cand.length === 1 ? cand[0].id : "";
}
const ultimaImportacion = (orgId) => st.datos.importaciones.find((i) => i.org_id === orgId)?.fecha ?? null;
const existentesDe = (orgId) => st.datos.entidades.filter((e) => e.org_id === orgId);
const calcDiff = (a) => a.orgId ? diffImportacion(a.entidades, existentesDe(a.orgId), ultimaImportacion(a.orgId)) : null;

let recargarVista = () => {};
export async function procesar(lista, redo) {
  const xl = [...lista].filter((f) => /\.xls[xm]$/i.test(f.name));
  if (lista.length && !xl.length) return toast("Solo se admiten archivos Excel (.xlsx).", "error");
  for (const f of xl) {
    const a = { id: ++seq, nombre: f.name, estado: "leyendo", entidades: [], avisos: [], tipos: [], orgId: "" };
    archivos.unshift(a); redo();
    try {
      const r = await parsear(await f.arrayBuffer(), f.name);
      const { entidades, avisos } = filasAEntidades(r.filas);
      Object.assign(a, { estado: "listo", entidades, avisos: [...r.avisos, ...avisos], tipos: [...new Set(entidades.map((e) => e.tipo))], orgId: sugerirOrg(f.name) });
    } catch (e) { Object.assign(a, { estado: "error", error: e.message }); }
    redo();
  }
}

export function renderImportar(cont) {
  recargarVista = () => renderImportar(cont);
  const orgs = orgsActivas();
  cont.innerHTML = `<div class="card"><div class="card-head"><div><h2>Importar Excel semanal</h2>
      <p class="muted">Cada archivo <b>reemplaza</b> los datos de la organización que elijas (solo las hojas que trae). Antes de confirmar verás un resumen de los cambios.</p></div></div>
    ${orgs.length ? "" : `<div class="banner warn">${ico("circle-alert", "sm")}Todavía no hay organizaciones. Creá una en <a href="#/organizaciones">Organizaciones</a> antes de importar.</div>`}
    <label id="drop" class="drop" for="archivos" tabindex="0">${ico("upload", "xl")}<b>Arrastrá los Excel acá o hacé clic para elegirlos</b>
      <span class="muted">Formato .xlsx · podés seleccionar varios a la vez · se procesan en tu navegador</span>
      <input id="archivos" type="file" accept=".xlsx,.xlsm" multiple hidden></label>
    <div id="imp-lista" class="imp-lista">${archivos.map(cardArchivo).join("") || '<p class="muted">Todavía no elegiste archivos.</p>'}</div></div>`;

  const drop = cont.querySelector("#drop"), redo = recargarVista;
  cont.querySelector("#archivos").onchange = (e) => { procesar(e.target.files, redo); e.target.value = ""; };
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => procesar(e.dataTransfer.files, redo));
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cont.querySelector("#archivos").click(); } });

  cont.querySelectorAll("[data-id]").forEach((el) => {
    const a = archivos.find((x) => x.id === +el.dataset.id);
    el.querySelector("select")?.addEventListener("change", (e) => { a.orgId = e.target.value; redo(); });
    el.querySelector("[data-quitar]")?.addEventListener("click", () => { archivos.splice(archivos.indexOf(a), 1); redo(); });
    el.querySelector("[data-crear]")?.addEventListener("click", () => crearOrgDesde(a, redo));
    el.querySelector("[data-importar]")?.addEventListener("click", (e) => confirmarImportacion(a, e.currentTarget, redo));
  });
}

function cardArchivo(a) {
  if (a.estado === "leyendo") return `<div class="imp-card" data-id="${a.id}"><div class="imp-top"><span class="dot load"></span><div class="info"><b>${esc(a.nombre)}</b><small class="muted">Procesando… puede tardar unos segundos</small></div></div></div>`;
  if (a.estado === "error") return `<div class="imp-card" data-id="${a.id}"><div class="imp-top"><span class="dot bad"></span><div class="info"><b>${esc(a.nombre)}</b><small class="err">No se pudo leer: ${esc(a.error)}</small></div><button class="btn sm" data-quitar>Quitar</button></div></div>`;
  if (a.estado === "hecho") {
    const r = a.resumen;
    return `<div class="imp-card hecho" data-id="${a.id}"><div class="imp-top"><span class="dot"></span><div class="info"><b>${esc(a.nombre)}</b>
      <small class="muted">Importado en ${esc(orgNombre(a.orgId))}: ${r.nuevas} nuevas · ${r.actualizadas} actualizadas · ${r.restauradas} restauradas · ${r.archivadas} archivadas</small></div><button class="btn sm" data-quitar>Quitar</button></div></div>`;
  }
  const d = calcDiff(a), orgs = orgsActivas(), sug = nombreEmpresa(a.nombre);
  const tiposTxt = a.tipos.map((t) => TIPOS[t].plural).join(", ") || "ninguno";
  return `<div class="imp-card" data-id="${a.id}"><div class="imp-top"><span class="dot${a.avisos.length ? " load" : ""}"></span>
    <div class="info"><b>${esc(a.nombre)}</b><small class="muted">${a.entidades.length} entidades · hojas: ${esc(tiposTxt)}</small></div>
    <select aria-label="Organización de destino"><option value="">Elegí la organización…</option>${orgs.map((o) => `<option value="${o.id}"${a.orgId === o.id ? " selected" : ""}>${esc(o.nombre)}</option>`).join("")}</select>
    ${!a.orgId ? `<button class="btn sm" data-crear>${ico("plus", "sm")}${sug ? `Crear “${esc(sug)}”` : "Crear organización"}</button>` : ""}
    <button class="btn sm" data-quitar aria-label="Quitar archivo">${ico("x", "sm")}</button></div>
    ${d ? `<div class="imp-stats"><div><b>${d.nuevas}</b><span>Nuevas</span></div><div><b>${d.actualizadas}</b><span>Se actualizan</span></div><div><b>${d.restauradas}</b><span>Se restauran</span></div>
      <div class="${d.archivadas ? "warn" : ""}"><b>${d.archivadas}</b><span>Se archivan (no vienen en el archivo)</span></div>
      <div class="${d.ediciones.length ? "warn" : ""}"><b>${d.ediciones.length}</b><span>Ediciones manuales que se pisan</span></div></div>
      ${d.ediciones.length ? `<p class="imp-warn">${ico("circle-alert", "sm")}Editadas a mano desde la última importación: ${esc(d.ediciones.slice(0, 6).join(", "))}${d.ediciones.length > 6 ? ` y ${d.ediciones.length - 6} más` : ""}.</p>` : ""}
      <div class="imp-acc"><button class="btn primary" data-importar>${ico("upload", "sm")}Importar en ${esc(orgNombre(a.orgId))}</button></div>`
      : '<p class="muted imp-warn">Elegí la organización para ver el resumen de cambios.</p>'}
    ${a.avisos.length ? `<details class="imp-avisos"><summary>${a.avisos.length} aviso(s) de validación</summary>${a.avisos.slice(0, 60).map((x) => `<div class="aviso">${esc(x)}</div>`).join("")}</details>` : ""}</div>`;
}

async function crearOrgDesde(a, redo) {
  const sug = nombreEmpresa(a.nombre);
  const ok = await modal({ titulo: "Crear organización", aceptar: "Crear", html: `<label class="campo">Nombre<input type="text" name="nombre" value="${esc(sug)}" autofocus></label>`,
    validar: async (dlg) => { const n = valor(dlg, "nombre"); if (!n) throw new Error("Ingresá un nombre."); const o = await st.backend.crearOrg(n); a.orgId = o.id; } });
  if (ok) { await st.recargar(); redo(); }
}

async function confirmarImportacion(a, btn, redo) {
  const d = calcDiff(a);
  const aviso = d.ediciones.length ? `<p class="imp-warn">${ico("circle-alert", "sm")}<b>${d.ediciones.length}</b> entidad(es) fueron editadas a mano después de la última importación y esos cambios <b>se perderán</b>.</p>` : "";
  const ok = await confirmar("Confirmar importación", `<p>Se reemplazarán los datos de <b>${esc(orgNombre(a.orgId))}</b> (${esc(a.tipos.map((t) => TIPOS[t].plural).join(", "))}) con el contenido de <b>${esc(a.nombre)}</b>:</p>
    <ul><li>${d.nuevas} nuevas · ${d.actualizadas} actualizadas · ${d.restauradas} restauradas</li><li>${d.archivadas} se archivan (recuperables)</li></ul>${aviso}`, "Importar");
  if (!ok) return;
  await conBoton(btn, async () => {
    const r = await st.backend.importar(a.orgId, a.entidades, a.nombre, a.tipos);
    Object.assign(a, { estado: "hecho", resumen: r });
    recordarOrg(a.nombre, a.orgId);
    await st.recargar(); redo(); toast(`Importación lista: ${r.nuevas} nuevas, ${r.actualizadas} actualizadas, ${r.archivadas} archivadas`);
  });
}
