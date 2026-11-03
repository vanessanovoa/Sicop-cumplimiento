// Diálogos modales (basados en <dialog>) para formularios simples y confirmaciones.
import { esc, ico } from "../util.js";

/**
 * @param {{titulo:string, html:string, aceptar?:string, cancelar?:string, peligro?:boolean, onMount?:(dlg:HTMLDialogElement)=>void,
 *  validar?:(dlg:HTMLDialogElement)=>Promise<boolean|void>|boolean|void}} o
 * Resuelve true al aceptar (si validar no devolvió false) y false al cancelar.
 */
export function modal(o) {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "modal";
    dlg.innerHTML = `<form method="dialog" class="modal-box" novalidate>
      <header><h2>${esc(o.titulo)}</h2><button type="button" class="icon-btn" data-x aria-label="Cerrar">${ico("x")}</button></header>
      <div class="modal-body">${o.html}</div><p class="error" data-err role="alert"></p>
      <footer>${o.cancelar === null ? "" : `<button type="button" class="btn" data-no>${esc(o.cancelar || "Cancelar")}</button>`}
        <button type="submit" class="btn ${o.peligro ? "danger-fill" : "primary"}" data-ok>${esc(o.aceptar || "Aceptar")}</button></footer></form>`;
    document.body.append(dlg);
    const cerrar = (v) => { if (dlg.open) dlg.close(); dlg.remove(); resolve(v); };
    dlg.querySelector("[data-x]").onclick = () => cerrar(false);
    dlg.querySelector("[data-no]")?.addEventListener("click", () => cerrar(false));
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); cerrar(false); });
    dlg.querySelector("form").onsubmit = async (e) => {
      e.preventDefault();
      const btn = dlg.querySelector("[data-ok]"); btn.disabled = true;
      try { if ((await o.validar?.(dlg)) === false) return; cerrar(true); }
      catch (err) { dlg.querySelector("[data-err]").textContent = err.message || String(err); }
      finally { btn.disabled = false; }
    };
    dlg.showModal();
    o.onMount?.(dlg);
    (dlg.querySelector("[autofocus]") || dlg.querySelector("input,select,textarea") || dlg.querySelector("[data-ok]")).focus();
  });
}
export const confirmar = (titulo, texto, aceptar = "Confirmar", peligro = false) =>
  modal({ titulo, html: `<p>${texto}</p>`, aceptar, peligro });
export const aviso = (titulo, texto) => modal({ titulo, html: `<p>${texto}</p>`, aceptar: "Entendido", cancelar: null });
export const valor = (dlg, name) => dlg.querySelector(`[name="${name}"]`)?.value.trim() ?? "";
