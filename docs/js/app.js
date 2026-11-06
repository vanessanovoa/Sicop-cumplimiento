// Arranque, sesión, navegación por rol y barra superior.
import { COLORES, fmtFecha } from "./rules.js";
import { generarPdf } from "./report.js";
import { $, esc, ico, iniciales, toast, fmtISO, conBoton } from "./util.js";
import { st, aplicarDatos, corte, umbral, registros, filtrar, criticos, orgsActivas, hayDatos } from "./estado.js";
import { puede, ROLES } from "./permisos.js";
import { errorClave } from "./validadores.js";
import { configurado, crearBackend } from "./backend/supabase.js";
import { crearBackendMemoria } from "./backend/memoria.js";
import { renderPanel, configurarChart, onCambioPanel } from "./views/panel.js";
import { renderEntidades } from "./views/entidades.js";
import { renderImportar, procesar } from "./views/importar.js";
import { renderOrganizaciones, renderUsuarios, renderAjustes, renderCuenta } from "./views/admin.js";
import { cerrarDrawer } from "./ui/drawer.js";
import { abrirFicha } from "./views/entidades.js";

const DEV = ["localhost", "127.0.0.1"].includes(location.hostname) && new URLSearchParams(location.search).has("dev");

// ---------- Rutas ----------
const RUTAS = {
  "panel":         { titulo: "Panel de cumplimiento", crumb: "Panel", permiso: "ver", sub: () => `Corte al ${fmtFecha(corte())} · “Por vencer” hasta ${umbral()} días` },
  "entidades/empleado":  { titulo: "Empleados", crumb: "Empleados", permiso: "ver", sub: () => "Personas con sus documentos", vista: (c) => renderEntidades(c, "empleado") },
  "entidades/vehiculo":  { titulo: "Vehículos", crumb: "Vehículos", permiso: "ver", sub: () => "Unidades con sus documentos", vista: (c) => renderEntidades(c, "vehiculo") },
  "entidades/proveedor": { titulo: "Proveedores", crumb: "Proveedores", permiso: "ver", sub: () => "Requisitos y documentos de proveedores", vista: (c) => renderEntidades(c, "proveedor") },
  "importar":      { titulo: "Importar Excel", crumb: "Importar", permiso: "importar", sub: () => "Carga semanal de archivos", vista: renderImportar },
  "organizaciones": { titulo: "Organizaciones", crumb: "Organizaciones", permiso: "gestionarOrgs", sub: () => "Catálogo de empresas", vista: renderOrganizaciones },
  "usuarios":      { titulo: "Usuarios", crumb: "Usuarios", permiso: "gestionarUsuarios", sub: () => "Cuentas y roles", vista: renderUsuarios },
  "ajustes":       { titulo: "Parámetros", crumb: "Parámetros", permiso: "gestionarAjustes", sub: () => "Reglas de clasificación", vista: renderAjustes },
  "cuenta":        { titulo: "Mi cuenta", crumb: "Mi cuenta", permiso: "ver", sub: () => "Datos y contraseña", vista: renderCuenta },
};
const NAV = [
  ["General", [["panel", "layout-dashboard", "Panel"]]],
  ["Entidades", [["entidades/empleado", "users", "Empleados"], ["entidades/vehiculo", "truck", "Vehículos"], ["entidades/proveedor", "file-text", "Proveedores"]]],
  ["Administración", [["importar", "upload", "Importar Excel"], ["organizaciones", "building-2", "Organizaciones"], ["usuarios", "user-cog", "Usuarios"], ["ajustes", "sliders-horizontal", "Parámetros"]]],
];
const rutaActual = () => location.hash.replace(/^#\//, "") || "panel";

function construirNav() {
  $("nav").innerHTML = NAV.map(([grupo, items]) => {
    const vis = items.filter(([r]) => puede(st.perfil.rol, RUTAS[r].permiso));
    return vis.length ? `<span class="nav-label">${grupo}</span>${vis.map(([r, i, l]) => `<a href="#/${r}" data-ruta="${r}">${ico(i)}${l}</a>`).join("")}` : "";
  }).join("");
  $("nav").querySelectorAll("a").forEach((a) => a.addEventListener("click", cerrarMenu));
}

function render() {
  if (!st.perfil) return;
  let r = rutaActual();
  if (!RUTAS[r] || !puede(st.perfil.rol, RUTAS[r].permiso)) { location.hash = "#/panel"; return; }
  st.vista = r; const R = RUTAS[r];
  $("page-title").textContent = R.titulo; $("crumb").textContent = R.crumb; $("page-sub").textContent = R.sub();
  document.querySelectorAll("#nav a").forEach((a) => a.dataset.ruta === r ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  const esPanel = r === "panel";
  $("view-panel").hidden = !esPanel; $("view-main").hidden = esPanel;
  $("head-actions").hidden = !esPanel || !puede(st.perfil.rol, "pdf");
  $("wrap-org").hidden = !esPanel;
  renderShell();
  if (esPanel) renderPanel(); else R.vista($("view-main"));
}
st.recargar = async () => {
  try { aplicarDatos(await st.backend.cargar()); }
  catch (e) { toast(`No se pudieron actualizar los datos: ${e.message}`, "error"); return; }
  render();
};
onCambioPanel(renderShell);

// ---------- Barra superior ----------
function renderShell() {
  const empresas = orgsActivas().map((o) => o.nombre).sort();
  const sel = empresas.filter((e) => st.f.empresas.has(e));
  $("org-label").textContent = !empresas.length ? "Organizaciones" : sel.length === empresas.length ? "Todas las organizaciones" : sel.length === 1 ? sel[0] : `${sel.length} de ${empresas.length} organizaciones`;
  $("corte-chip").textContent = fmtFecha(corte());

  $("pop-org").innerHTML = `<div class="pop-title">Organizaciones</div>` + (empresas.length ? `<label class="check-item"><input type="checkbox" data-all ${sel.length === empresas.length ? "checked" : ""}><b>Todas</b></label>` +
    empresas.map((e) => `<label class="check-item"><input type="checkbox" data-e="${esc(e)}" ${st.f.empresas.has(e) ? "checked" : ""}>${esc(e)}</label>`).join("") : '<p class="muted" style="padding:8px 10px">Sin organizaciones cargadas.</p>');
  $("pop-org").querySelectorAll("input").forEach((i) => i.onchange = () => {
    if (i.dataset.all !== undefined) { i.checked ? empresas.forEach((e) => st.f.empresas.add(e)) : st.f.empresas.clear(); }
    else { i.checked ? st.f.empresas.add(i.dataset.e) : st.f.empresas.delete(i.dataset.e); }
    st.pagina = 0; renderPanel(); renderShell();
  });

  const crit = hayDatos() ? criticos(filtrar(registros(), false)) : [];
  $("bell-n").hidden = !crit.length; $("bell-n").textContent = crit.length > 99 ? "99+" : crit.length;
  $("pop-bell").innerHTML = `<div class="pop-title">Alertas · ${crit.length} vencido(s)</div>` + (crit.length ? `<ul class="lista">${crit.slice(0, 5).map((r) => `<li><span class="ini">${esc(iniciales(r.entidad))}</span>
    <div class="t"><b>${esc(r.entidad)}</b><span>${esc(r.documento)} · ${esc(r.empresa)}</span></div><span class="badge" style="color:${COLORES.Vencido[0]};background:${COLORES.Vencido[1]}">${r.dias != null ? `hace ${-r.dias} d` : "Faltante"}</span></li>`).join("")}</ul>`
    : '<p class="muted" style="padding:8px 10px">Sin alertas.</p>');
  $("email").textContent = st.perfil.nombre || st.perfil.email;
  $("avatar").textContent = (st.perfil.nombre || st.perfil.email)[0].toUpperCase();
  $("rol").textContent = ROLES[st.perfil.rol];
}

const POPS = [["btn-org", "pop-org"], ["btn-bell", "pop-bell"], ["btn-user", "pop-user"]];
function cerrarPops(excepto) { POPS.forEach(([, p]) => { if (p !== excepto) $(p).hidden = true; }); }
POPS.forEach(([b, p]) => $(b).onclick = (e) => { e.stopPropagation(); const abrir = $(p).hidden; cerrarPops(p); $(p).hidden = !abrir; });
document.addEventListener("click", (e) => { if (!e.target.closest(".popover")) cerrarPops(); });
const cerrarMenu = () => { $("side").classList.remove("open"); $("scrim").hidden = true; };
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { cerrarPops(); cerrarMenu(); } });
$("btn-menu").onclick = () => { $("side").classList.add("open"); $("scrim").hidden = false; };
$("scrim").onclick = cerrarMenu;
$("pop-user").addEventListener("click", () => { $("pop-user").hidden = true; });

