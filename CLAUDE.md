# CLAUDE.md · SICOP (control de cumplimiento documental)

Documento de referencia para Claude Code y para cualquier persona que continúe el proyecto. Describe **qué es**, **qué se hizo y por qué**,
**cómo funciona cada pieza** (reglas, Excel, base de datos, seguridad, front, pruebas, despliegue) y **qué falta**.
Idioma del proyecto: **español** (código, comentarios, interfaz, commits). Los identificadores técnicos van como están.

---

## 1. Qué es SICOP

Una empresa de 4 personas gestiona la documentación de cumplimiento (empleados, vehículos y proveedores de varias organizaciones/clientes) en el sistema externo **SICOP**.
Esta aplicación es el **registro central** de esa información:

- **Un administrador** (dueño de la app) carga cada **lunes** los Excel de control de SICOP. Esa carga es la base de datos.
- Entre cargas, el equipo **edita fechas y marcas**, **agrega** entidades nuevas y **archiva** las que ya no corresponden, mediante formularios.
- Los **jefes** entran al **panel**, ven qué está vencido / por vencer / en trámite y **descargan el PDF ejecutivo**.

No reemplaza a SICOP ni se conecta con él: SICOP sigue siendo el sistema donde se gestionan los trámites. Esta app solo consolida y reporta.

### Qué hace, en una frase por función
| Función | Dónde vive |
|---|---|
| Clasificar cada documento (Vencido / Por vencer / Pendiente / Al día) | `docs/js/rules.js` |
| Leer los Excel de SICOP | `docs/js/loader.js` (+ `src/worker.js`, `src/limpiar.js`) |
| Guardar datos compartidos con permisos por rol | Supabase (`supabase/`) |
| Panel, listas, fichas, importador, administración | `docs/js/views/*` |
| PDF ejecutivo | `docs/js/report.js` |

### Direcciones
- Repo: `https://github.com/vanessanovoa/Sicop-cumplimiento` (**público**; rama `main`; el sitio sale de la carpeta `docs/`).
- Sitio publicado: `https://vanessanovoa.github.io/Sicop-cumplimiento/` (GitHub Pages, fuente `main` + `/docs`).
- Supabase (proyecto "SICOP"): URL y clave *publishable* en `docs/js/config.js` (ref `muihkqenfwacvjqglugr`). Panel: `https://supabase.com/dashboard/project/muihkqenfwacvjqglugr`.

---

## 2. Reglas de negocio

### 2.1 Estados (motor `evaluar` en `docs/js/rules.js`)
Se compara el vencimiento contra una **fecha de corte** (hoy, o una fecha manual definida por el administrador). `dias = vencimiento − corte`.

| Estado | Condición | Color |
|---|---|---|
| **Vencido** | `dias ≤ 0` (incluye “vence hoy”), o documento **requerido** sin fecha (faltante), o dato inválido | rojo `#DC2626` |
| **Por vencer** | `1 ≤ dias ≤ umbral` (umbral por defecto **15**, configurable 1–90) | ámbar `#B45309` |
| **Pendiente de aprobación** | el documento fue **presentado y espera aprobación** (marca `presentado`); tiene prioridad sobre las fechas | violeta `#6D28D9` |
| **Al día** | `dias > umbral` | verde `#15803D` |

Reglas finas (todas cubiertas por tests):
- `evaluar(valor, flag, requerido, corte, umbral)` devuelve `{estado, vencimiento, dias, detalle}` o **`null`** si el documento **no aplica** (no se cuenta).
- `valor` puede ser `Date`, texto o `null`. Texto `NA`, `N/A`, `N.A.`, `no aplica`, `-`, `--` ⇒ **no aplica** (`null`). Texto `FALTANTE` o `NO` ⇒ Vencido “Faltante”.
- Vacío + **no requerido** ⇒ `null` (no se audita). Vacío + **requerido** ⇒ Vencido “Sin fecha cargada (faltante)”.
- Texto que no es fecha ni NA/FALTANTE ⇒ Vencido “Dato inválido: '…'”.
- `parsearFecha`: acepta `d/m/Y` (si no es válida, prueba `m/d/Y`), `Y-m-d`; año fuera de 1990–2100 o fecha imposible ⇒ `null`. Las fechas de 2050 (placeholders) son simplemente “muy lejanas” ⇒ Al día.
- **Pendiente**: la marca `presentado` es la columna **sin cabecera inmediatamente a la izquierda** de la columna de fecha del documento, con valor `1` (el usuario confirmó que `1` = “presentado y pendiente de aprobación”). También se reconoce un texto que empieza con `1` (regex `^1(?!\d)`) cuando no hay fecha.
- Todas las fechas se manejan en **UTC a medianoche** (sin horas) para evitar corrimientos por zona horaria.

### 2.2 Qué documentos se auditan
Definidos en `docs/js/loader.js` (`DOCS_EMPLEADOS`, `DOCS_VEHICULOS`) y sembrados en la tabla `tipos_documento`:

