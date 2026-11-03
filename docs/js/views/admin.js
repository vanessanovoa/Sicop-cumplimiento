// Vistas de administración: organizaciones, usuarios, parámetros y cuenta propia.
import { esc, ico, toast, conBoton, fmtFechaHora, fmtISO } from "../util.js";
import { st } from "../estado.js";
import { ROLES } from "../permisos.js";
import { EMAIL_RE, errorClave, generarClave } from "../validadores.js";
import { hoyUTC } from "../rules.js";
import { modal, confirmar, valor } from "../ui/modal.js";

// ---------- Organizaciones ----------
export function renderOrganizaciones(cont) {
  const cuenta = (id) => st.datos.entidades.filter((e) => e.org_id === id && !e.archivada_en).length;
  const ultima = (id) => st.datos.importaciones.find((i) => i.org_id === id)?.fecha;
  cont.innerHTML = `<div class="card"><div class="card-head"><div><h2>Organizaciones</h2><p class="muted">Las empresas cuyo cumplimiento se controla. Cada Excel se importa a una de ellas.</p></div>
    <button class="btn primary" id="o-nueva">${ico("plus")}Nueva organización</button></div>
    <div class="tabla-wrap"><table><thead><tr><th>Nombre</th><th>Entidades activas</th><th>Última importación</th><th>Estado</th><th></th></tr></thead><tbody>
    ${st.datos.orgs.map((o) => `<tr data-id="${o.id}"><td><b>${esc(o.nombre)}</b></td><td>${cuenta(o.id)}</td><td class="muted">${ultima(o.id) ? fmtFechaHora(ultima(o.id)) : "Nunca"}</td>
      <td><span class="badge" style="color:${o.activa ? "var(--dia)" : "var(--s500)"};background:${o.activa ? "var(--dia-bg)" : "var(--s100)"}">${o.activa ? "Activa" : "Inactiva"}</span></td>
      <td class="acc"><button class="btn sm" data-renombrar>${ico("pencil", "sm")}Renombrar</button> <button class="btn sm" data-toggle>${o.activa ? "Desactivar" : "Activar"}</button></td></tr>`).join("")
      || '<tr><td colspan="5" class="muted" style="text-align:center;padding:32px">Todavía no hay organizaciones. Creá la primera.</td></tr>'}</tbody></table></div>
    <p class="muted nota">Una organización inactiva deja de mostrarse en el panel, los reportes y las listas; sus datos se conservan.</p></div>`;
  const redo = () => renderOrganizaciones(cont);
  const pedirNombre = (titulo, actual, accion) => modal({ titulo, aceptar: "Guardar", html: `<label class="campo">Nombre<input type="text" name="nombre" value="${esc(actual)}" autofocus></label>`,
    validar: async (dlg) => { const n = valor(dlg, "nombre"); if (!n) throw new Error("Ingresá un nombre."); await accion(n); } });
  cont.querySelector("#o-nueva").onclick = async () => { if (await pedirNombre("Nueva organización", "", (n) => st.backend.crearOrg(n))) { await st.recargar(); toast("Organización creada"); } };
  cont.querySelectorAll("tr[data-id]").forEach((tr) => {
    const o = st.datos.orgs.find((x) => x.id === tr.dataset.id);
    tr.querySelector("[data-renombrar]").onclick = async () => { if (await pedirNombre("Renombrar organización", o.nombre, (n) => st.backend.actualizarOrg(o.id, { nombre: n }))) { await st.recargar(); toast("Guardado"); } };
    tr.querySelector("[data-toggle]").onclick = (e) => conBoton(e.currentTarget, async () => { await st.backend.actualizarOrg(o.id, { activa: !o.activa }); await st.recargar(); toast(o.activa ? "Organización desactivada" : "Organización activada"); });
  });
}

// ---------- Usuarios ----------
const selRol = (n, actual) => `<select name="${n}">${Object.entries(ROLES).map(([k, l]) => `<option value="${k}"${actual === k ? " selected" : ""}>${l}</option>`).join("")}</select>`;
const campoClave = (valorIni) => `<label class="campo">Contraseña inicial<div class="con-boton"><input type="text" name="password" value="${esc(valorIni)}" autocomplete="off" spellcheck="false"><button type="button" class="btn" data-gen>Generar</button></div>
  <small class="muted">Mínimo 10 caracteres. La persona deberá cambiarla al ingresar por primera vez.</small></label>`;
const montarGenerador = (dlg) => dlg.querySelector("[data-gen]").onclick = () => { dlg.querySelector("[name=password]").value = generarClave(); };

