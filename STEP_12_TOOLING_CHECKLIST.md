# Paso 12 · Calidad, secretos, disponibilidad y errores · completado

## Objetivo

Incorporar cuatro controles gratuitos y complementarios antes de ampliar el MVP:

1. SonarQube Cloud para calidad y seguridad preventiva.
2. GitGuardian para secretos expuestos en commits e historial.
3. Checkly para disponibilidad y recorridos reales en producción.
4. Sentry para errores JavaScript que sufran las usuarias.

Ninguna herramienta sustituye Supabase, GitHub Pages, Gemini o Pwned Passwords. Tampoco puede recibir contraseñas, tokens de sesión, correos, comentarios, predicciones activas o Karma privado.

## 1. SonarQube Cloud

### Configuración versionada

- `.sonarcloud.properties` excluye únicamente dependencias y resultados generados.
- `tests/` y `checks/` se identifican como código de prueba.
- Se usa el análisis automático del repositorio público.
- No existe `SONAR_TOKEN` en GitHub ni en el frontend.
- El script externo de Supabase está fijado en `2.111.0` y protegido en los ocho HTML con SRI SHA-384 y `crossorigin="anonymous"`.
- `tests/html-security.test.js` evita que se vuelva a usar una versión móvil del CDN o se retiren los atributos de integridad.

### Activación externa

- [x] Entrar en SonarQube Cloud con GitHub.
- [x] Importar exclusivamente el repositorio que ahora se publicará como `marcilladiazyolanda-dotcom/atinara`.
- [x] Mantener el proyecto público y el análisis automático.
- [x] Confirmar que el primer análisis termina y revisar sus ocho vulnerabilidades.
- [x] Tras publicar el Paso 12, comprobar el segundo análisis: Security A, cero vulnerabilidades y Quality Gate calculado.

El primer análisis de `main` en `c18e04e` encontró ocho instancias de `Web:S5725`, una por cada HTML, todas de impacto bajo y cinco minutos de esfuerzo. La causa común era cargar `@supabase/supabase-js@2` desde jsDelivr sin `integrity` ni CORS anónimo. La corrección se verificó contra el contenido exacto servido por jsDelivr antes de fijar el hash.

## 2. GitGuardian

### Configuración acordada

- Aplicación oficial de GitHub con acceso de lectura.
- Instalación limitada al repositorio de Oraklo.
- Escaneo histórico inicial y vigilancia de commits nuevos.
- Sin permisos de escritura ni despliegue de honeytokens.
- Sin claves GitGuardian dentro del repositorio.

### Activación externa

- [x] Crear o abrir el espacio gratuito de GitGuardian.
- [x] Instalar la aplicación oficial de GitHub con acceso de solo lectura.
- [x] Seleccionar únicamente el repositorio de Oraklo.
- [x] Esperar al escaneo histórico.
- [x] Confirmar `Health: Safe`, monitorización en tiempo real al 100 % y ningún incidente.

El escaneo histórico terminó correctamente sobre los 22 commits disponibles y no detectó
secretos. El repositorio permanece monitorizado para revisar commits nuevos.

## 3. Checkly

### Monitores versionados

- Portada: URL monitor cada 10 minutos.
- Comunidad: URL monitor cada 30 minutos.
- Recorrido público Playwright: una vez por hora desde `eu-central-1`.
- El recorrido comprueba portada, ficha real, comunidad y bloqueo de paneles administrativos para invitadas.
- No inicia sesión, no crea cuentas, no predice, no comenta y no modifica datos.

Esta frecuencia consume aproximadamente 720 ejecuciones mensuales de navegador. Queda por debajo de las 1.000 incluidas en Hobby y conserva margen para pruebas manuales.

### Credenciales

- `CHECKLY_API_KEY`: secreto de GitHub Actions.
- `CHECKLY_ACCOUNT_ID`: variable de GitHub Actions; no es un secreto.
- Ninguno de los dos valores debe escribirse en archivos, commits, ZIP o mensajes públicos.

