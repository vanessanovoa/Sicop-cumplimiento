// Estado compartido de la aplicación y cálculos derivados (registros evaluados, filtros).
import { ESTADOS, hoyUTC, UMBRAL_DEFECTO } from "./rules.js";
import { construirRegistros } from "./loader.js";
import { entidadesAFilas, TIPOS } from "./modelo.js";

export const CATEGORIAS = ["Empleados", "Proveedores", "Vehículos"];
export const st = {
  backend: null, perfil: null, vista: "panel",
  datos: { orgs: [], entidades: [], tipos: [], settings: { umbral_por_vencer: UMBRAL_DEFECTO, usar_fecha_hoy: true, fecha_corte: null }, importaciones: [], perfiles: [] },
  f: { empresas: new Set(), estados: new Set(["Vencido", "Por vencer", "Pendiente de aprobación"]), categorias: new Set(CATEGORIAS), texto: "" },
  orden: { key: null, dir: 1 }, pagina: 0, version: 0,
};

export const orgPorId = (id) => st.datos.orgs.find((o) => o.id === id);
export const orgNombre = (id) => orgPorId(id)?.nombre ?? "—";
export const orgsActivas = () => st.datos.orgs.filter((o) => o.activa);
export const umbral = () => st.datos.settings.umbral_por_vencer || UMBRAL_DEFECTO;
export const corte = () => {
  const s = st.datos.settings;
  return !s.usar_fecha_hoy && s.fecha_corte ? new Date(`${s.fecha_corte}T00:00:00Z`) : hoyUTC();
};

/** Reemplaza los datos cargados y reinicia los filtros de organización con las organizaciones activas. */
export function aplicarDatos(d) {
  st.datos = d; st.version++;
  const nombres = new Set(orgsActivas().map((o) => o.nombre));
  st.f.empresas = new Set([...st.f.empresas].filter((e) => nombres.has(e)));
  for (const n of nombres) if (!st.f.empresas.size || !seIniciaron.has(n)) st.f.empresas.add(n), seIniciaron.add(n);
}
const seIniciaron = new Set();

let cache = { version: -1, clave: "", regs: [] };
/** Registros evaluados de todas las entidades activas de organizaciones activas. */
export function registros() {
  const clave = `${st.version}|${corte().getTime()}|${umbral()}`;
  if (cache.version === st.version && cache.clave === clave) return cache.regs;
  const activas = new Set(orgsActivas().map((o) => o.id));
  const filas = entidadesAFilas(st.datos.entidades.filter((e) => activas.has(e.org_id)), orgNombre);
  cache = { version: st.version, clave, regs: construirRegistros(filas, corte(), umbral()) };
  return cache.regs;
}
export function filtrar(reg, conEstado = true) {
  const t = st.f.texto.trim().toLowerCase();
  return reg.filter((r) => st.f.empresas.has(r.empresa) && st.f.categorias.has(r.categoria) && (!conEstado || st.f.estados.has(r.estado)) &&
    (!t || `${r.entidad} ${r.id} ${r.documento}`.toLowerCase().includes(t)));
}
export const criticos = (base) => base.filter((r) => r.estado === "Vencido")
  .sort((a, b) => (a.dias ?? 1e9) - (b.dias ?? 1e9) || a.entidad.localeCompare(b.entidad));
export const hayDatos = () => st.datos.entidades.some((e) => !e.archivada_en);
export { ESTADOS, TIPOS };
