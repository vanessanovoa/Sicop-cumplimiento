import test from "node:test";
import assert from "node:assert/strict";
import { manejar, ErrorUsuario } from "../supabase/functions/usuarios-admin/logica.js";

function bd(perfiles) {
  const P = new Map(perfiles.map((p) => [p.user_id, { ...p }]));
  const reg = { baneos: [], claves: [], borrados: [], creados: [] };
  return { P, reg, db: {
    perfilDe: async (id) => P.get(id) ?? null,
    listarPerfiles: async () => [...P.values()],
    contarAdminsActivos: async () => [...P.values()].filter((p) => p.rol === "admin" && p.activo).length,
    crearUsuarioAuth: async (email) => { if (email === "dup@x.com") throw new ErrorUsuario("ya existe"); reg.creados.push(email); return { id: "n-" + email }; },
    insertarPerfil: async (p) => { if (p.nombre === "FALLA") throw new Error("boom"); P.set(p.user_id, p); },
    actualizarPerfil: async (id, c) => Object.assign(P.get(id), c),
    setBan: async (id, b) => reg.baneos.push([id, b]),
    cambiarClave: async (id, c) => reg.claves.push([id, c]),
    borrarUsuarioAuth: async (id) => reg.borrados.push(id),
  } };
}
const base = () => bd([
  { user_id: "a", email: "a@x", rol: "admin", activo: true },
  { user_id: "t", email: "t@x", rol: "trabajador", activo: true },
  { user_id: "r", email: "r@x", rol: "revisor", activo: false },
]);
const rechaza = (p, status) => assert.rejects(p, (e) => e instanceof ErrorUsuario && (!status || e.status === status));

test("rechaza a quien no es admin activo (o no hay sesión)", async () => {
  const { db } = base();
  await rechaza(manejar({ accion: "listar" }, "t", db), 403);
  await rechaza(manejar({ accion: "listar" }, "r", db), 403);
  await rechaza(manejar({ accion: "listar" }, null, db), 403);
  await rechaza(manejar({ accion: "listar" }, "zzz", db), 403);
  assert.equal((await manejar({ accion: "listar" }, "a", db)).usuarios.length, 3);
});

test("crear: valida y deja debe_cambiar_clave", async () => {
  const { db, P } = base();
  await rechaza(manejar({ accion: "crear", email: "malo", rol: "revisor", password: "x".repeat(10) }, "a", db));
  await rechaza(manejar({ accion: "crear", email: "n@x.com", rol: "dios", password: "x".repeat(10) }, "a", db));
  await rechaza(manejar({ accion: "crear", email: "n@x.com", rol: "revisor", password: "corta" }, "a", db));
  const { id } = await manejar({ accion: "crear", email: " N@X.com ", rol: "revisor", password: "x".repeat(10), nombre: "Nora" }, "a", db);
  assert.deepEqual([P.get(id).email, P.get(id).rol, P.get(id).debe_cambiar_clave], ["n@x.com", "revisor", true]);
});

test("crear: si falla el perfil se borra el usuario de Auth", async () => {
  const { db, reg } = base();
  await assert.rejects(manejar({ accion: "crear", email: "z@x.com", rol: "revisor", password: "x".repeat(10), nombre: "FALLA" }, "a", db), /boom/);
  assert.deepEqual(reg.borrados, ["n-z@x.com"]);
});

test("no deja al sistema sin administradores", async () => {
  const { db } = base();
  await rechaza(manejar({ accion: "desactivar", id: "a" }, "a", db), 409);
  await rechaza(manejar({ accion: "cambiar_rol", id: "a", rol: "revisor" }, "a", db), 409);
  await manejar({ accion: "cambiar_rol", id: "t", rol: "admin" }, "a", db);
  await manejar({ accion: "cambiar_rol", id: "a", rol: "trabajador" }, "a", db); // ya hay otro admin
});

test("desactivar banea; activar desbanea; resetear exige cambio", async () => {
  const { db, reg, P } = base();
  await manejar({ accion: "desactivar", id: "t" }, "a", db);
  await manejar({ accion: "activar", id: "r" }, "a", db);
  assert.deepEqual(reg.baneos, [["t", true], ["r", false]]);
  P.get("t").debe_cambiar_clave = false;
  await rechaza(manejar({ accion: "resetear_clave", id: "t", password: "corta" }, "a", db));
  await manejar({ accion: "resetear_clave", id: "t", password: "nueva-clave-1" }, "a", db);
  assert.equal(P.get("t").debe_cambiar_clave, true);
  await rechaza(manejar({ accion: "desactivar", id: "nadie" }, "a", db), 404);
  await rechaza(manejar({ accion: "x" }, "a", db));
});