| Categoría | Documentos (requerido) |
|---|---|
| Empleados | Apto médico ✔, DNI ✔, Licencia de conducir ✔, Capacitación ✔, Entrega EPP ✔ |
| Vehículos | VTV ✔, Póliza ✔, Cuota ✔, Formulario RA-15 (**opcional**) |
| Proveedores | Un documento por fila; una o más columnas de fecha entre “Documentos” y “Frecuencia” (se nombran `Vencimiento <encabezado>`) |

Quedaron **fuera** (la hoja `sicop` del Excel indica que ya no son requeridos): Manual de seguridad, RA-4, Anexo V, Recibo de sueldo.

### 2.3 Qué filas se descartan al leer el Excel
- Empleados con `ABM` distinto de “Alta” (bajas), o sin apellido.
- Vehículos con `Alta SICOP = NO`, o sin dominio.
- Proveedores sin texto en “Documentos”.

### 2.4 Cifras de referencia (Excel de muestra, corte 2026-11-02)
358 registros en total: **Empleados** 223 al día / 12 pendientes / 25 vencidos; **Proveedores** 14 al día / 3 por vencer / 6 vencidos; **Vehículos** 67 al día / 1 por vencer / 7 vencidos.
Estas cifras se verifican en `tests/loader.test.mjs` y en la prueba de paridad de `tests/modelo.test.mjs`. Si cambian sin que cambie el Excel, hay una regresión.

---

## 3. El Excel de SICOP

Archivo tipo `CMAS F-1 Objetivos del Cliente SICOP(Documentación).xlsx`. **No se versiona** (`.gitignore` excluye `*.xlsx`): la hoja `sicop` contiene **credenciales en texto plano**. La app **nunca lee esa hoja** (solo Empleados, Vehículos y Proveedores).

- Nombre de la organización sugerida = texto previo a ` F-1` en el nombre del archivo (`nombreEmpresa`).
- Hojas buscadas por **inclusión del texto normalizado** (sin tildes, minúsculas): `empleado`, `vehiculo`, `proveedor`.
- Encabezados normalizados con `norm()` (NFKD, sin diacríticos, espacios colapsados, minúsculas). Se resuelven por alias (`apellido`, `nombre`, `cuil`, `abm`, `distribuidora`, `sucursal`, `dominio`, `alta sicop`, `marca`, `modelo`, `lugar donde reside`/`sucursal`, `requisito`, `documentos`, `frecuencia`).
- **Validaciones con aviso (no bloquean)**: CUIL de 11 dígitos, CUIL duplicado, dominio con formato inusual (`DOMINIO_RE = /^([A-Z]{2}\d{3}[A-Z]{2}|[A-Z]{3}\d{3})$/`), dominio duplicado, hoja ausente, columnas clave ausentes, “no se extrajo ningún documento”.
- La salida de `leerExcel(XLSX, buffer, nombre, empresaForzada)` es `{empresa, filas, avisos}` con **filas** `{empresa, categoria, subgrupo, entidad, id, documento, valor, flag, requerido}`. Es el formato común que consumen el motor de reglas y el importador.
- `construirRegistros(filas, corte, umbral)` aplica `evaluar` y produce **registros** `{empresa, categoria, subgrupo, entidad, id, documento, vencimiento, dias, estado, detalle}` (los que alimentan panel y PDF).

### 3.1 Rendimiento (`src/limpiar.js`)
La hoja de Vehículos del Excel de muestra pesa **107 MB de XML** por millones de celdas vacías con formato (`<c r="A1" s="3"/>`). Leerla tardaba ~9 s (más en navegador).
`limpiarLibro(buffer)` descomprime con **fflate**, elimina esas celdas vacías de las hojas de más de 2 MB y re-empaqueta sin compresión: **~1 s**, resultado idéntico (test `limpiarLibro`). Si algo falla, devuelve el archivo original.
La lectura corre en un **Web Worker** (`src/worker.js` → `docs/js/worker.bundle.js`) para no congelar la interfaz. Recomendación de fondo al cliente: limpiar el Excel de origen (`Ctrl+Fin`, borrar filas/columnas sobrantes).

---

## 4. Arquitectura

```
Navegador (GitHub Pages, carpeta docs/)                 Supabase (proyecto SICOP)
┌───────────────────────────────────────┐            ┌────────────────────────────────────┐
│ index.html + css/style.css            │            │ Auth (email + contraseña)          │
│ js/app.js   arranque, sesión, rutas   │  supabase  │ Postgres + RLS (permisos por rol)  │
│ js/estado.js estado + cálculos        │◄──────────►│   tablas · funciones · triggers    │
│ js/backend/supabase.js  (real)        │   -js      │ Edge Function usuarios-admin       │
│ js/backend/memoria.js   (solo ?dev)   │            │   (service_role solo en servidor)  │
│ js/views/*  panel/entidades/importar… │            └────────────────────────────────────┘
│ js/rules.js loader.js modelo.js       │
│ js/worker.bundle.js  (lee el Excel)   │  El Excel se procesa EN EL NAVEGADOR y solo se envían
│ js/report.js  (PDF con jsPDF)         │  las entidades ya convertidas (nunca el archivo).
└───────────────────────────────────────┘
```

