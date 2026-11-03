// Pruebas de interfaz: vistas reales sobre jsdom con el backend en memoria (mismas reglas de permisos que el servidor).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const dom = new JSDOM(fs.readFileSync(new URL("../docs/index.html", import.meta.url), "utf8").replace(/<script[\s\S]*?<\/script>/g, ""), { url: "http://localhost/", pretendToBeVisual: true });
const w = dom.window;
w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
w.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
w.HTMLElement.prototype.focus = function () {};
Object.assign(globalThis, { window: w, document: w.document, localStorage: w.localStorage, Event: w.Event });

const { st, aplicarDatos } = await import("../docs/js/estado.js");
const { crearBackendMemoria } = await import("../docs/js/backend/memoria.js");
const { renderEntidades, abrirFicha } = await import("../docs/js/views/entidades.js");
const { renderOrganizaciones, renderUsuarios, renderAjustes } = await import("../docs/js/views/admin.js");
const { cerrarDrawer } = await import("../docs/js/ui/drawer.js");

const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const q = (s, r = document) => r.querySelector(s);
const espera = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const submit = (form) => form.dispatchEvent(new w.Event("submit", { cancelable: true, bubbles: true }));
const poner = (el, v) => { el.value = v; el.dispatchEvent(new w.Event("input", { bubbles: true })); };
const toasts = () => $$("#toasts .toast").map((t) => t.textContent);
const iso = (d) => d.toISOString();

function entidad(id, extra = {}) {
  return { id, org_id: "o1", tipo: "empleado", etiqueta: `Persona ${id}`, identificador: "20111111112", subgrupo: "S", datos: {}, archivada_en: null,
    actualizada_en: iso(new Date(2026, 9, 1)), documentos: [{ id: "d" + id, entidad_id: id, nombre: "DNI", requerido: true, vencimiento: "2020-01-01", presentado: false, no_aplica: false, obs: "" }], ...extra };
}
async function montar(rol, ents = [entidad("e1")]) {
  document.body.querySelectorAll("dialog,.drawer-root").forEach((n) => n.remove());
  $$("#toasts .toast").forEach((n) => n.remove());
  const be = crearBackendMemoria({ perfil: { user_id: "me", email: "x@x.com", nombre: "X", rol, activo: true, debe_cambiar_clave: false },
    orgs: [{ id: "o1", nombre: "CMAS", activa: true }], entidades: ents.map((e) => structuredClone(e)) });
  st.backend = be; st.perfil = be.perfil; st.vista = "x";
  st.recargar = async () => { aplicarDatos(await be.cargar()); };
  await st.recargar();
  const cont = document.createElement("div"); document.body.append(cont);
  return { be, cont, ent: (id = "e1") => be._bd.entidades.find((e) => e.id === id) };
}
const guardarFicha = async () => { submit(q("#ficha")); await espera(20); };
const okModal = async () => { submit(q("dialog form")); await espera(20); };

test("lista: revisor solo ve; trabajador agrega; admin además ve archivados", async () => {
  for (const [rol, agregar, archivados] of [["revisor", false, false], ["trabajador", true, false], ["admin", true, true]]) {
    const { cont } = await montar(rol);
    renderEntidades(cont, "empleado");
    assert.equal(!!q("#e-nuevo", cont), agregar, `${rol} agregar`);
    assert.equal(!!q("#e-arch", cont), archivados, `${rol} archivados`);
    assert.equal($$("tbody tr", cont).length, 1);
    assert.match(cont.textContent, /Vencido/);
    cont.remove();
  }
});

test("ficha: el revisor no puede editar ni guardar", async () => {
  await montar("revisor"); abrirFicha("empleado", st.datos.entidades[0]);
  assert.equal(q("#f-guardar"), null);
  assert.ok($$("#ficha input[type=text], #ficha input[type=date]").every((i) => i.disabled));
  assert.equal(q("#f-archivar"), null);
  cerrarDrawer();
});

test("ficha: trabajador edita la fecha, el estado se recalcula y se guarda", async () => {
  const { ent } = await montar("trabajador"); abrirFicha("empleado", st.datos.entidades[0]);
  assert.equal(q("#f-archivar"), null, "trabajador no archiva");
  assert.match(q(".est").textContent, /Vencido/);
  poner(q("[name=vencimiento]"), "2099-01-01");
  assert.match(q(".est").textContent, /Al día/, "recalcula en vivo");
  await guardarFicha();
  assert.equal(q(".drawer"), null, "se cerró");
  assert.equal(ent().documentos[0].vencimiento, "2099-01-01");
  assert.ok(toasts().some((t) => /guardados/.test(t)));
});

test("ficha: marcar 'pendiente' cambia el estado a Pendiente de aprobación", async () => {
  const { ent } = await montar("admin"); abrirFicha("empleado", st.datos.entidades[0]);
  const c = q("[name=presentado]"); c.checked = true; c.dispatchEvent(new w.Event("change", { bubbles: true }));
  assert.match(q(".est").textContent, /Pendiente de aprobación/);
  await guardarFicha();
  assert.equal(ent().documentos[0].presentado, true);
});

test("ficha: CUIL inválido se rechaza y no guarda", async () => {
  const { ent } = await montar("admin"); abrirFicha("empleado", st.datos.entidades[0]);
  poner(q("[name=identificador]"), "20111111113");
  await guardarFicha();
  assert.match(q("#ficha-err").textContent, /CUIL/);
  assert.equal(ent().identificador, "20111111112");
  assert.ok(q(".drawer"));
  cerrarDrawer();
});