export async function renderUsuarios(cont) {
  cont.innerHTML = '<div class="card"><p class="muted">Cargando usuarios…</p></div>';
  let usuarios;
  try { usuarios = await st.backend.usuarios.listar(); }
  catch (e) { cont.innerHTML = `<div class="card"><div class="banner warn">${ico("circle-alert", "sm")}${esc(e.message)}<br><small>Verificá que la función <code>usuarios-admin</code> esté desplegada (README-SUPABASE.md).</small></div></div>`; return; }
  const yo = st.perfil.user_id;
  cont.innerHTML = `<div class="card"><div class="card-head"><div><h2>Usuarios</h2><p class="muted">Cada persona ingresa con su correo. Solo vos podés crear cuentas.</p></div>
    <button class="btn primary" id="u-nuevo">${ico("user-plus")}Nuevo usuario</button></div>
    <div class="tabla-wrap"><table><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Alta</th><th></th></tr></thead><tbody>
    ${usuarios.map((u) => `<tr data-id="${u.user_id}"><td><b>${esc(u.nombre || "—")}</b>${u.user_id === yo ? ' <span class="muted">(vos)</span>' : ""}</td><td>${esc(u.email)}</td>
      <td>${u.user_id === yo ? esc(ROLES[u.rol]) : selRol("rol", u.rol)}</td>
      <td><span class="badge" style="color:${u.activo ? "var(--dia)" : "var(--s500)"};background:${u.activo ? "var(--dia-bg)" : "var(--s100)"}">${u.activo ? "Activo" : "Desactivado"}</span>${u.debe_cambiar_clave ? ' <span class="muted" title="Todavía no cambió su contraseña inicial">· clave inicial</span>' : ""}</td>
      <td class="muted">${fmtFechaHora(u.creado_en)}</td>
      <td class="acc">${u.user_id === yo ? "" : `<button class="btn sm" data-reset>${ico("key-round", "sm")}Restablecer clave</button> <button class="btn sm${u.activo ? " danger" : ""}" data-toggle>${u.activo ? "Desactivar" : "Activar"}</button>`}</td></tr>`).join("")}</tbody></table></div>
    <div class="matriz"><h3>Qué puede hacer cada rol</h3><table><thead><tr><th></th><th>Administrador</th><th>Trabajador</th><th>Revisor</th></tr></thead><tbody>
      ${[["Ver el panel y descargar el PDF", 1, 1, 1], ["Editar y agregar entidades", 1, 1, 0], ["Archivar, restaurar y eliminar", 1, 0, 0], ["Importar Excel", 1, 0, 0], ["Organizaciones, parámetros y usuarios", 1, 0, 0]]
        .map(([t, ...v]) => `<tr><td>${t}</td>${v.map((x) => `<td class="c">${x ? ico("check", "sm ok") : '<span class="muted">—</span>'}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`;
  const redo = () => renderUsuarios(cont);
  cont.querySelector("#u-nuevo").onclick = async () => {
    const ok = await modal({ titulo: "Nuevo usuario", aceptar: "Crear usuario", onMount: montarGenerador,
      html: `<label class="campo">Nombre<input type="text" name="nombre" autofocus></label><label class="campo">Correo electrónico<input type="text" name="email" inputmode="email" autocomplete="off"></label>
        <label class="campo">Rol${selRol("rol", "revisor")}</label>${campoClave(generarClave())}`,
      validar: async (dlg) => {
        const email = valor(dlg, "email"), password = valor(dlg, "password");
        if (!EMAIL_RE.test(email)) throw new Error("El correo no es válido.");
        if (errorClave(password)) throw new Error(errorClave(password));
        await st.backend.usuarios.crear({ email, nombre: valor(dlg, "nombre"), rol: valor(dlg, "rol"), password });
        dlg.dataset.clave = password;
      } });
    if (ok) { toast("Usuario creado. Entregale la contraseña inicial por un canal seguro."); redo(); }
  };
  cont.querySelectorAll("tr[data-id]").forEach((tr) => {
    const id = tr.dataset.id, u = usuarios.find((x) => x.user_id === id);
    tr.querySelector("select")?.addEventListener("change", async (e) => {
      try { await st.backend.usuarios.cambiarRol(id, e.target.value); toast("Rol actualizado"); } catch (x) { toast(x.message, "error"); }
      redo();
    });
    tr.querySelector("[data-toggle]")?.addEventListener("click", async (e) => {
      if (u.activo && !(await confirmar("Desactivar usuario", `${esc(u.email)} no podrá ingresar hasta que lo actives de nuevo.`, "Desactivar", true))) return;
      await conBoton(e.currentTarget, async () => { await (u.activo ? st.backend.usuarios.desactivar(id) : st.backend.usuarios.activar(id)); toast(u.activo ? "Usuario desactivado" : "Usuario activado"); redo(); });
    });
    tr.querySelector("[data-reset]")?.addEventListener("click", async () => {
      const ok = await modal({ titulo: "Restablecer contraseña", aceptar: "Restablecer", onMount: montarGenerador,
        html: `<p>Nueva contraseña para <b>${esc(u.email)}</b>. Deberá cambiarla al ingresar.</p>${campoClave(generarClave())}`,
        validar: async (dlg) => { const p = valor(dlg, "password"); if (errorClave(p)) throw new Error(errorClave(p)); await st.backend.usuarios.resetearClave(id, p); } });
      if (ok) { toast("Contraseña restablecida. Entregala por un canal seguro."); redo(); }
    });
  });
}

// ---------- Parámetros ----------
export function renderAjustes(cont) {
  const s = st.datos.settings;
  cont.innerHTML = `<div class="card"><div class="card-head"><div><h2>Parámetros de análisis</h2><p class="muted">Valen para todos los usuarios: definen cómo se clasifica cada documento.</p></div></div>
    <form id="a-form" class="params" novalidate>
      <label>Días para “Por vencer”<input id="a-umbral" type="number" min="1" max="90" value="${s.umbral_por_vencer}"><small>Vencimientos entre 1 y N días.</small></label>
      <label class="check"><input id="a-hoy" type="checkbox" ${s.usar_fecha_hoy ? "checked" : ""}> Usar siempre la fecha de hoy</label>
      <label>Fecha de corte manual<input id="a-corte" type="date" value="${esc(s.fecha_corte || fmtISO(hoyUTC()))}" ${s.usar_fecha_hoy ? "disabled" : ""}><small>Se compara cada vencimiento contra esta fecha.</small></label>
    </form><p class="error" id="a-err"></p>
    <div class="acciones"><button class="btn primary" id="a-guardar">${ico("check", "sm")}Guardar parámetros</button></div>
    <ul class="reglas">
      <li><i style="background:var(--venc)"></i><b>Vencido</b> faltan 0 días o menos, o el documento requerido no está cargado.</li>
      <li><i style="background:var(--porv)"></i><b>Por vencer</b> vence dentro del plazo configurado.</li>
      <li><i style="background:var(--pend)"></i><b>Pendiente de aprobación</b> presentado y a la espera de aprobación.</li>
      <li><i style="background:var(--dia)"></i><b>Al día</b> vigente por más del plazo configurado.</li></ul></div>`;
  const hoy = cont.querySelector("#a-hoy"), corte = cont.querySelector("#a-corte");
  hoy.onchange = () => { corte.disabled = hoy.checked; };
  cont.querySelector("#a-guardar").onclick = (e) => conBoton(e.currentTarget, async () => {
    const u = +cont.querySelector("#a-umbral").value;
    if (!Number.isInteger(u) || u < 1 || u > 90) throw new Error("Los días para “Por vencer” deben ser un número entre 1 y 90.");
    if (!hoy.checked && !corte.value) throw new Error("Indicá la fecha de corte.");
    await st.backend.guardarSettings({ umbral_por_vencer: u, usar_fecha_hoy: hoy.checked, fecha_corte: hoy.checked ? null : corte.value });
    await st.recargar(); toast("Parámetros guardados");
  });
}

// ---------- Mi cuenta ----------
export function renderCuenta(cont) {
  const p = st.perfil;
  cont.innerHTML = `<div class="card cuenta"><div class="card-head"><div><h2>Mi cuenta</h2><p class="muted">${esc(p.nombre || p.email)} · ${esc(p.email)} · ${esc(ROLES[p.rol])}</p></div></div>
    <form id="c-form" novalidate><h3>Cambiar contraseña</h3>
      <label class="campo">Nueva contraseña<input type="password" name="n1" autocomplete="new-password"></label>
      <label class="campo">Repetir contraseña<input type="password" name="n2" autocomplete="new-password"></label>
      <p class="error" id="c-err" role="alert"></p>
      <button class="btn primary" type="submit">Guardar contraseña</button></form></div>`;
  cont.querySelector("#c-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, err = cont.querySelector("#c-err"); err.textContent = "";
    if (errorClave(f.n1.value)) return void (err.textContent = errorClave(f.n1.value));
    if (f.n1.value !== f.n2.value) return void (err.textContent = "Las contraseñas no coinciden.");
    await conBoton(f.querySelector("button"), async () => { await st.backend.cambiarClave(f.n1.value); f.reset(); toast("Contraseña actualizada"); });
  };
}