Principios de diseño:
1. **Sitio 100 % estático**, sin servidor propio ni paso de compilación para el sitio (solo el worker se empaqueta con esbuild).
2. **La seguridad real está en la base de datos** (RLS + funciones). La interfaz oculta botones por rol (`permisos.js`) solo por usabilidad; el servidor rechaza lo no permitido.
3. **El estado nunca se guarda**: se **calcula** al vuelo desde `vencimiento` + marcas (`presentado`, `no_aplica`) con `rules.js`. No existe “forzar estado”.
4. **Un único formato de filas** conecta Excel → reglas → panel/PDF/entidades (`entidadesAFilas` ↔ `filasAEntidades`).
5. **Dos backends con la misma interfaz** (Supabase real y memoria) permiten probar la UI y los permisos sin red.

---

## 5. Base de datos (Supabase / Postgres)

Se crea ejecutando, **en orden**, `supabase/migrations/001_schema.sql`, `002_rls.sql`, `003_funciones.sql` en el SQL Editor (o pegando `supabase/instalar-todo.sql`, que es la concatenación). **Si se cambia una migración hay que regenerar `instalar-todo.sql`** (ver §10).

### 5.1 Tablas (`001_schema.sql`)
| Tabla | Columnas clave | Notas |
|---|---|---|
| `perfiles` | `user_id` (PK → `auth.users`, cascade), `email`, `nombre`, `rol` (`admin`/`trabajador`/`revisor`), `activo`, `debe_cambiar_clave`, `creado_en` | El **rol vive acá**, nunca en el cliente. |
| `organizaciones` | `id` uuid, `nombre`, `activa`, `creada_en` | Índice único `lower(nombre)`. Catálogo manual (lo crea el admin). |
| `tipos_documento` | `id`, `categoria` (`Empleados`/`Vehículos`/`Proveedores`), `nombre`, `requerido`, `orden`; único `(categoria,nombre)` | Catálogo para dar de alta entidades a mano (precarga los documentos). Sembrado con los documentos de §2.2. |
| `entidades` | `id`, `org_id`→organizaciones, `tipo` (`empleado`/`vehiculo`/`proveedor`), `etiqueta`, `identificador`, `subgrupo`, `datos` jsonb, `archivada_en`, `archivada_por`, `creada_en`, `actualizada_en`, `actualizada_por` | Unidad de edición. **Índice único parcial** `(org_id, tipo, identificador) WHERE archivada_en IS NULL`. |
| `documentos` | `id`, `entidad_id`→entidades (**on delete cascade**), `nombre`, `requerido`, `vencimiento` date null, `presentado`, `no_aplica`, `obs`, `actualizado_en`, `actualizado_por`; único `(entidad_id,nombre)` | Una fila por documento de la entidad. |
| `importaciones` | `id`, `org_id`, `archivo`, `por`, `fecha`, `resumen` jsonb | **No es historia de datos**: solo sirve para “última importación” y para detectar ediciones manuales posteriores. |
| `app_settings` | `id` (siempre 1, `check (id=1)`), `umbral_por_vencer` (1–90, def. 15), `usar_fecha_hoy`, `fecha_corte` | Parámetros globales. |

### 5.2 Identificador de entidad (`modelo.js › claveEntidad`)
- **Empleado**: el CUIL (11 dígitos). Si no hay CUIL ⇒ `~` + nombre normalizado (la interfaz lo muestra vacío).
- **Vehículo**: el dominio en mayúsculas sin espacios.
- **Proveedor**: `subgrupo|etiqueta` (requisito|documento), porque no tienen id propio.
La clave natural `(org_id, tipo, identificador)` es la que usa la importación para decidir “actualizar / crear / restaurar”.

### 5.3 Mapeo Excel → base
| Excel | Base |
|---|---|
| celda con fecha | `documentos.vencimiento` |
| indicador `1` a la izquierda | `presentado = true` |
| `NA` / `no aplica` | `no_aplica = true` |
| vacío / `FALTANTE` / `NO` / texto inválido | `vencimiento = null` (si es requerido se muestra Vencido-faltante) |
| Distribuidora / Sucursal, lugar de residencia, requisito | `entidades.subgrupo` |
| Apellido+Nombre, Marca+Modelo, “Documentos” | `entidades.etiqueta` |
Nota: un texto inválido se pierde al importar (se convierte en `null`); el aviso queda en la vista previa.

---

## 6. Seguridad

### 6.1 Roles
| Acción | Administrador | Trabajador | Revisor |
|---|:-:|:-:|:-:|
| Ver panel, listas, descargar PDF | ✔ | ✔ | ✔ |
| Editar y agregar entidades | ✔ | ✔ | — |
| Archivar / restaurar / eliminar definitivamente | ✔ | — | — |
| Importar Excel | ✔ | — | — |
| Organizaciones, parámetros, usuarios | ✔ | — | — |
Todos ven **todas** las organizaciones (decisión del usuario). El **CUIL se muestra completo** a todos los roles (decisión del usuario; conviene validarlo con quien corresponda por protección de datos).
La misma matriz está en `docs/js/permisos.js` (`puede(rol, accion)`) y se prueba contra el backend.

