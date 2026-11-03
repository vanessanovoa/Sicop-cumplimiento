// Backend en memoria con las mismas reglas de permisos que el servidor. Sirve para ?dev (solo localhost) y pruebas.
import { puede } from "../permisos.js";
import { ErrorBackend } from "./supabase.js";

const uuid = () => crypto.randomUUID();
const ahora = () => new Date().toISOString();
const denegar = () => { throw new ErrorBackend("No tenés permiso para realizar esta acción.", "permiso"); };

/** @param {object} sem {perfil, orgs, entidades, usuarios} datos iniciales opcionales */
export function crearBackendMemoria(sem = {}) {
  const perfil = sem.perfil || { user_id: "u-admin", email: "admin@demo.test", nombre: "Admin Demo", rol: "admin", activo: true, debe_cambiar_clave: false };
  const bd = {
    orgs: sem.orgs || [], entidades: sem.entidades || [], importaciones: sem.importaciones || [],
    settings: sem.settings || { id: 1, umbral_por_vencer: 15, usar_fecha_hoy: true, fecha_corte: null },
    tipos: [["Empleados", "Apto médico"], ["Empleados", "DNI"], ["Empleados", "Licencia de conducir"], ["Empleados", "Capacitación"], ["Empleados", "Entrega EPP"],
      ["Vehículos", "VTV"], ["Vehículos", "Póliza"], ["Vehículos", "Cuota"]].map(([categoria, nombre], i) => ({ id: i + 1, categoria, nombre, requerido: true, orden: i })),
    usuarios: sem.usuarios || [perfil],
  };
  const rol = () => perfil.rol;
  const entidad = (id) => bd.entidades.find((e) => e.id === id);
  const aDocs = (docs, eid) => docs.map((d) => ({ id: uuid(), entidad_id: eid, obs: "", presentado: false, no_aplica: false, vencimiento: null, requerido: true, ...d }));
  const clon = (x) => structuredClone(x);
  const unico = (org_id, tipo, ident, salvo) => {
    if (bd.entidades.some((e) => e.id !== salvo && !e.archivada_en && e.org_id === org_id && e.tipo === tipo && e.identificador === ident))
      throw new ErrorBackend("Ya existe un registro con ese identificador en la organización.", "duplicado");
  };

  return {
    modo: "memoria", get perfil() { return perfil; }, _bd: bd,
    async init() { return perfil; },
    async iniciarSesion() { return perfil; },
    async cerrarSesion() {},
    async cambiarClave() { perfil.debe_cambiar_clave = false; },
    async cargar() { return clon({ ...bd, perfiles: bd.usuarios, settings: bd.settings }); },

    async guardarEntidad({ id, org_id, esperada, ent }) {
      if (!puede(rol(), "editarEntidad")) denegar();
      let e = id ? entidad(id) : null;
      if (id && (!e || e.archivada_en)) throw new ErrorBackend("La entidad no existe o está archivada");
      if (e && esperada && e.actualizada_en !== esperada) throw new ErrorBackend("Otra persona modificó este registro mientras lo editabas. Se recargaron los datos; revisá y volvé a intentar.", "conflicto");
      unico(e ? e.org_id : org_id, e ? e.tipo : ent.tipo, ent.identificador, id);
      if (!e) { e = { id: uuid(), org_id, tipo: ent.tipo, archivada_en: null, creada_en: ahora() }; bd.entidades.push(e); }
      Object.assign(e, { etiqueta: ent.etiqueta, identificador: ent.identificador, subgrupo: ent.subgrupo || "", datos: ent.datos || {},
        documentos: aDocs(ent.documentos || [], e.id), actualizada_en: ahora(), actualizada_por: perfil.user_id });
      return e.id;
    },
    async archivar(id, archivar) {
      if (!puede(rol(), "archivarEntidad")) denegar();
      const e = entidad(id); e.archivada_en = archivar ? ahora() : null; e.archivada_por = archivar ? perfil.user_id : null; e.actualizada_en = ahora();
    },
    async eliminar(id) {
      if (!puede(rol(), "eliminarEntidad")) denegar();
      const e = entidad(id);
      if (!e?.archivada_en) throw new ErrorBackend("No se pudo eliminar (solo se eliminan entidades archivadas).", "permiso");
      bd.entidades = bd.entidades.filter((x) => x.id !== id);
    },
    async importar(orgId, entidades, archivo, tipos) {
      if (!puede(rol(), "importar")) denegar();
      const r = { nuevas: 0, actualizadas: 0, restauradas: 0, archivadas: 0, documentos: 0 }, vistas = new Set(), t = ahora();
      for (const n of entidades) {
        let e = bd.entidades.filter((x) => x.org_id === orgId && x.tipo === n.tipo && x.identificador === n.identificador)
          .sort((a, b) => (a.archivada_en ? 1 : 0) - (b.archivada_en ? 1 : 0))[0];
        if (!e) { e = { id: uuid(), org_id: orgId, tipo: n.tipo, identificador: n.identificador, archivada_en: null, creada_en: t }; bd.entidades.push(e); r.nuevas++; }
        else if (e.archivada_en) r.restauradas++; else r.actualizadas++;
        Object.assign(e, { etiqueta: n.etiqueta, subgrupo: n.subgrupo || "", datos: n.datos || {}, archivada_en: null, archivada_por: null,
          documentos: aDocs(n.documentos, e.id), actualizada_en: t, actualizada_por: perfil.user_id });
        r.documentos += n.documentos.length; vistas.add(e.id);
      }
      for (const e of bd.entidades)
        if (e.org_id === orgId && !e.archivada_en && !vistas.has(e.id) && (!tipos || tipos.includes(e.tipo))) { e.archivada_en = t; e.archivada_por = perfil.user_id; r.archivadas++; }
      bd.importaciones.unshift({ id: uuid(), org_id: orgId, archivo, por: perfil.user_id, fecha: t, resumen: r });
      return r;
    },
    async crearOrg(nombre) {
      if (!puede(rol(), "gestionarOrgs")) denegar();
      if (bd.orgs.some((o) => o.nombre.toLowerCase() === nombre.toLowerCase())) throw new ErrorBackend("Ya existe una organización con ese nombre.", "duplicado");
      const o = { id: uuid(), nombre, activa: true, creada_en: ahora() }; bd.orgs.push(o); return clon(o);
    },
    async actualizarOrg(id, c) { if (!puede(rol(), "gestionarOrgs")) denegar(); Object.assign(bd.orgs.find((o) => o.id === id), c); },
    async guardarSettings(s) { if (!puede(rol(), "gestionarAjustes")) denegar(); Object.assign(bd.settings, s); },

    usuarios: {
      async listar() { if (!puede(rol(), "gestionarUsuarios")) denegar(); return clon(bd.usuarios); },
      async crear(u) {
        if (!puede(rol(), "gestionarUsuarios")) denegar();
        const n = { user_id: uuid(), email: u.email.toLowerCase(), nombre: u.nombre || "", rol: u.rol, activo: true, debe_cambiar_clave: true, creado_en: ahora() };
        bd.usuarios.push(n); return { id: n.user_id };
      },
      async cambiarRol(id, r) { if (!puede(rol(), "gestionarUsuarios")) denegar(); bd.usuarios.find((u) => u.user_id === id).rol = r; },
      async activar(id) { if (!puede(rol(), "gestionarUsuarios")) denegar(); bd.usuarios.find((u) => u.user_id === id).activo = true; },
      async desactivar(id) { if (!puede(rol(), "gestionarUsuarios")) denegar(); bd.usuarios.find((u) => u.user_id === id).activo = false; },
      async resetearClave(id) { if (!puede(rol(), "gestionarUsuarios")) denegar(); bd.usuarios.find((u) => u.user_id === id).debe_cambiar_clave = true; },
    },
  };
}
