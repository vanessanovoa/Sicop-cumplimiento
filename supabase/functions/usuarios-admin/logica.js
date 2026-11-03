// Lógica pura de administración de usuarios (sin dependencias de Deno ni de Supabase: se inyecta `db`).
export const ROLES = ["admin", "trabajador", "revisor"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class ErrorUsuario extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}

/** @param {object} body {accion, ...}  @param {string} llamanteId  @param {object} db operaciones de persistencia */
export async function manejar(body, llamanteId, db) {
  const yo = llamanteId ? await db.perfilDe(llamanteId) : null;
  if (!yo || !yo.activo || yo.rol !== "admin") throw new ErrorUsuario("Solo un administrador puede gestionar usuarios", 403);

  const exigirOtroAdmin = async (id) => {
    const objetivo = await db.perfilDe(id);
    if (!objetivo) throw new ErrorUsuario("Usuario inexistente", 404);
    if (objetivo.rol === "admin" && objetivo.activo && (await db.contarAdminsActivos()) <= 1)
      throw new ErrorUsuario("No se puede dejar el sistema sin administradores activos", 409);
    return objetivo;
  };
  const clave = (c) => {
    if (typeof c !== "string" || c.length < 10) throw new ErrorUsuario("La contraseña debe tener al menos 10 caracteres");
    return c;
  };

  switch (body.accion) {
    case "listar":
      return { usuarios: await db.listarPerfiles() };

    case "crear": {
      const email = String(body.email || "").trim().toLowerCase();
      if (!EMAIL_RE.test(email)) throw new ErrorUsuario("Correo inválido");
      if (!ROLES.includes(body.rol)) throw new ErrorUsuario("Rol inválido");
      const password = clave(body.password);
      const nombre = String(body.nombre || "").trim().slice(0, 120);
      const { id } = await db.crearUsuarioAuth(email, password);
      try {
        await db.insertarPerfil({ user_id: id, email, nombre, rol: body.rol, activo: true, debe_cambiar_clave: true });
      } catch (e) { await db.borrarUsuarioAuth(id); throw e; } // sin perfil huérfano
      return { id };
    }

    case "cambiar_rol": {
      if (!ROLES.includes(body.rol)) throw new ErrorUsuario("Rol inválido");
      const o = await db.perfilDe(body.id);
      if (!o) throw new ErrorUsuario("Usuario inexistente", 404);
      if (o.rol === "admin" && body.rol !== "admin") await exigirOtroAdmin(body.id);
      await db.actualizarPerfil(body.id, { rol: body.rol });
      return { ok: true };
    }

    case "activar":
    case "desactivar": {
      const activar = body.accion === "activar";
      if (!activar) await exigirOtroAdmin(body.id);
      else if (!(await db.perfilDe(body.id))) throw new ErrorUsuario("Usuario inexistente", 404);
      await db.actualizarPerfil(body.id, { activo: activar });
      await db.setBan(body.id, !activar);
      return { ok: true };
    }

    case "resetear_clave": {
      if (!(await db.perfilDe(body.id))) throw new ErrorUsuario("Usuario inexistente", 404);
      await db.cambiarClave(body.id, clave(body.password));
      await db.actualizarPerfil(body.id, { debe_cambiar_clave: true });
      return { ok: true };
    }

    default:
      throw new ErrorUsuario("Acción desconocida");
  }
}