### 6.2 RLS y funciones (`002_rls.sql`)
- Funciones auxiliares **`SECURITY DEFINER`**, `stable`, con `search_path = public`: `mi_rol()` (rol del usuario **activo**; null si inactivo/inexistente), `soy_admin()`, `puedo_editar()` (admin o trabajador), `estoy_activo()`. Un usuario desactivado queda sin acceso aunque su sesión siga viva.
- RLS **habilitado en todas las tablas**. Lectura (`select`): cualquier usuario activo (en `perfiles` también la propia fila).
- Escritura directa: `organizaciones`, `tipos_documento`, `app_settings` (update) solo admin. `entidades` insert/update por `puedo_editar()`; **delete solo admin y solo si está archivada**. `documentos` insert/update/delete por `puedo_editar()`. `perfiles` e `importaciones` **sin escritura desde el cliente** (solo la Edge Function con `service_role` y las funciones `security definer`).
- Políticas `to authenticated`; **anon no accede a nada**.
- **Trigger `entidades_guardia`** (before update): solo un admin puede cambiar `archivada_en/archivada_por`; nadie puede cambiar `org_id` ni `tipo`; sella `actualizada_en`/`actualizada_por`.
- **Trigger `documentos_sello`**: sella `actualizado_en`/`actualizado_por`.
- `clave_cambiada()`: el usuario baja su propio `debe_cambiar_clave`.
- `bootstrap_admin(email)`: promueve al primer admin; **falla si ya existe uno**; `revoke` a public/anon/authenticated (solo se ejecuta desde el SQL Editor).
- Las funciones expuestas hacen `revoke ... from public, anon` y `grant execute ... to authenticated`.

### 6.3 Funciones de negocio (`003_funciones.sql`, todas `security definer`)
- **`importar_organizacion(p_org, p_entidades jsonb, p_archivo, p_tipos text[] default null)`** (solo admin, **una transacción**):
  1. Por cada entidad del Excel busca la clave natural (prefiere la activa y más reciente). Si no existe ⇒ **crea**; si existía archivada ⇒ **restaura** (`archivada_*` a null); si activa ⇒ **actualiza** datos.
  2. Sincroniza documentos: borra los que el Excel ya no trae y hace *upsert* de los que trae (`obs` se limpia: el Excel pisa todo).
  3. **Archiva** las entidades activas de la organización que el Excel no trae, **solo de los tipos de `p_tipos`** (si el archivo no trae la hoja Proveedores, los proveedores no se tocan; `null` = todos).
  4. Registra en `importaciones` y devuelve `{nuevas, actualizadas, restauradas, archivadas, documentos}`.
  Si algo falla a mitad, **no queda nada a medias** (test de atomicidad).
- **`guardar_entidad(p_id, p_org, p_esperada, p_ent jsonb)`** (admin/trabajador): alta (`p_id` null) o edición con **control optimista**: si `actualizada_en ≠ p_esperada` lanza `CONFLICTO` (SQLSTATE 40001). Reemplaza el conjunto de documentos. No edita archivadas.
- **`archivar_entidad(p_id, p_archivar)`** (solo admin).

### 6.4 Edge Function `usuarios-admin` (`supabase/functions/usuarios-admin/`)
Necesaria porque crear/desactivar usuarios exige la `service_role`, que **jamás** va al navegador.
- `logica.js`: lógica **pura** con `db` inyectado (testeable sin Deno ni Supabase). `index.ts`: adaptador Deno + supabase-js. `pegar-en-el-panel.ts`: ambos en un archivo (alternativa por si no hay CLI; **no está probado en producción**, se desplegó con la CLI).
- Identidad: valida el JWT del llamante con `admin.auth.getUser(token)` y exige `perfiles.rol='admin' AND activo`. Responde 403 en otro caso (verificado en producción).
- Acciones: `listar`, `crear` (valida correo y clave ≥10; crea el usuario Auth con `email_confirm:true`, inserta el perfil con `debe_cambiar_clave:true`; si falla el perfil, **borra el usuario Auth**), `cambiar_rol`, `activar`/`desactivar` (actualiza perfil y **banea** en Auth con `ban_duration`), `resetear_clave`.
- **Nunca deja al sistema sin administradores activos** (409).
- Desplegada con `--no-verify-jwt` porque el proyecto usa las claves nuevas `sb_publishable_…`/`sb_secret_…` y el filtro JWT del gateway puede rechazar tokens válidos; la verificación propia (arriba) la reemplaza.

