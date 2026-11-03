// Listas de empleados / vehículos / proveedores y ficha editable (drawer).
import { COLORES, evaluar, fmtFecha } from "../rules.js";
import { construirRegistros } from "../loader.js";
import { esc, ico, toast, conBoton, fmtFechaHora } from "../util.js";
import { st, ESTADOS, corte, umbral, orgNombre, orgsActivas } from "../estado.js";
import { TIPOS, entidadesAFilas, claveEntidad, peorEstado } from "../modelo.js";
import { puede } from "../permisos.js";
import { cuilValido, dominioValido, normalizarDominio } from "../validadores.js";
import { abrirDrawer, cerrarDrawer } from "../ui/drawer.js";
import { confirmar } from "../ui/modal.js";

const PAGINA = 25;
const ui = { tipo: null, org: "", estado: "", archivadas: false, pagina: 0, orden: { key: "estado", dir: 1 } };
const FILTROS_ESTADO = [["", "Todos los estados"], ["alertas", "Con alertas (vencido / por vencer)"], ...ESTADOS.map((e) => [e, e])];

const badge = (e) => e ? `<span class="badge" style="color:${COLORES[e][0]};background:${COLORES[e][1]}">${esc(e)}</span>` : '<span class="muted">Sin documentos</span>';
const idMostrar = (e) => e.tipo === "proveedor" || String(e.identificador).startsWith("~") ? "" : e.identificador;

/** Evalúa una entidad: registros, peor estado y próximo vencimiento. */
function evaluarEntidad(e) {
  const regs = construirRegistros(entidadesAFilas([{ ...e, archivada_en: null }], orgNombre), corte(), umbral());
  const proximo = regs.map((r) => r.vencimiento).filter(Boolean).sort((a, b) => a - b)[0] ?? null;
  const cuenta = (est) => regs.filter((r) => r.estado === est).length;
  return { regs, peor: peorEstado(regs, ESTADOS), proximo, venc: cuenta("Vencido"), porv: cuenta("Por vencer"), pend: cuenta("Pendiente de aprobación") };
}