// ---------- PDF ----------
function pdf(completo) {
  try {
    const todos = registros(), reg = completo ? todos : filtrar(todos), c = corte();
    const f = completo ? "" : `Organización: ${[...st.f.empresas].join(", ")} | Categoría: ${[...st.f.categorias].join(", ")} | Estado: ${[...st.f.estados].join(", ")}`;
    const blob = generarPdf(window.jspdf.jsPDF, reg, c, umbral(), f);
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `reporte_sicop_${completo ? "completo" : "filtrado"}_${fmtISO(c).replaceAll("-", "")}.pdf`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast("Reporte PDF generado");
  } catch (e) { toast(`No se pudo generar el PDF: ${e.message}`, "error"); }
}
$("pdf-filtrado").onclick = () => pdf(false);
$("pdf-completo").onclick = () => pdf(true);
$("buscar").oninput = (e) => {
  st.f.texto = e.target.value; st.pagina = 0;
  if (!["panel", "entidades/empleado", "entidades/vehiculo", "entidades/proveedor"].includes(st.vista)) location.hash = "#/panel"; else render();
};
$("pag-prev").onclick = () => { st.pagina--; renderPanel(); };
$("pag-next").onclick = () => { st.pagina++; renderPanel(); };
window.addEventListener("hashchange", () => { cerrarDrawer(); $("pop-user").hidden = true; render(); });

