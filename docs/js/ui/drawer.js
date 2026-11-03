// Panel lateral deslizante para fichas.
import { esc, ico } from "../util.js";

let actual = null;
export function cerrarDrawer() { actual?.cerrar(); }
/** @returns {{el:HTMLElement, cerrar:()=>void, cuerpo:HTMLElement}} */
export function abrirDrawer({ titulo, subtitulo = "", html, onClose }) {
  cerrarDrawer();
  const root = document.createElement("div");
  root.className = "drawer-root";
  root.innerHTML = `<div class="drawer-scrim"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(titulo)}">
    <header><div><h2>${esc(titulo)}</h2>${subtitulo ? `<p class="muted">${subtitulo}</p>` : ""}</div>
    <button class="icon-btn" data-x aria-label="Cerrar">${ico("x")}</button></header>
    <div class="drawer-body">${html}</div></aside>`;
  document.body.append(root);
  document.body.classList.add("sin-scroll");
  const api = {
    el: root, cuerpo: root.querySelector(".drawer-body"),
    cerrar() { if (!root.isConnected) return; root.remove(); document.body.classList.remove("sin-scroll"); if (actual === api) actual = null; onClose?.(); },
  };
  root.querySelector(".drawer-scrim").onclick = api.cerrar;
  root.querySelector("[data-x]").onclick = api.cerrar;
  root.addEventListener("keydown", (e) => { if (e.key === "Escape") api.cerrar(); });
  actual = api;
  root.querySelector(".drawer").focus?.();
  return api;
}
