// Matriz de permisos por rol. El servidor (RLS) es la defensa real; esto solo ordena la interfaz.
export const ROLES = { admin: "Administrador", trabajador: "Trabajador", revisor: "Revisor" };
const MATRIZ = {
  ver:               ["admin", "trabajador", "revisor"],
  pdf:               ["admin", "trabajador", "revisor"],
  editarEntidad:     ["admin", "trabajador"],
  agregarEntidad:    ["admin", "trabajador"],
  archivarEntidad:   ["admin"],
  verArchivadas:     ["admin"],
  eliminarEntidad:   ["admin"],
  importar:          ["admin"],
  gestionarOrgs:     ["admin"],
  gestionarUsuarios: ["admin"],
  gestionarAjustes:  ["admin"],
};
export const puede = (rol, accion) => !!MATRIZ[accion]?.includes(rol);
export const ACCIONES = Object.keys(MATRIZ);
