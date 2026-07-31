# Cambio de marca pública · Atinara

## Decisión

- **Marca visible:** Atinara; `ATINARA` puede usarse en el logotipo.
- **Nombre interno heredado:** Oraklo.
- No se renombran contratos técnicos existentes como `oraklo_admin`, RPC, eventos `oraklo:*`, variables `window.oraklo*`, migraciones, proyectos de monitorización o historial Git.
- El cambio no modifica datos económicos, permisos, RLS, Auth ni liquidaciones.

## 1. Código versionado

- [x] Cambiar títulos, descripciones y nombre de cabecera en los ocho HTML.
- [x] Cambiar etiquetas accesibles de inicio, acceso, navegación y comunidad.
- [x] Añadir `application-name`, Open Graph y Twitter Card con Atinara.
- [x] Cambiar mensajes dinámicos de acceso, perfiles, comunidad, ranking, predicción y administración.
- [x] Cambiar el título dinámico de los perfiles públicos.
- [x] Cambiar el nombre que puede aparecer en la fuente pública y en el contexto de análisis de `analyze-market-resolution`.
- [x] Mantener los identificadores internos para no romper compatibilidad.
- [x] Coordinar todos los recursos con `20260731-brand1`.
- [x] Actualizar los nombres mostrados por Checkly y GitHub Actions sin cambiar sus identificadores lógicos.
- [x] Añadir `tests/public-brand.test.js` para impedir que reaparezca la marca anterior en la superficie pública.
- [x] Actualizar `README.md`, `AGENTS.md`, este contexto y el estado real del Paso 12.

## 2. Publicación del frontend

- [ ] Publicar el ZIP completo de esta rama en `main`; no subir archivos sueltos.
- [ ] Esperar a que GitHub Pages termine el despliegue.
- [ ] Recargar con `Ctrl+F5` y comprobar portada, mercado, predicciones, clasificación, perfil, comunidad y los dos paneles administrativos.
- [ ] Confirmar que títulos del navegador, cabeceras, modal de acceso, menú de cuenta y mensajes de error muestran Atinara.
- [ ] Confirmar que el código fuente público carga únicamente recursos con `v=20260731-brand1`.

## 3. Supabase y contenido generado

- [ ] Volver a desplegar únicamente la Edge Function `analyze-market-resolution` con el archivo actualizado. No hace falta SQL ni migración.
- [ ] Desde el panel administrativo, analizar sin aprobar un mercado ambiguo y comprobar que la fuente propuesta se titula «Ficha original y criterios del mercado en Atinara».
- [ ] Revisar en Auth > Email Templates los asuntos y cuerpos de confirmación, invitación y cambio de correo; sustituir cualquier marca visible antigua por Atinara.
- [ ] Revisar el nombre visible del remitente o del proyecto en los correos de Auth. Si el proveedor gratuito no permite personalizarlo, dejarlo anotado para Mailjet en el Paso 13.
- [ ] Revisar mercados ya resueltos o anulados para confirmar que ninguna explicación o fuente histórica pública conserva «Oraklo». No modificar una fila sin identificar antes el campo y el mercado exactos.

## 4. URL pública · decisión aprobada

La usuaria decidió el 31 de julio de 2026 continuar gratuitamente en GitHub Pages y aplazar la compra del dominio hasta justo antes de la beta cerrada.

### Ruta actual · GitHub Pages

- [ ] Renombrar el mismo repositorio a `atinara`, sin copiarlo ni crear otro.
- [x] Preparar las rutas hardcodeadas de GitHub Pages para `https://marcilladiazyolanda-dotcom.github.io/atinara/` en Checkly, Sentry, pruebas y `analyze-market-resolution`.
- [x] Preparar `checkly.config.ts` con la nueva URL del repositorio.
- [ ] Tras el renombrado, actualizar en Supabase Auth la Site URL y las redirecciones permitidas a la nueva ruta exacta.
- [ ] Verificar SonarQube, GitGuardian, Checkly y GitHub Actions después del cambio de nombre.

### Ruta posterior · dominio propio

- [ ] Volver a comprobar disponibilidad, marca y precio de `atinara.com` inmediatamente antes de la beta cerrada.
- [ ] Registrar el dominio y conectarlo al mismo GitHub Pages, sin mover el alojamiento.
- [ ] Actualizar DNS, HTTPS, Supabase Auth, Checkly, Sentry y la URL pública de `analyze-market-resolution` al dominio definitivo.

La nueva configuración no debe desplegarse por partes: primero se publica el frontend y se renombra el repositorio; inmediatamente después se actualizan Supabase Auth, la Edge Function y los monitores para evitar una ventana con rutas mezcladas.

## 5. Aceptación final

- [ ] Buscar `Oraklo` en todas las pantallas y estados accesibles para invitada, usuaria y administradora; no debe aparecer como marca.
- [ ] Compartir la portada y una ficha en un comprobador Open Graph; deben mostrar Atinara.
- [ ] Ejecutar los tres controles de Checkly contra la URL final.
- [ ] Confirmar que Sentry acepta el host final y continúa redactando PII.
- [ ] Ejecutar `npm run validate` y `git diff --check` sobre la versión definitiva.
- [ ] Solo entonces marcar la transición pública como terminada y comenzar la auditoría funcional 13.1.
