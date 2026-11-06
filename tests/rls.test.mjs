// Pruebas de las migraciones SQL (esquema, RLS, funciones) sobre PGlite, con roles simulados.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const sql = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const U = { admin: "00000000-0000-0000-0000-000000000001", trab: "00000000-0000-0000-0000-000000000002",
  rev: "00000000-0000-0000-0000-000000000003", off: "00000000-0000-0000-0000-000000000004" };

async function nuevaBd() {
  const db = new PGlite();
  await db.exec(sql("./sql/stub.sql"));
  for (const f of ["001_schema", "002_rls", "003_funciones", "004_docs_monotributo"]) await db.exec(sql(`../supabase/migrations/${f}.sql`));
  await db.exec(`grant select, insert, update, delete on all tables in schema public to authenticated;
    grant usage on all sequences in schema public to authenticated;`);
  for (const [k, id] of Object.entries(U)) await db.exec(`insert into auth.users (id,email) values ('${id}','${k}@x.com')`);
  await db.exec(`select public.bootstrap_admin('admin@x.com')`);
  await db.exec(`insert into public.perfiles (user_id,email,nombre,rol,activo) values
    ('${U.trab}','trab@x.com','T','trabajador',true), ('${U.rev}','rev@x.com','R','revisor',true),
    ('${U.off}','off@x.com','O','trabajador',false)`);
  await db.exec(`insert into public.organizaciones (id,nombre) values ('11111111-1111-1111-1111-111111111111','Empresa1')`);
  return db;
}
const ORG = "11111111-1111-1111-1111-111111111111";
// Ejecuta como un usuario (rol authenticated + claim sub) o anónimo.
async function como(db, quien, fn) {
  await db.exec(quien ? `set role authenticated; set request.jwt.claim.sub = '${U[quien]}'` : `set role anon; set request.jwt.claim.sub = ''`);
  try { return await fn(); } finally { await db.exec(`reset role; reset request.jwt.claim.sub`); }
}
const falla = async (p, re) => assert.rejects(p, re);
const ent = (id, docs = [{ nombre: "DNI", requerido: true, vencimiento: "2030-01-01" }]) =>
  ({ tipo: "empleado", etiqueta: `Persona ${id}`, identificador: id, subgrupo: "S", datos: { puesto: "x" }, documentos: docs });
const imp = (db, quien, ents, tipos = null) => como(db, quien, () =>
  db.query(`select public.importar_organizacion($1,$2::jsonb,'t.xlsx',$3::text[]) r`, [ORG, JSON.stringify(ents), tipos]).then((r) => r.rows[0].r));

test("lectura: activos sí; desactivado y anónimo no ven nada", async () => {
  const db = await nuevaBd();
  await imp(db, "admin", [ent("20111111112")]);
  for (const q of ["admin", "trab", "rev"]) assert.equal((await como(db, q, () => db.query("select * from entidades"))).rows.length, 1, q);
  assert.equal((await como(db, "off", () => db.query("select * from entidades"))).rows.length, 0);
  await falla(como(db, null, () => db.query("select * from entidades")), /permission denied/);
});

test("escritura directa por rol", async () => {
  const db = await nuevaBd();
  const ins = (q) => como(db, q, () => db.query(
    `insert into entidades (org_id,tipo,etiqueta,identificador) values ('${ORG}','empleado','X','${q}') returning id`));
  await ins("admin"); await ins("trab");
  await falla(ins("rev"), /row-level security/);
  await falla(ins("off"), /row-level security/);
  await falla(como(db, "trab", () => db.query(`insert into organizaciones (nombre) values ('Z')`)), /row-level security/);
  await falla(como(db, "rev", () => db.query(`update app_settings set umbral_por_vencer=5`)).then(async () => {
    const r = await db.query("select umbral_por_vencer u from app_settings"); assert.equal(r.rows[0].u, 15); throw new Error("row-level security");
  }), /row-level security/);
  await como(db, "admin", () => db.query(`insert into organizaciones (nombre) values ('Z')`));
});

test("perfiles: nadie escala su rol desde el cliente", async () => {
  const db = await nuevaBd();
  const r = await como(db, "trab", () => db.query(`update perfiles set rol='admin' where user_id='${U.trab}' returning 1`).catch((e) => e));
  assert.ok(r instanceof Error || r.rows.length === 0);
  assert.equal((await db.query(`select rol from perfiles where user_id='${U.trab}'`)).rows[0].rol, "trabajador");
});

test("archivar: trabajador no; admin sí; borrado solo de archivadas y solo admin", async () => {
  const db = await nuevaBd();
  await imp(db, "admin", [ent("20111111112")]);
  const id = (await db.query("select id from entidades")).rows[0].id;
  await falla(como(db, "trab", () => db.query(`update entidades set archivada_en=now() where id='${id}'`)), /administrador/);
  await falla(como(db, "trab", () => db.query(`select archivar_entidad('${id}', true)`)), /administrador/);
  await como(db, "trab", () => db.query(`update entidades set subgrupo='Nuevo' where id='${id}'`));
  await como(db, "admin", () => db.query(`select archivar_entidad('${id}', true)`));
  assert.equal((await como(db, "trab", () => db.query(`delete from entidades where id='${id}' returning 1`))).rows.length, 0);
  assert.equal((await como(db, "admin", () => db.query(`delete from entidades where id='${id}' returning 1`))).rows.length, 1);
  const id2 = (await imp(db, "admin", [ent("20222222223")]), (await db.query("select id from entidades")).rows[0].id);
  assert.equal((await como(db, "admin", () => db.query(`delete from entidades where id='${id2}' returning 1`))).rows.length, 0, "activa no se borra");
});