export function renderEntidades(cont, tipo) {
  if (ui.tipo !== tipo) Object.assign(ui, { tipo, org: "", estado: "", archivadas: false, pagina: 0, orden: { key: "estado", dir: 1 } });
  const T = TIPOS[tipo], rol = st.perfil.rol;
  const activas = new Set(orgsActivas().map((o) => o.id));
  const t = st.f.texto.trim().toLowerCase();

  let lista = st.datos.entidades.filter((e) => e.tipo === tipo && activas.has(e.org_id) && !!e.archivada_en === ui.archivadas)
    .filter((e) => !ui.org || e.org_id === ui.org)
    .filter((e) => !t || `${e.etiqueta} ${idMostrar(e)} ${e.subgrupo}`.toLowerCase().includes(t))
    .map((e) => ({ e, ev: evaluarEntidad(e) }))
    .filter(({ ev }) => !ui.estado || (ui.estado === "alertas" ? ev.venc + ev.porv > 0 : ev.peor === ui.estado));

  const { key, dir } = ui.orden, orden = (p) => p == null ? 99 : ESTADOS.indexOf(p);
  const clave = { estado: ({ ev }) => orden(ev.peor), etiqueta: ({ e }) => e.etiqueta.toLowerCase(), org: ({ e }) => orgNombre(e.org_id).toLowerCase(),
    id: ({ e }) => idMostrar(e), proximo: ({ ev }) => ev.proximo?.getTime() ?? 9e15, actualizada: ({ e }) => e.actualizada_en };
  lista.sort((a, b) => { const x = clave[key](a), y = clave[key](b); return dir * (x > y ? 1 : x < y ? -1 : 0) || a.e.etiqueta.localeCompare(b.e.etiqueta); });

  const paginas = Math.max(1, Math.ceil(lista.length / PAGINA)); ui.pagina = Math.min(ui.pagina, paginas - 1);
  const ini = ui.pagina * PAGINA;
  const col = (k, l) => `<th data-k="${k}"${key === k ? ` aria-sort="${dir > 0 ? "ascending" : "descending"}"` : ""}>${l}</th>`;
  const hayAdminArchivo = puede(rol, "verArchivadas");

  cont.innerHTML = `<div class="card">
    <div class="card-head wrap"><div><h2>${ui.archivadas ? `${T.plural} archivados` : T.plural}</h2>
      <p class="muted">${lista.length} registro(s)${ui.archivadas ? " · recuperables por un administrador" : ""}</p></div>
      <div class="acciones">${hayAdminArchivo ? `<button class="btn" id="e-arch" aria-pressed="${ui.archivadas}">${ico(ui.archivadas ? "eye" : "archive")}${ui.archivadas ? "Ver activos" : "Ver archivados"}</button>` : ""}
      ${puede(rol, "agregarEntidad") && !ui.archivadas ? `<button class="btn primary" id="e-nuevo">${ico("plus")}Agregar ${T.singular.toLowerCase()}</button>` : ""}</div></div>
    <div class="filtros-form">
      <select id="e-org" aria-label="Organización"><option value="">Todas las organizaciones</option>${orgsActivas().map((o) => `<option value="${o.id}"${ui.org === o.id ? " selected" : ""}>${esc(o.nombre)}</option>`).join("")}</select>
      <select id="e-estado" aria-label="Estado">${FILTROS_ESTADO.map(([v, l]) => `<option value="${esc(v)}"${ui.estado === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>
    </div>
    <div class="tabla-wrap"><table class="ent"><thead><tr>${col("etiqueta", T.nombreEtiqueta)}${T.idEtiqueta ? col("id", T.idEtiqueta) : ""}${col("org", "Organización")}<th>${esc(T.grupoEtiqueta)}</th>${col("estado", "Estado")}<th>Alertas</th>${col("proximo", "Próx. vencimiento")}${col("actualizada", "Actualizado")}<th></th></tr></thead>
    <tbody>${lista.slice(ini, ini + PAGINA).map(({ e, ev }) => `<tr data-id="${e.id}" class="fila-click"><td><b>${esc(e.etiqueta)}</b></td>
      ${T.idEtiqueta ? `<td>${esc(idMostrar(e)) || '<span class="muted">—</span>'}</td>` : ""}<td>${esc(orgNombre(e.org_id))}</td><td>${esc(e.subgrupo) || '<span class="muted">—</span>'}</td>
      <td>${badge(ev.peor)}</td><td class="muted">${[ev.venc && `${ev.venc} vencido${ev.venc > 1 ? "s" : ""}`, ev.porv && `${ev.porv} por vencer`, ev.pend && `${ev.pend} en trámite`].filter(Boolean).join(" · ") || "—"}</td>
      <td>${fmtFecha(ev.proximo) || "—"}</td><td class="muted">${fmtFecha(new Date(e.actualizada_en))}</td>
      <td class="acc"><button class="btn sm">${ico(puede(rol, "editarEntidad") && !e.archivada_en ? "pencil" : "eye", "sm")}${puede(rol, "editarEntidad") && !e.archivada_en ? "Editar" : "Ver"}</button></td></tr>`).join("")
      || `<tr><td colspan="9" class="muted" style="text-align:center;padding:32px">${st.datos.entidades.some((x) => x.tipo === tipo) ? "Sin resultados para los filtros actuales." : `Todavía no hay ${T.plural.toLowerCase()} cargados.`}</td></tr>`}</tbody></table></div>
    <div class="paginacion"><span class="muted">${lista.length ? `${ini + 1}–${Math.min(ini + PAGINA, lista.length)} de ${lista.length}` : ""}</span>
      <div><button class="btn sm" id="e-prev"${ui.pagina === 0 ? " disabled" : ""}>Anterior</button><button class="btn sm" id="e-next"${ui.pagina >= paginas - 1 ? " disabled" : ""}>Siguiente</button></div></div></div>`;

  const redo = () => renderEntidades(cont, tipo);
  cont.querySelector("#e-org").onchange = (ev) => { ui.org = ev.target.value; ui.pagina = 0; redo(); };
  cont.querySelector("#e-estado").onchange = (ev) => { ui.estado = ev.target.value; ui.pagina = 0; redo(); };
  cont.querySelector("#e-prev").onclick = () => { ui.pagina--; redo(); };
  cont.querySelector("#e-next").onclick = () => { ui.pagina++; redo(); };
  cont.querySelector("#e-arch")?.addEventListener("click", () => { ui.archivadas = !ui.archivadas; ui.pagina = 0; redo(); });
  cont.querySelector("#e-nuevo")?.addEventListener("click", () => abrirFicha(tipo, null));
  cont.querySelectorAll("th[data-k]").forEach((th) => th.onclick = () => { ui.orden = { key: th.dataset.k, dir: ui.orden.key === th.dataset.k ? -ui.orden.dir : 1 }; redo(); });
  cont.querySelectorAll("tr[data-id]").forEach((tr) => tr.onclick = () => abrirFicha(tipo, st.datos.entidades.find((e) => e.id === tr.dataset.id)));
}

// ---------- Ficha ----------
function filaDoc(d, editable, nombreFijo) {
  const ev = estadoDoc(d);
  return `<tr data-nombre="${esc(d.nombre)}"><td class="doc-nombre">${nombreFijo ? `<b>${esc(d.nombre)}</b>` : `<input type="text" name="nombre" value="${esc(d.nombre)}" ${editable ? "" : "disabled"} aria-label="Nombre del documento">`}</td>
    <td><input type="date" name="vencimiento" value="${esc(d.vencimiento || "")}" ${editable ? "" : "disabled"} aria-label="Vencimiento"></td>
    <td class="c"><input type="checkbox" name="presentado" ${d.presentado ? "checked" : ""} ${editable ? "" : "disabled"} aria-label="Presentado, pendiente de aprobación"></td>
    <td class="c"><input type="checkbox" name="no_aplica" ${d.no_aplica ? "checked" : ""} ${editable ? "" : "disabled"} aria-label="No aplica"></td>
    <td class="c"><input type="checkbox" name="requerido" ${d.requerido ? "checked" : ""} ${editable ? "" : "disabled"} aria-label="Requerido"></td>
    <td><input type="text" name="obs" value="${esc(d.obs || "")}" placeholder="Observación" ${editable ? "" : "disabled"} aria-label="Observación"></td>
    <td class="est">${ev}</td>${editable ? `<td class="c"><button type="button" class="icon-btn" data-quitar aria-label="Quitar documento">${ico("x", "sm")}</button></td>` : "<td></td>"}</tr>`;
}
function estadoDoc(d) {
  const valor = d.no_aplica ? "NA" : d.vencimiento ? new Date(`${d.vencimiento}T00:00:00Z`) : null;
  const r = evaluar(valor, !!d.presentado, !!d.requerido, corte(), umbral());
  return r ? `<span class="badge" style="color:${COLORES[r.estado][0]};background:${COLORES[r.estado][1]}" title="${esc(r.detalle)}">${esc(r.estado)}</span>` : '<span class="muted">No aplica</span>';
}
function leerDocs(tbody) {
  return [...tbody.querySelectorAll("tr")].map((tr) => {
    const g = (n) => tr.querySelector(`[name=${n}]`);
    return { nombre: (g("nombre")?.value ?? tr.dataset.nombre).trim(), vencimiento: g("vencimiento").value || null, presentado: g("presentado").checked,
      no_aplica: g("no_aplica").checked, requerido: g("requerido").checked, obs: g("obs").value.trim() };
  });
}

export function abrirFicha(tipo, e) {
  const T = TIPOS[tipo], rol = st.perfil.rol, nueva = !e, archivada = !!e?.archivada_en;
  const editable = puede(rol, nueva ? "agregarEntidad" : "editarEntidad") && !archivada;
  const orgs = orgsActivas();
  const idActual = e ? (String(e.identificador).startsWith("~") ? "" : e.identificador) : "";
  const docs0 = e ? e.documentos.map((d) => ({ ...d })) : st.datos.tipos.filter((x) => x.categoria === T.categoria && x.requerido).map((x) => ({ nombre: x.nombre, requerido: true, vencimiento: null, presentado: false, no_aplica: false, obs: "" }));
  const catalogo = st.datos.tipos.filter((x) => x.categoria === T.categoria).map((x) => x.nombre);

  const html = `<form id="ficha" novalidate>
    ${archivada ? `<div class="banner">${ico("archive", "sm")}Archivada el ${fmtFechaHora(e.archivada_en)}. Un administrador puede restaurarla o eliminarla definitivamente.</div>` : ""}
    <div class="grid-form">
      <label class="campo">Organización<select name="org" ${nueva && editable ? "" : "disabled"}>${(nueva ? orgs : st.datos.orgs).map((o) => `<option value="${o.id}"${(e?.org_id ?? orgs[0]?.id) === o.id ? " selected" : ""}>${esc(o.nombre)}</option>`).join("")}</select></label>
      <label class="campo">${esc(T.nombreEtiqueta)}<input type="text" name="etiqueta" value="${esc(e?.etiqueta || "")}" ${editable ? "" : "disabled"} autocomplete="off"></label>
      ${T.idEtiqueta ? `<label class="campo">${esc(T.idEtiqueta)}<input type="text" name="identificador" value="${esc(idActual)}" ${editable ? "" : "disabled"} autocomplete="off" inputmode="${tipo === "empleado" ? "numeric" : "text"}" placeholder="${tipo === "empleado" ? "11 dígitos, sin guiones" : "AB123CD o ABC123"}"></label>` : ""}
      <label class="campo">${esc(T.grupoEtiqueta)}<input type="text" name="subgrupo" value="${esc(e?.subgrupo || "")}" ${editable ? "" : "disabled"} autocomplete="off"></label>
    </div>
    <h3>Documentos</h3>
    <div class="tabla-wrap docs"><table><thead><tr><th>Documento</th><th>Vencimiento</th><th class="c" title="Presentado y pendiente de aprobación">Pendiente</th><th class="c">No aplica</th><th class="c" title="Requerido">Req.</th><th>Observación</th><th>Estado</th><th></th></tr></thead>
    <tbody>${docs0.map((d) => filaDoc(d, editable, !nueva || catalogo.includes(d.nombre))).join("") || ""}</tbody></table></div>
    ${editable ? `<div class="agregar-doc"><input type="text" id="nuevo-doc" list="catalogo-docs" placeholder="Agregar documento…" autocomplete="off"><datalist id="catalogo-docs">${catalogo.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
      <button type="button" class="btn" id="btn-doc">${ico("plus", "sm")}Agregar</button></div>` : ""}
    <p class="muted nota">El estado se calcula con la fecha de corte (${fmtFecha(corte())}). “Pendiente” = presentado y a la espera de aprobación.</p>
    <p class="error" id="ficha-err" role="alert"></p>
    <footer class="drawer-foot">
      ${editable ? `<button type="submit" class="btn primary" id="f-guardar">${ico("check", "sm")}Guardar</button>` : ""}
      <button type="button" class="btn" id="f-cerrar">${editable ? "Cancelar" : "Cerrar"}</button>
      <span class="grow"></span>
      ${!nueva && !archivada && puede(rol, "archivarEntidad") ? `<button type="button" class="btn danger" id="f-archivar">${ico("archive", "sm")}Archivar</button>` : ""}
      ${archivada && puede(rol, "archivarEntidad") ? `<button type="button" class="btn" id="f-restaurar">${ico("archive-restore", "sm")}Restaurar</button>` : ""}
      ${archivada && puede(rol, "eliminarEntidad") ? `<button type="button" class="btn danger" id="f-eliminar">${ico("trash-2", "sm")}Eliminar definitivamente</button>` : ""}
    </footer></form>`;
  const dr = abrirDrawer({ titulo: nueva ? `Nuevo: ${T.singular.toLowerCase()}` : e.etiqueta, subtitulo: nueva ? "" : `${esc(orgNombre(e.org_id))} · actualizado ${fmtFechaHora(e.actualizada_en)}`, html });
  const form = dr.el.querySelector("#ficha"), tbody = form.querySelector("tbody"), err = form.querySelector("#ficha-err");
  const refrescarEstados = () => { const docs = leerDocs(tbody); [...tbody.children].forEach((tr, i) => { tr.querySelector(".est").innerHTML = estadoDoc(docs[i]); }); };
  tbody.addEventListener("input", refrescarEstados); tbody.addEventListener("change", refrescarEstados);
  tbody.addEventListener("click", (ev) => { if (ev.target.closest("[data-quitar]")) ev.target.closest("tr").remove(); });
  form.querySelector("#f-cerrar").onclick = dr.cerrar;

  form.querySelector("#btn-doc")?.addEventListener("click", () => {
    const inp = form.querySelector("#nuevo-doc"), nombre = inp.value.trim();
    if (!nombre) return inp.focus();
    if (leerDocs(tbody).some((d) => d.nombre.toLowerCase() === nombre.toLowerCase())) { err.textContent = `El documento “${nombre}” ya está en la lista.`; return; }
    err.textContent = "";
    tbody.insertAdjacentHTML("beforeend", filaDoc({ nombre, requerido: true, vencimiento: null, presentado: false, no_aplica: false, obs: "" }, true, true));
    inp.value = ""; refrescarEstados();
  });
  form.querySelector("#nuevo-doc")?.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); form.querySelector("#btn-doc").click(); } });

  form.onsubmit = async (ev) => {
    ev.preventDefault(); err.textContent = "";
    const v = (n) => form.querySelector(`[name=${n}]`)?.value.trim() ?? "";
    const etiqueta = v("etiqueta"), subgrupo = v("subgrupo"), org_id = v("org") || e?.org_id;
    let identificador;
    if (!etiqueta) return void (err.textContent = `Completá “${T.nombreEtiqueta}”.`);
    if (!org_id) return void (err.textContent = "Elegí una organización (un administrador debe crearla primero).");
    if (tipo === "empleado") {
      const c = v("identificador").replace(/[\s-]/g, "");
      if (!c && e && String(e.identificador).startsWith("~")) identificador = e.identificador;
      else if (!cuilValido(c)) return void (err.textContent = "El CUIL debe tener 11 dígitos y un dígito verificador válido.");
      else identificador = c;
    } else if (tipo === "vehiculo") {
      if (!dominioValido(v("identificador"))) return void (err.textContent = "El dominio no tiene un formato válido (AB123CD o ABC123).");
      identificador = normalizarDominio(v("identificador"));
    } else identificador = claveEntidad("proveedor", "", etiqueta, subgrupo);
    const documentos = leerDocs(tbody);
    const vistos = new Set();
    for (const d of documentos) {
      if (!d.nombre) return void (err.textContent = "Hay un documento sin nombre.");
      if (vistos.has(d.nombre.toLowerCase())) return void (err.textContent = `El documento “${d.nombre}” está repetido.`);
      vistos.add(d.nombre.toLowerCase());
    }
    await conBoton(form.querySelector("#f-guardar"), async () => {
      try {
        await st.backend.guardarEntidad({ id: e?.id ?? null, org_id, esperada: e?.actualizada_en ?? null,
          ent: { tipo, etiqueta, identificador, subgrupo, datos: e?.datos || {}, documentos } });
      } catch (x) {
        if (x.codigo === "conflicto") { dr.cerrar(); await st.recargar(); }
        throw x;
      }
      dr.cerrar(); await st.recargar(); toast(nueva ? `${T.singular} agregado` : "Cambios guardados");
    });
  };

  form.querySelector("#f-archivar")?.addEventListener("click", async (ev) => {
    if (!(await confirmar("Archivar", `“${esc(e.etiqueta)}” dejará de contar en el panel y los reportes. Podés restaurarlo desde “Ver archivados”.`, "Archivar", true))) return;
    await conBoton(ev.currentTarget, async () => { await st.backend.archivar(e.id, true); dr.cerrar(); await st.recargar(); toast("Archivado"); });
  });
  form.querySelector("#f-restaurar")?.addEventListener("click", (ev) =>
    conBoton(ev.currentTarget, async () => { await st.backend.archivar(e.id, false); dr.cerrar(); await st.recargar(); toast("Restaurado"); }));
  form.querySelector("#f-eliminar")?.addEventListener("click", async (ev) => {
    if (!(await confirmar("Eliminar definitivamente", `Se borra “${esc(e.etiqueta)}” y sus documentos. <b>No se puede deshacer.</b>`, "Eliminar", true))) return;
    await conBoton(ev.currentTarget, async () => { await st.backend.eliminar(e.id); dr.cerrar(); await st.recargar(); toast("Eliminado definitivamente"); });
  });
  form.querySelector("[name=etiqueta]").focus();
}
export { cerrarDrawer };