### Activación externa

- [x] Crear o abrir una cuenta de Checkly que bajará a Hobby al terminar la prueba Team.
- [x] Comprobar los límites reales de la cuenta y la disponibilidad de `eu-central-1`.
- [x] Desplegar los tres monitores definidos en el repositorio.
- [x] Conectar desde Checkly la aplicación de GitHub limitada únicamente a Oraklo.
- [x] Guardar la API key como secreto y el Account ID como variable del repositorio.
- [x] Ejecutar una sesión de prueba y confirmar que pasan los tres controles.
- [x] Mantener alertas por email únicamente para fallos y recuperación.

## 4. Sentry

### Privacidad aplicada en el frontend

- Solo errores JavaScript.
- `sendDefaultPii: false`.
- Sin Session Replay.
- Sin trazas de rendimiento.
- Sin breadcrumbs.
- Sin identificación de usuarias.
- Eliminación de `user`, `request`, `extra` y breadcrumbs antes del envío.
- Redacción adicional de correos, UUID, JWT, tokens, sesiones y campos sensibles.
- Eliminación de query strings, por lo que no se envían identificadores de perfil o mercado incluidos en una URL.
- Carga exclusiva en el host público de GitHub Pages.
- SDK fijado en la versión `10.69.0`, con integridad SHA-384, CORS anónimo y sin referente.
- Si Sentry o su CDN fallan, Atinara continúa funcionando.

### Activación externa

- [x] Crear una organización gratuita en región europea si Sentry ofrece esa elección.
- [x] Crear un proyecto Browser JavaScript llamado `oraklo-web`.
- [x] Mantener desactivados Replay, Performance y envío de PII.
- [x] Conservar activo el data scrubber del servidor.
- [x] Copiar únicamente el DSN público en `observability-config.js`.
- [x] Publicar y provocar un error controlado que no contenga datos reales.
- [x] Confirmar la recepción y eliminar el evento de prueba si procede.

## Automatización de GitHub

- `.github/workflows/oraklo-quality.yml` ejecuta sintaxis, pruebas unitarias y tipado en cada cambio.
- `.github/workflows/checkly.yml` se salta de forma segura mientras falten la clave y el Account ID; después prueba los recorridos modificados en pull requests.
- `.github/workflows/checkly-deploy.yml` permite probar y desplegar deliberadamente los monitores desde GitHub Actions mediante ejecución manual.
- Los análisis continuos de SonarQube y GitGuardian los realizan sus aplicaciones oficiales.

## Herramientas reservadas para su momento correcto

| Herramienta | Momento obligatorio para reconsiderarla | Uso previsto |
|---|---|---|
| Penpot | Antes del próximo rediseño visual del MVP | Definir identidad, tokens, componentes, rangos, emblemas, avatares y diseños responsive antes de programarlos. |
| Mailjet | Antes de recuperación de contraseña, invitaciones o beta con cuentas reales | SMTP transaccional de Supabase con dominio, SPF, DKIM y DMARC. |
| PostHog | Al comenzar la beta cerrada y después de preparar consentimiento y privacidad | Eventos agregados, embudos y retención; replay solo con consentimiento expreso de testers. |

Penpot forma parte del propio proceso del MVP: no debe esperarse al final si se abre un bloque visual. La siguiente intervención importante sobre identidad o interfaz debe comenzar en Penpot y traducirse después al frontend.

## Pruebas locales

```bash
npm ci
npm run validate
```

Además:

- [x] Los ocho HTML cargan `observability-config.js` y `monitoring.js`.
- [x] Todos los recursos locales usan la versión coordinada vigente; tras el cambio de marca pública es `20260731-brand1`.
- [x] No hay tokens ni API keys privadas dentro del repositorio; el único identificador
  versionado de Sentry es su DSN público de ingestión.
- [x] `git diff --check` no encuentra errores.
- [x] El ZIP final contiene solo archivos versionados y no incluye `node_modules`, `.env` o `.git`.
