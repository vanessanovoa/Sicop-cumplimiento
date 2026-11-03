// Vista Panel: indicadores, gráficos y detalle de documentos (lee de los datos compartidos).
import { COLORES, fmtFecha } from "../rules.js";
import { resumen } from "../report.js";
import { $, esc, ico, iniciales } from "../util.js";
import { st, CATEGORIAS, ESTADOS, corte, umbral, registros, filtrar, criticos, hayDatos } from "../estado.js";
import { puede } from "../permisos.js";

const PAGINA = 25;
const ICO_ESTADO = { "Vencido": "triangle-alert", "Por vencer": "clock", "Pendiente de aprobación": "hourglass", "Al día": "circle-check" };
const COLUMNAS = [["empresa", "Organización"], ["categoria", "Categoría"], ["entidad", "Entidad"], ["id", "Identificador"],
  ["documento", "Documento"], ["vencimiento", "Vencimiento"], ["dias", "Días"], ["estado", "Estado"], ["detalle", "Detalle"]];
let alCambiar = () => {};
export const onCambioPanel = (fn) => { alCambiar = fn; };

// ---------- Gráficos (Chart.js) ----------
const charts = {};
function grafico(id, cfg) {
  charts[id]?.destroy();
  charts[id] = new Chart($(id), cfg);
}
export function configurarChart() {
  Chart.defaults.font.family = "Inter, system-ui, sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.color = "#64748B";
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.boxWidth = 8;
}
function chartSemanas(base) {
  const c = corte(), sem = 13, etiquetas = ["Vencidos", ...Array.from({ length: sem }, (_, i) => fmtFecha(new Date(c.getTime() + (i * 7 + 1) * 864e5)).slice(0, 5))];
  const colores = { Empleados: "#0F4183", Proveedores: "#4C86D1", "Vehículos": "#B3CDEF" };
  const datasets = CATEGORIAS.filter((k) => st.f.categorias.has(k)).map((k) => {
    const data = new Array(sem + 1).fill(0);
    for (const r of base) {
      if (r.categoria !== k || r.dias == null) continue;
      if (r.dias <= 0) data[0]++; else if (r.dias <= sem * 7) data[Math.ceil(r.dias / 7)]++;
    }
    return { label: k, data, backgroundColor: colores[k], borderRadius: 4, maxBarThickness: 28 };
  });
  grafico("ch-semanas", { type: "bar", data: { labels: etiquetas, datasets }, options: {
    maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
    scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, grid: { color: "#EEF2F7" }, border: { display: false } } },
    plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { title: (i) => i[0].dataIndex === 0 ? "Ya vencidos (con fecha)" : `Semana ${i[0].dataIndex} · desde ${i[0].label}` } } } } });
}
function chartOrgs(base) {
  const filas = resumen(base);
  grafico("ch-orgs", { type: "bar", data: { labels: filas.map((r) => r.empresa), datasets: ESTADOS.map((e) => ({
      label: e, data: filas.map((r) => r[e]), backgroundColor: COLORES[e][0], borderRadius: 4, maxBarThickness: 30 })) },
    options: { indexAxis: "y", maintainAspectRatio: false,
      scales: { x: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, grid: { color: "#EEF2F7" }, border: { display: false } }, y: { stacked: true, grid: { display: false } } },
      plugins: { legend: { position: "bottom" } } } });
}

// ---------- Render ----------
function chips(id, opciones, set, conteo, colores) {
  const el = $(id); el.replaceChildren();
  for (const o of opciones) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.setAttribute("aria-pressed", set.has(o));
    b.innerHTML = `${colores ? `<i style="background:${colores[o][0]}"></i>` : ""}${esc(o)}${conteo ? ` · ${conteo[o] ?? 0}` : ""}`;
    b.onclick = () => { set.has(o) ? set.delete(o) : set.add(o); st.pagina = 0; renderPanel(); alCambiar(); };
    el.append(b);
  }
}

function hero(base, porEstado) {
  const total = base.length, ok = porEstado["Al día"], pct = total ? Math.round(ok / total * 100) : 0;
  const R = 48, C = 2 * Math.PI * R;
  $("hero").innerHTML = `<small>Cumplimiento general</small>
    <div class="hero-main">
      <svg class="ring" viewBox="0 0 120 120" role="img" aria-label="${pct}% al día"><circle cx="60" cy="60" r="${R}" fill="none" stroke="#ffffff33" stroke-width="12"/>
        <circle cx="60" cy="60" r="${R}" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round" stroke-dasharray="${C * pct / 100} ${C}" transform="rotate(-90 60 60)"/></svg>
      <div><div class="hero-num">${pct}%</div><p>de los documentos están al día</p></div></div>
    <div class="hero-stats"><div><b>${total}</b><span>Auditados</span></div><div><b>${porEstado["Vencido"] + porEstado["Por vencer"]}</b><span>Con alerta</span></div><div><b>${porEstado["Pendiente de aprobación"]}</b><span>En trámite</span></div></div>`;
}