// ---------- Sesión ----------
function pantalla(cual, msg = "") {
  $("shell").hidden = cual !== "app"; $("login").hidden = cual === "app";
  $("form-login").hidden = cual !== "login"; $("form-clave").hidden = cual !== "clave";
  if (cual === "login") { $("login-error").textContent = msg; $("login-pass").value = ""; }
}
async function entrar(perfil) {
  st.perfil = perfil;
  if (perfil.debe_cambiar_clave) { pantalla("clave"); $("clave-1").focus(); return; }
  try { aplicarDatos(await st.backend.cargar()); }
  catch (e) { st.perfil = null; return pantalla("login", `No se pudieron cargar los datos: ${e.message}`); }
  construirNav(); pantalla("app");
  if (!location.hash || !RUTAS[rutaActual()]) location.hash = "#/panel";
  render();
  if (puede(perfil.rol, "importar") && !hayDatos() && rutaActual() === "panel") location.hash = "#/importar";
}
$("form-login").onsubmit = async (e) => {
  e.preventDefault();
  await conBoton($("btn-login"), async () => {
    $("login-error").textContent = "";
    try { await entrar(await st.backend.iniciarSesion($("login-user").value, $("login-pass").value)); }
    catch (err) { $("login-error").textContent = err.message; $("login-pass").value = ""; $("login-pass").focus(); }
  });
};
$("form-clave").onsubmit = async (e) => {
  e.preventDefault();
  const err = $("clave-error"); err.textContent = "";
  if (errorClave($("clave-1").value)) return void (err.textContent = errorClave($("clave-1").value));
  if ($("clave-1").value !== $("clave-2").value) return void (err.textContent = "Las contraseñas no coinciden.");
  await conBoton($("btn-clave"), async () => {
    try { await st.backend.cambiarClave($("clave-1").value); $("form-clave").reset(); await entrar(st.backend.perfil); }
    catch (x) { err.textContent = x.message; }
  });
};
async function salir() {
  await st.backend.cerrarSesion();
  cerrarDrawer(); st.perfil = null; st.f.texto = ""; $("buscar").value = ""; location.hash = "";
  pantalla("login");
}
$("salir").onclick = salir; $("clave-salir").onclick = salir;

// ---------- Arranque ----------
async function seedDev() {
  const q = new URLSearchParams(location.search), rol = q.get("rol") || "admin";
  const be = crearBackendMemoria({ perfil: { user_id: "u-dev", email: `${rol}@demo.test`, nombre: `Demo ${ROLES[rol] || rol}`, rol: "admin", activo: true, debe_cambiar_clave: q.has("clave") } });
  const m = q.get("muestra");
  if (m) {
    const orgA = await be.crearOrg("Empresa A"); const demo = q.has("demo") ? await be.crearOrg("Empresa B") : null;
    await be.crearOrg("Empresa vacía");
    const { filasAEntidades } = await import("./modelo.js");
    const buf = await (await fetch(m)).arrayBuffer();
    const w = new Worker("js/worker.bundle.js");
    const leer = (nombre, org) => new Promise((resolve, reject) => {
      w.onmessage = (e) => e.data.ok ? resolve(e.data) : reject(new Error(e.data.error));
      w.postMessage({ id: 1, buffer: buf.slice(0), nombre, empresa: org }, []);
    });
    for (const [nombre, org] of [["Empresa A F-1.xlsx", orgA], ...(demo ? [["Empresa B F-1.xlsx", demo]] : [])]) {
      const r = await leer(nombre, org.nombre), { entidades } = filasAEntidades(r.filas);
      await be.importar(org.id, entidades, nombre, null);
    }
    w.terminate();
  }
  be.perfil.rol = rol;                            // a partir de acá se aplican los permisos del rol elegido
  return be;
}

async function arrancar() {
  configurarChart();
  if (DEV) {
    st.backend = await seedDev(); await entrar(st.backend.perfil);
    const f = new URLSearchParams(location.search).get("ficha");      // solo para capturas de pantalla locales
    if (f) { const [n, t] = f.startsWith("nuevo-") ? [true, f.slice(6)] : [false, f]; abrirFicha(t, n ? null : st.datos.entidades.find((e) => e.tipo === t && e.documentos.some((d) => !d.vencimiento))); }
    const arch = new URLSearchParams(location.search).get("archivo");   // solo capturas locales: simula elegir un Excel
    if (arch) { const b = await (await fetch(arch)).arrayBuffer(); procesar([new File([b], "Empresa A F-1 Objetivos.xlsx")], render); }
    return;
  }
  if (!configurado()) { st.backend = null; pantalla("login", "Falta configurar Supabase: completá docs/js/config.js (ver README-SUPABASE.md)."); $("btn-login").disabled = true; return; }
  st.backend = crearBackend();
  try { const p = await st.backend.init(); p ? await entrar(p) : pantalla("login"); }
  catch (e) { pantalla("login", e.message); }
}
arrancar();