test("importar: solo admin; crea, actualiza, archiva ausentes, restaura reaparecidos", async () => {
  const db = await nuevaBd();
  await falla(imp(db, "trab", [ent("20111111112")]), /administrador/);
  await falla(imp(db, "rev", [ent("20111111112")]), /administrador/);
  let r = await imp(db, "admin", [ent("20111111112"), ent("20222222223")]);
  assert.deepEqual([r.nuevas, r.actualizadas, r.archivadas], [2, 0, 0]);
  // lunes siguiente: cambia una fecha, falta una persona, aparece otra
  r = await imp(db, "admin", [ent("20111111112", [{ nombre: "DNI", requerido: true, vencimiento: "2031-05-05", presentado: true }]), ent("20333333334")]);
  assert.deepEqual([r.nuevas, r.actualizadas, r.archivadas], [1, 1, 1]);
  const d = (await db.query(`select vencimiento::text v, presentado p from documentos d join entidades e on e.id=d.entidad_id where e.identificador='20111111112'`)).rows[0];
  assert.deepEqual(d, { v: "2031-05-05", p: true });
  assert.equal((await db.query(`select count(*)::int n from entidades where archivada_en is not null`)).rows[0].n, 1);
  // reaparece la archivada
  r = await imp(db, "admin", [ent("20222222223")]);
  assert.equal(r.restauradas, 1);
  assert.equal((await db.query(`select count(*)::int n from entidades where archivada_en is null`)).rows[0].n, 1);
  assert.equal((await db.query(`select count(*)::int n from importaciones`)).rows[0].n, 3);
});

test("importar: una entidad creada a mano que el Excel no trae se archiva; documentos ausentes se borran", async () => {
  const db = await nuevaBd();
  await imp(db, "admin", [ent("20111111112", [{ nombre: "DNI", vencimiento: "2030-01-01" }, { nombre: "Apto médico", vencimiento: "2030-01-01" }])]);
  await como(db, "trab", () => db.query(`select guardar_entidad(null,$1,null,$2::jsonb)`, [ORG, JSON.stringify(ent("MANUAL1"))]));
  await imp(db, "admin", [ent("20111111112", [{ nombre: "DNI", vencimiento: "2030-01-01" }])]);
  assert.equal((await db.query(`select archivada_en is not null a from entidades where identificador='MANUAL1'`)).rows[0].a, true);
  assert.equal((await db.query(`select count(*)::int n from documentos d join entidades e on e.id=d.entidad_id where e.identificador='20111111112'`)).rows[0].n, 1);
});

test("importar es atómica: un error a mitad no deja nada", async () => {
  const db = await nuevaBd();
  await imp(db, "admin", [ent("20111111112")]);
  const malo = [ent("20999999999"), { tipo: "robot", etiqueta: "x", identificador: "y", documentos: [] }];
  await falla(imp(db, "admin", malo), /check constraint/);
  assert.equal((await db.query(`select count(*)::int n from entidades`)).rows[0].n, 1);
  assert.equal((await db.query(`select count(*)::int n from importaciones`)).rows[0].n, 1);
});

test("guardar_entidad: control optimista y permisos", async () => {
  const db = await nuevaBd();
  await imp(db, "admin", [ent("20111111112")]);
  const { id, actualizada_en } = (await db.query(`select id, actualizada_en from entidades`)).rows[0];
  const guardar = (q, esp, ed) => como(db, q, () => db.query(`select guardar_entidad($1,$2,$3,$4::jsonb)`, [id, ORG, esp, JSON.stringify(ed)]));
  await falla(guardar("rev", actualizada_en, ent("20111111112")), /permiso/);
  await guardar("trab", actualizada_en, ent("20111111112", [{ nombre: "DNI", vencimiento: "2040-02-02", presentado: true, obs: "ok" }]));
  await falla(guardar("admin", actualizada_en, ent("20111111112")), /CONFLICTO/); // sello viejo
  const d = (await db.query(`select vencimiento::text v, obs from documentos`)).rows[0];
  assert.deepEqual(d, { v: "2040-02-02", obs: "ok" });
});

test("duplicado de clave natural entre activas se rechaza", async () => {
  const db = await nuevaBd();
  await imp(db, "admin", [ent("20111111112")]);
  await falla(como(db, "trab", () => db.query(`select guardar_entidad(null,$1,null,$2::jsonb)`, [ORG, JSON.stringify(ent("20111111112"))])), /duplicate key/);
});

test("bootstrap_admin: una sola vez y no ejecutable por usuarios", async () => {
  const db = await nuevaBd();
  await falla(db.query(`select bootstrap_admin('trab@x.com')`), /Ya existe/);
  await falla(como(db, "trab", () => db.query(`select bootstrap_admin('trab@x.com')`)), /permission denied/);
});

test("importar con p_tipos solo archiva ese tipo (hoja ausente no borra el resto)", async () => {
  const db = await nuevaBd();
  const veh = { tipo: "vehiculo", etiqueta: "Fiat", identificador: "AB123CD", subgrupo: "", datos: {}, documentos: [] };
  await imp(db, "admin", [ent("20111111112"), veh]);
  const r = await imp(db, "admin", [ent("20111111112")], ["empleado"]);
  assert.equal(r.archivadas, 0);
  assert.equal((await db.query(`select count(*)::int n from entidades where archivada_en is null`)).rows[0].n, 2);
});