test("alta: nuevo empleado válido; duplicado y documento repetido se rechazan", async () => {
  const { be } = await montar("trabajador");
  abrirFicha("empleado", null);
  poner(q("[name=etiqueta]"), "Nueva Persona"); poner(q("[name=identificador]"), "20111111113");
  await guardarFicha();
  assert.match(q("#ficha-err").textContent, /CUIL/, "CUIL con dígito inválido");
  poner(q("[name=identificador]"), "20111111112"); await guardarFicha();      // ya existe en la organización
  assert.ok(toasts().some((t) => /Ya existe/.test(t)), "duplicado");
  assert.equal(be._bd.entidades.length, 1);
  poner(q("#nuevo-doc"), "dni"); q("#btn-doc").click();
  assert.match(q("#ficha-err").textContent, /ya está/);
  poner(q("[name=identificador]"), "27333333339");
  poner(q("#nuevo-doc"), "Curso especial"); q("#btn-doc").click();
  await guardarFicha();
  const n = be._bd.entidades.find((e) => e.identificador === "27333333339");
  assert.ok(n, "creada"); assert.deepEqual(n.documentos.map((d) => d.nombre).sort(), ["Curso especial", "Apto médico", "Capacitación", "DNI", "Entrega EPP", "Licencia de conducir"].sort());
  assert.equal(n.org_id, "o1");
});

test("admin: archiva, ve archivados, restaura y elimina definitivamente", async () => {
  const { be, cont, ent } = await montar("admin");
  abrirFicha("empleado", st.datos.entidades[0]);
  q("#f-archivar").click(); await espera(); await okModal();
  assert.ok(ent().archivada_en, "archivada");
  renderEntidades(cont, "empleado"); assert.equal($$("tbody tr[data-id]", cont).length, 0);
  q("#e-arch", cont).click(); assert.equal($$("tbody tr[data-id]", cont).length, 1);
  abrirFicha("empleado", st.datos.entidades[0]);
  assert.equal(q("#f-guardar"), null, "archivada: solo lectura");
  q("#f-restaurar").click(); await espera(20);
  assert.equal(ent().archivada_en, null, "restaurada");
  await be.archivar("e1", true);
  await st.recargar(); abrirFicha("empleado", st.datos.entidades[0]);
  q("#f-eliminar").click(); await espera(); await okModal();
  assert.equal(be._bd.entidades.length, 0, "eliminada");
});

test("el servidor (memoria) también rechaza acciones sin permiso aunque la UI las intente", async () => {
  const { be } = await montar("trabajador");
  await assert.rejects(be.archivar("e1", true), /permiso/);
  await assert.rejects(be.eliminar("e1"), /permiso|archivadas/);
  await assert.rejects(be.importar("o1", [], "x", null), /permiso/);
  await assert.rejects(be.crearOrg("Z"), /permiso/);
  await assert.rejects(be.usuarios.listar(), /permiso/);
  const r = await montar("revisor");
  await assert.rejects(r.be.guardarEntidad({ id: "e1", org_id: "o1", ent: { tipo: "empleado", etiqueta: "x", identificador: "1", documentos: [] } }), /permiso/);
});

test("conflicto: si otra persona guardó antes, se avisa y se recarga", async () => {
  const { be, ent } = await montar("trabajador"); abrirFicha("empleado", st.datos.entidades[0]);
  poner(q("[name=vencimiento]"), "2088-08-08");
  ent().actualizada_en = iso(new Date());                 // alguien más modificó mientras tanto
  await guardarFicha();
  assert.ok(toasts().some((t) => /Otra persona/.test(t)));
  assert.equal(be._bd.entidades[0].documentos[0].vencimiento, "2020-01-01", "no se pisó");
  assert.equal(q(".drawer"), null);
});

test("organizaciones: crear y desactivar; la lista respeta el estado", async () => {
  const { be, cont } = await montar("admin");
  renderOrganizaciones(cont);
  q("#o-nueva", cont).click(); await espera();
  poner(q("dialog [name=nombre]"), "Nueva SA"); await okModal(); await espera(20);
  assert.ok(be._bd.orgs.some((o) => o.nombre === "Nueva SA"));
  q("#o-nueva", cont).click(); await espera();
  poner(q("dialog [name=nombre]"), "cmas"); await okModal();
  assert.match(q("dialog [data-err]").textContent, /Ya existe/, "nombre duplicado");
  document.querySelectorAll("dialog").forEach((d) => d.remove());
});

test("usuarios: el administrador crea una cuenta con validaciones", async () => {
  const { be, cont } = await montar("admin");
  await renderUsuarios(cont);
  q("#u-nuevo", cont).click(); await espera();
  poner(q("dialog [name=email]"), "malo"); await okModal();
  assert.match(q("dialog [data-err]").textContent, /correo/);
  poner(q("dialog [name=email]"), "ana@empresa.com"); poner(q("dialog [name=password]"), "corta"); await okModal();
  assert.match(q("dialog [data-err]").textContent, /10 caracteres/);
  poner(q("dialog [name=password]"), "una-clave-larga-1"); poner(q("dialog [name=rol]"), "trabajador"); await okModal(); await espera(20);
  const u = be._bd.usuarios.find((x) => x.email === "ana@empresa.com");
  assert.ok(u); assert.equal(u.rol, "trabajador"); assert.equal(u.debe_cambiar_clave, true);
});

test("parámetros: valida el umbral y guarda", async () => {
  const { be, cont } = await montar("admin"); renderAjustes(cont);
  poner(q("#a-umbral", cont), "500"); q("#a-guardar", cont).click(); await espera(20);
  assert.ok(toasts().some((t) => /entre 1 y 90/.test(t)));
  poner(q("#a-umbral", cont), "30"); q("#a-guardar", cont).click(); await espera(20);
  assert.equal(be._bd.settings.umbral_por_vencer, 30);
});
