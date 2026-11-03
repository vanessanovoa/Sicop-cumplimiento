// Backend real: Supabase (Auth + Postgres con RLS + Edge Function de usuarios).
import { SUPABASE_URL, SUPABASE_ANON_KEY, FUNCION_USUARIOS } from "../config.js";

export const configurado = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);
const PAGINA = 1000;

export class ErrorBackend extends Error {
  constructor(msg, codigo) { super(msg); this.codigo = codigo; }
}
/** Traduce errores de Postgres/Auth a mensajes para personas. */
function traducir(e) {
  const m = e?.message || String(e);
  if (/CONFLICTO/.test(m)) return new ErrorBackend("Otra persona modificó este registro mientras lo editabas. Se recargaron los datos; revisá y volvé a intentar.", "conflicto");
  if (/duplicate key|unique/i.test(m)) return new ErrorBackend("Ya existe un registro con ese identificador en la organización.", "duplicado");
  if (/row-level security|permission denied|42501|Solo un administrador|Sin permiso/i.test(m)) return new ErrorBackend("No tenés permiso para realizar esta acción.", "permiso");
  if (/Invalid login credentials/i.test(m)) return new ErrorBackend("Correo o contraseña incorrectos.", "credenciales");
  if (/Failed to fetch|NetworkError|network/i.test(m)) return new ErrorBackend("Sin conexión con el servidor. Reintentá en unos segundos.", "red");
  return new ErrorBackend(m);
}
const ok = (r) => { if (r.error) throw traducir(r.error); return r.data; };

export function crearBackend() {
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  let perfil = null;

  async function cargarPerfil() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return (perfil = null);
    const p = await sb.from("perfiles").select("*").eq("user_id", session.user.id).maybeSingle();
    if (p.error) throw traducir(p.error);
    if (!p.data || !p.data.activo) { await sb.auth.signOut(); throw new ErrorBackend("Tu cuenta no está habilitada. Consultá con un administrador.", "inactivo"); }
    return (perfil = p.data);
  }
  async function todo(consulta) {           // pagina para superar el límite de 1000 filas
    const filas = [];
    for (let i = 0; ; i += PAGINA) {
      const r = ok(await consulta().range(i, i + PAGINA - 1));
      filas.push(...r);
      if (r.length < PAGINA) return filas;
    }
  }
  const llamar = async (cuerpo) => {
    const r = await sb.functions.invoke(FUNCION_USUARIOS, { body: cuerpo });
    if (r.error) {
      let msg = r.error.message;
      try { const j = await r.error.context.json(); if (j?.error) msg = j.error; } catch { /* sin cuerpo */ }
      throw new ErrorBackend(msg);
    }
    return r.data;
  };

  return {
    modo: "supabase",
    get perfil() { return perfil; },
    init: cargarPerfil,
    async iniciarSesion(email, pass) {
      const r = await sb.auth.signInWithPassword({ email: email.trim(), password: pass });
      if (r.error) throw traducir(r.error);
      return cargarPerfil();
    },
    async cerrarSesion() { perfil = null; await sb.auth.signOut(); },
    async cambiarClave(nueva) {
      ok(await sb.auth.updateUser({ password: nueva }));
      ok(await sb.rpc("clave_cambiada"));
      perfil = { ...perfil, debe_cambiar_clave: false };
    },

    async cargar() {
      const [orgs, entidades, tipos, settings, importaciones, perfiles] = await Promise.all([
        todo(() => sb.from("organizaciones").select("*").order("nombre")),
        todo(() => sb.from("entidades").select("*, documentos(*)").order("etiqueta")),
        todo(() => sb.from("tipos_documento").select("*").order("orden")),
        sb.from("app_settings").select("*").eq("id", 1).single().then(ok),
        todo(() => sb.from("importaciones").select("*").order("fecha", { ascending: false })),
        todo(() => sb.from("perfiles").select("user_id,nombre,email")),
      ]);
      return { orgs, entidades, tipos, settings, importaciones, perfiles };
    },
    async guardarEntidad({ id, org_id, esperada, ent }) {
      return ok(await sb.rpc("guardar_entidad", { p_id: id ?? null, p_org: org_id, p_esperada: esperada ?? null, p_ent: ent }));
    },
    async archivar(id, archivar) { ok(await sb.rpc("archivar_entidad", { p_id: id, p_archivar: archivar })); },
    async eliminar(id) {
      const r = ok(await sb.from("entidades").delete().eq("id", id).select("id"));
      if (!r.length) throw new ErrorBackend("No se pudo eliminar (solo se eliminan entidades archivadas).", "permiso");
    },
    async importar(orgId, entidades, archivo, tipos) {
      return ok(await sb.rpc("importar_organizacion", { p_org: orgId, p_entidades: entidades, p_archivo: archivo, p_tipos: tipos }));
    },
    async crearOrg(nombre) { return ok(await sb.from("organizaciones").insert({ nombre }).select().single()); },
    async actualizarOrg(id, cambios) { ok(await sb.from("organizaciones").update(cambios).eq("id", id)); },
    async guardarSettings(s) { ok(await sb.from("app_settings").update(s).eq("id", 1)); },

    usuarios: {
      listar: async () => (await llamar({ accion: "listar" })).usuarios,
      crear: (u) => llamar({ accion: "crear", ...u }),
      cambiarRol: (id, rol) => llamar({ accion: "cambiar_rol", id, rol }),
      activar: (id) => llamar({ accion: "activar", id }),
      desactivar: (id) => llamar({ accion: "desactivar", id }),
      resetearClave: (id, password) => llamar({ accion: "resetear_clave", id, password }),
    },
  };
}