### 6.5 Autenticación y contraseñas
- Login **email + contraseña** (Supabase Auth). **Altas públicas desactivadas**; solo el admin crea cuentas (Edge Function).
- El admin define una contraseña inicial; el usuario **debe cambiarla** en el primer ingreso (`debe_cambiar_clave`). Mínimo 10 caracteres (`validadores.js`). Sin SMTP propio **no hay “olvidé mi contraseña”**: el admin la restablece.
- La clave del sitio es la **publishable (anon)**: pública por diseño. **Nunca** poner una `sb_secret_…`/`service_role` en el repo ni en el sitio.
- Incidente registrado: durante el desarrollo se pegó en el chat una `sb_secret_…` de un proyecto anterior (`hlpvbmctsboabiaodogv`). **Debe rotarse**; el proyecto vigente es otro (`muihkqenfwacvjqglugr`).

---

## 7. Front-end (`docs/`)

Módulos ES nativos (sin bundler para el sitio). Librerías vendorizadas en `docs/vendor/` (sin CDN): `jspdf`, `jspdf-autotable`, `chart.js`, `supabase.js` (+ `591.supabase.js`, chunk lazy), Inter (woff2) y `icons.svg` (sprite Lucide generado con `scripts/build-icons.mjs`).

### 7.1 Módulos
| Archivo | Responsabilidad |
|---|---|
| `index.html` | Login (`#form-login`), cambio obligatorio de clave (`#form-clave`), shell (sidebar `#nav` dinámico, topbar con búsqueda/organizaciones/alertas/usuario), panel (`#view-panel`) y contenedor genérico `#view-main`. |
| `app.js` | Arranque, elección de backend, sesión (`entrar`, `salir`), **router por hash** (`#/panel`, `#/entidades/{empleado\|vehiculo\|proveedor}`, `#/importar`, `#/organizaciones`, `#/usuarios`, `#/ajustes`, `#/cuenta`) con guardia por permiso, navegación por rol, popovers, PDF, modo DEV. Define `st.recargar()` (recarga todos los datos y re-renderiza). |
| `estado.js` | Estado compartido `st` (backend, perfil, datos, filtros, orden, página). `registros()` (cacheado por versión/corte/umbral) convierte entidades activas de organizaciones activas en registros evaluados. `filtrar`, `criticos`, `corte()`, `umbral()`, `aplicarDatos`. |
| `modelo.js` | `TIPOS`, `claveEntidad`, **`entidadesAFilas`** (BD → filas), **`filasAEntidades`** (Excel → entidades; avisa filas repetidas), **`diffImportacion`** (vista previa), `peorEstado`. |
| `rules.js`, `loader.js`, `report.js` | Motor de reglas, lectura de Excel, PDF (ver §2, §3, §7.5). |
| `permisos.js` | Matriz rol→acciones y `ROLES` (nombres visibles). |
| `validadores.js` | `cuilValido` (módulo 11 + caso especial AFIP prefijo 23 con 4/9), `dominioValido`/`normalizarDominio`, `EMAIL_RE`, `errorClave`, `generarClave`. |
| `util.js` | `$`, `esc` (escape HTML), `ico`, `toast`, `conBoton` (deshabilita botón y muestra errores como toast), `fmtFechaHora`, `leerLS/escribirLS` (localStorage seguro). |
| `backend/supabase.js` | Backend real (ver §7.3). |
| `backend/memoria.js` | Backend en memoria con las **mismas reglas de permisos** (para `?dev` y tests). |
| `ui/modal.js`, `ui/drawer.js` | Diálogos `<dialog>` (`modal`, `confirmar`, `aviso`) y panel lateral deslizante. |
| `views/panel.js` | Hero de cumplimiento, KPIs por estado, gráficos (Chart.js: vencimientos por semana, estado por organización), “Requieren acción”, cumplimiento por categoría, tabla de detalle con filtros y paginación. |
| `views/entidades.js` | Lista por tipo (filtros organización/estado, “Ver archivados” para admin, orden, paginación) y **ficha** en drawer. |
| `views/importar.js` | Importador (ver §8.1). |
| `views/admin.js` | Organizaciones, Usuarios (+ matriz de roles), Parámetros, Mi cuenta. |
| `worker.bundle.js` | Generado (esbuild) desde `src/worker.js` + `loader.js` + `src/limpiar.js` + xlsx + fflate. **No editar a mano**; regenerar con `npm run build`. |

### 7.2 Flujo de arranque (`app.js › arrancar`)
1. `?dev` en `localhost` ⇒ backend en memoria con datos opcionales (§7.4). 
2. Si `config.js` está vacío ⇒ login deshabilitado con aviso “Falta configurar Supabase”.
3. Si no, backend Supabase: `init()` restaura la sesión y carga el perfil (si el perfil está inactivo cierra sesión). Sin sesión ⇒ login.
4. `entrar(perfil)`: si `debe_cambiar_clave` ⇒ pantalla de cambio obligatorio; si no, `cargar()` (organizaciones, entidades con documentos, tipos, ajustes, importaciones, perfiles), construye la navegación según rol y renderiza. Un admin sin datos es llevado a **Importar**.