export function renderPanel() {
  const hay = hayDatos();
  $("vacio").hidden = hay; $("contenido").hidden = !hay;
  $("pdf-filtrado").hidden = $("pdf-completo").hidden = !hay;
  const admin = puede(st.perfil.rol, "importar");
  $("vacio-txt").textContent = admin ? "Importá los archivos Excel o cargá entidades a mano para empezar." : "Todavía no se cargaron datos. Pedile a un administrador que los cargue.";
  $("vacio-btn").hidden = !admin;
  $("page-sub").textContent = `Corte al ${fmtFecha(corte())} · “Por vencer” hasta ${umbral()} días`;
  if (!hay) return;

  const todos = registros(), base = filtrar(todos, false), vista = filtrar(todos);
  const porEstado = Object.fromEntries(ESTADOS.map((e) => [e, base.filter((r) => r.estado === e).length]));
  chips("f-estado", ESTADOS, st.f.estados, porEstado, COLORES);
  chips("f-categoria", CATEGORIAS, st.f.categorias);

  hero(base, porEstado);
  $("kpis").innerHTML = ESTADOS.map((e) => {
    const n = porEstado[e], p = base.length ? n / base.length * 100 : 0;
    return `<div class="kpi" style="--c:${COLORES[e][0]};--bg-c:${COLORES[e][1]}"><div class="kpi-ico">${ico(ICO_ESTADO[e])}</div><span>${esc(e)}</span><b>${n}</b>
      <div class="bar"><i style="width:${p}%"></i></div><small>${Math.round(p * 10) / 10}% del total</small></div>`;
  }).join("");

  chartSemanas(base); chartOrgs(base);

  $("criticos").innerHTML = criticos(base).slice(0, 6).map((r) => `<li><span class="ini">${esc(iniciales(r.entidad))}</span>
    <div class="t"><b>${esc(r.entidad)}</b><span>${esc(r.documento)} · ${esc(r.empresa)}</span></div>
    <span class="badge" style="color:${COLORES.Vencido[0]};background:${COLORES.Vencido[1]}">${r.dias != null ? `hace ${-r.dias} d` : "Faltante"}</span></li>`).join("")
    || '<li class="muted">Sin vencimientos para los filtros actuales.</li>';
  $("categorias").innerHTML = CATEGORIAS.map((k) => {
    const b = base.filter((r) => r.categoria === k), ok = b.filter((r) => r.estado === "Al día").length, p = b.length ? Math.round(ok / b.length * 100) : 0;
    return `<div class="cat"><div class="cat-top"><b>${k}</b><span>${p}% · ${ok} de ${b.length}</span></div><div class="bar"><i style="width:${p}%"></i></div></div>`;
  }).join("");

  const orden = Object.fromEntries(ESTADOS.map((e, i) => [e, i])), { key, dir } = st.orden;
  vista.sort((a, b) => {
    if (key) { const x = a[key] ?? -1e15, y = b[key] ?? -1e15; return dir * (x > y ? 1 : x < y ? -1 : 0); }
    return a.empresa.localeCompare(b.empresa) || orden[a.estado] - orden[b.estado] || (a.dias ?? -1e9) - (b.dias ?? -1e9);
  });
  const paginas = Math.max(1, Math.ceil(vista.length / PAGINA)); st.pagina = Math.min(st.pagina, paginas - 1);
  const ini = st.pagina * PAGINA;
  $("titulo-detalle").textContent = `Detalle de documentos`;
  $("tabla-info").textContent = `${vista.length} registro(s) con los filtros actuales`;
  $("tabla").tHead.innerHTML = `<tr>${COLUMNAS.map(([k, l]) => `<th data-k="${k}"${st.orden.key === k ? ` aria-sort="${dir > 0 ? "ascending" : "descending"}"` : ""}>${l}</th>`).join("")}</tr>`;
  $("tabla").tHead.querySelectorAll("th").forEach((th) => th.onclick = () => {
    st.orden = { key: th.dataset.k, dir: st.orden.key === th.dataset.k ? -st.orden.dir : 1 }; renderPanel();
  });
  $("tabla").tBodies[0].innerHTML = vista.slice(ini, ini + PAGINA).map((r) => `<tr><td>${esc(r.empresa)}</td><td>${esc(r.categoria)}</td><td><b>${esc(r.entidad)}</b></td>
    <td>${esc(r.id)}</td><td>${esc(r.documento)}</td><td>${fmtFecha(r.vencimiento) || "—"}</td><td class="num">${r.dias ?? "—"}</td>
    <td><span class="badge" style="color:${COLORES[r.estado][0]};background:${COLORES[r.estado][1]}">${esc(r.estado)}</span></td><td>${esc(r.detalle)}</td></tr>`).join("")
    || `<tr><td colspan="9" class="muted" style="text-align:center;padding:32px">Sin resultados para los filtros actuales.</td></tr>`;
  $("pag-info").textContent = vista.length ? `${ini + 1}–${Math.min(ini + PAGINA, vista.length)} de ${vista.length}` : "";
  $("pag-prev").disabled = st.pagina === 0; $("pag-next").disabled = st.pagina >= paginas - 1;
  $("pdf-filtrado").disabled = !vista.length;
}

