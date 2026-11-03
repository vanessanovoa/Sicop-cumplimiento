# Guía: crear el repositorio privado de SICOP en GitHub

**Para quién es:** una persona de la empresa con una cuenta de GitHub, sin conocimientos técnicos.
**Tiempo estimado:** 10 minutos. **No hace falta instalar nada ni escribir código.**
**Objetivo:** dejar un repositorio *vacío y privado* y darle acceso de escritura a Lucciano (colaborador) para que suba el proyecto.

---

## Paso 1 · Iniciar sesión
1. Entrá a https://github.com e iniciá sesión con la cuenta de la empresa.
2. Si el repositorio debe quedar dentro de la **organización** de la empresa, comprobá que tenés permiso para crear repositorios allí (si no, pedíselo a quien administre la organización).

## Paso 2 · Crear el repositorio vacío y privado
1. Arriba a la derecha, hacé clic en **+** → **New repository**.
2. Completá así:

   | Campo | Qué poner |
   |---|---|
   | **Owner** | La organización de la empresa (o tu cuenta, si no hay organización) |
   | **Repository name** | `sicop-cumplimiento` |
   | **Description** | `Panel de cumplimiento documental SICOP` (opcional) |
   | **Visibility** | **Private** ← importante |
   | Add a README file | **NO tildar** |
   | Add .gitignore | **None** (no elegir ninguno) |
   | Choose a license | **None** |

3. Hacé clic en **Create repository**.

> Es importante que quede **vacío**: sin README, sin .gitignore y sin licencia. Si se crea con alguno de esos archivos, el primer envío de código falla.

## Paso 3 · Invitar a Lucciano como colaborador
1. Dentro del repositorio recién creado, hacé clic en **Settings** (pestaña de arriba, con un engranaje).
2. En el menú de la izquierda: **Collaborators** (en algunas versiones: *Collaborators and teams*). Puede pedirte tu contraseña.
3. Botón verde **Add people**.
4. Escribí el **usuario de GitHub o el correo** de Lucciano y elegilo de la lista.
5. En el rol elegí **Write** (permite subir código; **no** permite borrar el repositorio ni cambiar su configuración).
6. Confirmá con **Add … to this repository**.
7. Lucciano recibe un correo de invitación y tiene que **aceptarla**. La invitación vence a los 7 días.

> Si la organización usa **SSO / inicio de sesión único** (SAML), se puede pedir que Lucciano autorice su acceso a la organización. Si aparece ese mensaje, avisá.

## Paso 4 · Enviar los datos a Lucciano
Copiá y completá este mensaje:

```
Repositorio creado (privado y vacío):

- URL del repositorio:  https://github.com/_______________/sicop-cumplimiento
- Organización / dueño: _______________
- Rama principal:       main            (aparece al abrir el repositorio; si dice otra, indicarla)
- Invitación enviada a: ______________ (usuario o correo de Lucciano)  ✔ rol Write
- ¿La rama principal está protegida (exige Pull Request)?  Sí / No / No sé
- ¿La organización usa SSO/SAML de GitHub?                 Sí / No / No sé
- ¿La cuenta GitHub tiene plan Team o Enterprise?          Sí / No / No sé
- Persona de contacto para temas de GitHub: ______________
```

Cómo averiguar algunos datos:
- **Rama principal:** al abrir el repositorio, arriba a la izquierda hay un botón con el nombre de la rama (normalmente `main`).
- **Rama protegida:** Settings → Branches. Si hay una regla para `main`, está protegida.
- **Plan:** en la organización, Settings → Billing and plans.

---

## Lo que pasa después (referencia para Lucciano)
1. Aceptar la invitación del correo.
2. Comprobar que la cuenta usada en este equipo es la correcta: `gh auth status` y `git config user.name` / `user.email`.
3. Inicializar y enviar el proyecto:
   ```bash
   cd /files/projects/SICOP
   git init -b main
   git add docs src tests package.json package-lock.json .gitignore README-WEB.md GUIA-REPOSITORIO.md
   git status                      # revisar: NO debe aparecer ningún .xlsx ni .pdf
   git commit -m "SICOP: panel web de cumplimiento"
   git remote add origin https://github.com/<org>/sicop-cumplimiento.git
   git push -u origin main
   ```
   Si `main` está protegida: subir a una rama (`git push -u origin feature/inicial`) y abrir un Pull Request.
4. Publicación (**más adelante**, cuando se decida): ver `README-WEB.md`. Importante: **GitHub Pages desde un repositorio privado requiere un plan de pago** (Team/Enterprise Cloud). Con plan gratuito, Pages solo funciona en repositorios públicos. El sitio no contiene datos —solo código—, pero esa decisión es de la empresa.

## Seguridad: qué NO subir
- **Nunca** subir los Excel de SICOP: la hoja `sicop` trae usuario y contraseña en texto plano. El `.gitignore` ya excluye `*.xlsx` y `*.pdf`.
- Si alguna vez se subió por error, **cambiar esas contraseñas** (borrar el archivo después no alcanza: queda en el historial).