### 7.3 Interfaz de backend (idéntica en `supabase.js` y `memoria.js`)
`init`, `iniciarSesion(email, pass)`, `cerrarSesion`, `cambiarClave(nueva)`, `cargar()`, `guardarEntidad({id, org_id, esperada, ent})`, `archivar(id, bool)`, `eliminar(id)`, `importar(orgId, entidades, archivo, tipos)`, `crearOrg`, `actualizarOrg`, `guardarSettings`, y `usuarios.{listar, crear, cambiarRol, activar, desactivar, resetearClave}`.
`supabase.js` además: **pagina** las lecturas de a 1000 filas (límite de PostgREST), **traduce errores** de Postgres/Auth a mensajes claros (`conflicto`, `duplicado`, `permiso`, `credenciales`, `red`) con `ErrorBackend.codigo`, y llama a la Edge Function con `sb.functions.invoke`.

### 7.4 Modo DEV (solo `localhost`/`127.0.0.1`)
`http://localhost:8000/?dev&rol=admin|trabajador|revisor&muestra=muestra.xlsx&demo&clave&ficha=<tipo>|nuevo-<tipo>&archivo=muestra.xlsx`
- Datos **en memoria** (se pierden al recargar). `muestra` importa un Excel servido junto al sitio en la organización CMAS (`demo` agrega ARCOR; siempre existe “Empresa vacía”). El backend se siembra como admin y luego se baja al `rol` pedido, por lo que los permisos del rol aplican de verdad.
- `clave` simula primer ingreso; `ficha` abre una ficha (para capturas); `archivo` simula elegir un Excel en Importar.
- **No existe en producción** (exige hostname local). No es un mecanismo de seguridad: no da acceso a Supabase.

### 7.5 PDF (`report.js › generarPdf`)
A4 apaisado con jsPDF + autoTable: portada con KPIs y resúmenes “Por empresa” y “Por empresa y categoría”, luego secciones **Vencidos**, **Por vencer** y **Pendientes** (tablas). Se genera en el navegador a partir de los registros evaluados; “PDF · filtros activos” respeta los filtros del panel y “PDF completo” no. Colores en azul corporativo (`GRIS=[31,95,168]`).

### 7.6 Estilo (`css/style.css`)
Diseño “SaaS moderno”, **blanco + azul corporativo** (el usuario rechazó el gris). Tokens en `:root` (`--b50…--b900` azules, `--s50…--s900` neutros, colores de estado). Componentes: sidebar, topbar, cards, KPIs, chips, tablas, badges, popovers, toasts, modal, drawer, importador. `[hidden]{display:none!important}`. Responsive (≤1100 / ≤900 px). Inter local.

---

## 8. Flujos funcionales

### 8.1 Importación semanal (admin)
1. **Importar Excel** → arrastrar uno o varios `.xlsx`. Cada archivo se lee en el worker (`leerExcel`) y se convierte con `filasAEntidades`.
2. Por archivo: se **sugiere la organización** por coincidencia del nombre (o “Crear «X»” inline). 
3. **Vista previa** (`diffImportacion` contra lo cargado): nuevas · se actualizan · se restauran · **se archivan** (no vienen en el archivo) · **ediciones manuales que se pisan** (entidades con `actualizada_en` posterior a la última importación de esa organización; si nunca se importó, toda entidad existente cuenta) · avisos de validación. Solo se consideran los **tipos presentes** en el archivo.
4. Confirmar ⇒ RPC `importar_organizacion` (atómica) ⇒ recarga y resumen.
Decisión del usuario: **“el Excel pisa todo”** y **sin historia**: no hay deshacer; lo archivado se recupera, lo editado a mano que el Excel pisa no.

### 8.2 Edición (admin/trabajador)
Lista → fila → **ficha** (drawer): datos de la entidad + grilla de documentos (fecha, Pendiente, No aplica, Requerido, Observación, estado calculado **en vivo**) + agregar/quitar documentos (con `datalist` del catálogo). Guardar ⇒ `guardar_entidad`. Validaciones en cliente: nombre obligatorio, CUIL válido (módulo 11) o dominio válido, nombres de documento únicos; duplicados los rechaza el índice único (mensaje “Ya existe un registro…”). **Conflicto**: si otra persona guardó antes, se avisa, se cierra la ficha y se recarga. Revisor: ficha de solo lectura.

### 8.3 Archivado (admin)
“Archivar” saca la entidad del panel, listas y PDF (recuperable). “Ver archivados” ⇒ **Restaurar** o **Eliminar definitivamente** (único borrado real, no se deshace).

### 8.4 Usuarios (admin)
Crear (nombre, correo, rol, contraseña inicial con generador), cambiar rol, desactivar/activar, restablecer clave. El usuario entra y debe elegir su contraseña. Desactivar banea en Auth y anula todos sus permisos por RLS.

### 8.5 Parámetros (admin)
Días de “Por vencer” (1–90), “usar fecha de hoy” o fecha de corte manual. Valen para **todos** (se guardan en `app_settings`).

---

## 9. Pruebas

Comando: `SICOP_MUESTRA="/ruta/al/Excel.xlsx" npm test` (`node --test tests/`). Sin `SICOP_MUESTRA` se saltean las pruebas que usan el Excel real. Hoy: **40 pruebas** (37 pasan sin Excel; las 3 que usan el Excel real se saltean si falta `SICOP_MUESTRA`), **0 fallan**.

| Archivo | Qué cubre |
|---|---|
| `tests/loader.test.mjs` | Límites del motor de reglas, nombre de empresa, **cifras del Excel de muestra** (§2.4), `limpiarLibro` idéntico al original y rápido. |
| `tests/modelo.test.mjs` | **Paridad** Excel→entidades→filas (358 registros idénticos, sin avisos), conversión de celdas, claves, repetidos, `diffImportacion`, CUIL/dominio/clave, **matriz de permisos**. |
| `tests/report.test.mjs` | El PDF se genera con sus 4 partes (portada, vencidos, por vencer, pendientes). |
| `tests/rls.test.mjs` + `tests/sql/stub.sql` | Migraciones reales sobre **PGlite** (Postgres en WASM) con auth/roles simulados: lectura por rol (inactivo y anónimo no ven), escritura directa, no escalada de rol, archivar/eliminar, importación (crea/actualiza/archiva/restaura/atómica/`p_tipos`), `guardar_entidad` (optimista, permisos, duplicados), `bootstrap_admin`. |
| `tests/usuarios.test.mjs` | Lógica de `usuarios-admin`: 403 a no-admin, validaciones, rollback del usuario Auth, **último admin**, baneo, reset. |
| `tests/ui.test.mjs` | Vistas reales sobre **jsdom** + backend en memoria: botones por rol, ficha (revisor solo lectura, trabajador edita, recálculo en vivo, CUIL inválido, alta, duplicado), archivar/restaurar/eliminar, rechazo de acciones sin permiso, conflicto, organizaciones, usuarios, parámetros. |
| `tests/test_rules.py` | Pruebas de la versión Python (`python -m unittest discover tests`). |

**Límites honestos**: la capa `backend/supabase.js` (cliente real) y la Edge Function desplegada solo se verificaron parcialmente (respuestas 403/401/200 contra el proyecto real); **no hay prueba end-to-end automatizada contra Supabase**. El panel con Chart.js y el PDF no tienen pruebas de interfaz (se revisaron con capturas). Pendiente: checklist manual del README-SUPABASE.md con cada rol.

---

## 10. Comandos y mantenimiento

```bash
npm install
SICOP_MUESTRA="…xlsx" npm test
npm run build                       # regenera docs/js/worker.bundle.js (esbuild; --external:fs --external:stream)
node scripts/build-icons.mjs        # regenera docs/vendor/icons.svg (lista de íconos Lucide usados)
python3 -m http.server --directory docs 8010   # servir en local (http://localhost:8010/?dev&rol=admin)

# Regenerar el SQL único (tras cambiar migraciones)
for f in 001_schema 002_rls 003_funciones; do echo "-- ===== $f.sql ====="; cat supabase/migrations/$f.sql; echo; done > supabase/instalar-todo.sql

# Edge Function (la CLI en modo agente exige --yes explícito del usuario)
npx supabase login
npx supabase functions deploy usuarios-admin --no-verify-jwt --yes --remote=<ref>
```
- **Cambiar la configuración**: `docs/js/config.js` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `FUNCION_USUARIOS`).
- **Agregar un documento auditado**: `DOCS_*` en `loader.js` **y** semilla de `tipos_documento` (nuevo SQL) y, si es opcional/obligatorio, el flag `requerido`.
- **Agregar un permiso**: `permisos.js` **y** la política/función SQL correspondiente (el servidor manda).
- **Nueva vista**: ruta en `RUTAS`/`NAV` de `app.js` + módulo en `views/` + permiso.
- **Primer admin**: crear el usuario en Authentication → Users (Auto Confirm) y `select public.bootstrap_admin('correo');`.
- **Deploy del sitio**: cada push a `main` publica `docs/` por GitHub Pages (1–2 min; Ctrl+Shift+R por caché).
- Python legado: `pip install -r requirements.txt`; `streamlit run app.py`; `python -m sicop.cli a.xlsx -o reporte.pdf`.

---

## 11. Historia del proyecto (qué se hizo y por qué)

1. **Versión Python/Streamlit** (`sicop/`, `app.py`): ingesta de Excel con openpyxl, reglas, PDF con reportlab y dashboard Streamlit. Sigue en el repo como alternativa local (usa colores grises antiguos). Se confirmó el significado del indicador `1` (“presentado y pendiente de aprobación”) y los documentos ya no requeridos.
2. **Reescritura a JavaScript estático** para publicar en GitHub Pages (Pages no ejecuta Python): `rules.js`, `loader.js` (con Web Worker), `report.js` (jsPDF). Paridad verificada contra Python.
3. **Estética corporativa**: el usuario rechazó el gris; se rehízo en blanco + azul, estilo SaaS (sidebar, KPIs, gráficos, hero). Se separó la importación en una pestaña de configuración y se quitó el recuadro “Modo de datos”.
4. **Login**: primero Google (descartado por no funcionar y por la dependencia), luego un login plano de **prototipo** con usuarios locales (PBKDF2 + sessionStorage) y carga de Excel desde la PC con persistencia en IndexedDB. Se evaluó leer el Excel desde Google Drive (requiere API/credenciales) y se descartó. **Todo ese prototipo fue eliminado** (`auth.js`, `users.js`, `store.js`, `gen-users.mjs`): no compartía datos entre personas y su seguridad era cosmética.
5. **Requisito real**: 4 personas, 1 administrador que carga Excel los lunes, jefes que consultan, y edición posterior por formulario. Se entrevistó al usuario y se decidió el diseño actual (Supabase, roles Administrador/Trabajador/Revisor, catálogo de organizaciones, “Excel pisa todo”, entidad+documentos, estado calculado, archivar recuperable, sin historia, correo real, CUIL completo, sin avisos por correo, Supabase creado por la empresa).
6. **Implementación del diseño**: migraciones SQL + RLS + funciones, Edge Function, backends Supabase/memoria, vistas, importador con vista previa, administración, pruebas (SQL sobre PGlite, UI sobre jsdom), guía `README-SUPABASE.md`.
7. **Optimización del Excel** (`limpiar.js`): 9 s → 1 s.
8. **Publicación**: repo `vanessanovoa/Sicop-cumplimiento` (primero privado, hecho público para poder usar GitHub Pages gratis), Pages desde `main` + `/docs`, función `usuarios-admin` desplegada con la CLI en el proyecto Supabase del usuario.

---

## 12. Estado actual y pendientes

**Hecho y funcionando**: sitio publicado; tablas, RLS y funciones creadas; función `usuarios-admin` desplegada (responde 403 sin admin); anónimo no ve nada; pruebas locales en verde.

**Pendiente / a verificar**
- Crear el **primer administrador** (`servicios@lcampassi.com`) en Authentication y ejecutar `bootstrap_admin`; desactivar *Allow new users to sign up*; configurar *Site URL / Redirect URLs* con la URL de Pages.
- **Prueba end-to-end real** con las tres cuentas (admin, trabajador, revisor), importación del Excel, edición, archivado, PDF.
- **Rotar** la `sb_secret_…` expuesta del proyecto anterior (§6.5).
- El proyecto Supabase actual es de la cuenta personal del desarrollador; la decisión original era que **lo cree la empresa**. Si pasa a la empresa, transferir el proyecto o recrearlo (migraciones + función + `config.js`).
- Plan Supabase: el gratuito **se pausa por inactividad y no hace respaldos**; recomendar plan con respaldos (datos personales: CUIL, aptos médicos).
- Recuperación de contraseña por correo (requiere SMTP propio): hoy la restablece el admin.
- Mejoras posibles: historial de cambios (descartado por ahora), avisos por correo (descartado), pruebas automatizadas del panel/Chart.js, E2E contra Supabase local, mover `instalar-todo.sql`/`pegar-en-el-panel.ts` a generación automática.

---

## 13. Convenciones y advertencias para quien continúe

- **Idioma**: español en UI, comentarios, commits y documentación.
- **Git**: rama `main`; commits terminan con `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` cuando los hace Claude. **No hacer push sin que el usuario lo pida.** El repo es de la cuenta `vanessanovoa` (el usuario es colaborador con permiso de escritura; **no es administrador**, por lo que no puede cambiar *Settings → Pages*).
- **Secretos**: nunca guardar claves `sb_secret_…`, `service_role`, contraseñas ni el Excel real en el repo. `.gitignore`: `*.xlsx`, `*.pdf`, `node_modules/`, `.venv/`, `supabase/.temp/`, `__pycache__/`. El repo es **público**: todo lo que se suba es visible.
- **No editar** `docs/js/worker.bundle.js` a mano.
- Para cambios de esquema: nueva migración numerada (`004_…`) en lugar de editar las ya aplicadas en producción; regenerar `instalar-todo.sql`; añadir pruebas en `tests/rls.test.mjs`.
- **Entorno de desarrollo**: no hay Docker ni Postgres local (por eso PGlite); la extensión de Chrome no estaba conectada (capturas con `firefox --headless --screenshot` y un servidor local con una imagen “lenta” para esperar la carga asíncrona); un servidor viejo ocupa el puerto 8000 (sirve `docs` mediante enlaces simbólicos); evitar `pkill -f` en la sesión (mata el shell).
- **Supabase CLI**: en modo agente exige `--yes`; el flag `--no-verify-jwt` fue bloqueado por el control de seguridad de Claude Code y lo ejecutó el usuario.
- Los archivos `README-SUPABASE.md` (puesta en marcha para TI), `README-WEB.md` (resumen técnico) y `GUIA-REPOSITORIO.md` (cómo crear el repo, redactada para una persona no técnica) complementan este documento.
