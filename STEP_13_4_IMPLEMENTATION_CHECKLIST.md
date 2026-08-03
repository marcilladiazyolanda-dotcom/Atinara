# Paso 13.4 · Implementación local de P0, P1 y P2

Fecha de preparación: 3 de agosto de 2026.

Estado: **implementado localmente y pendiente de activación manual y aceptación de Yol**. Este documento no confirma un despliegue. GitHub, GitHub Pages, Supabase, Penpot y los datos reales permanecieron sin cambios durante la preparación.

## 1. Base y decisiones conservadas

- [x] Clon canónico basado en `origin/main = 260495252c08667714a3dbfc03b24e4fbf853cfd`.
- [x] Rama local `codex/paso-13-4-implementacion`, sin mezclar ZIP o clones antiguos.
- [x] Paso 13.3 cerrado por Yol el 3 de agosto de 2026.
- [x] A3 y Atinara Sunset aplicados sin rediseñar la identidad.
- [x] Mercado vivo LMSR, privacidad, histórico real y `legacy_fixed_v1` conservados.
- [x] Ningún `push`, despliegue, migración remota, SQL de producción o escritura de datos.

## 2. P0 · Implementado en el árbol local

- [x] `admin-markets.html` y `admin-markets.js`: listado, búsqueda, filtros, borrador privado incompleto, edición, revisión, confirmación humana, programación/publicación, cierre anticipado, cancelación y auditoría.
- [x] `20260803143000_add_market_administration_gate.sql`: tablas privadas, RLS, permisos mínimos, huella y versión, invalidación de aprobaciones, validación determinista, publicación autoritativa y trazabilidad.
- [x] `validate-market-draft`: revisión semántica cerrada con claves solo en Edge Functions, códigos estables y persistencia privada.
- [x] `publish-scheduled-markets`: publicación periódica protegida por la clave de servicio y respuesta sin identificadores de borrador.
- [x] `analyze-market-resolution` y `approve-market-resolution`: guardas temporales, periodo original y bloqueo sin resultado preseleccionado.
- [x] El mercado histórico de «durante julio» no se modificó, aprobó ni liquidó.
- [x] Recuperación completa: respuesta no enumerativa, retorno seguro a `/Atinara/`, detección de recuperación, contraseña nueva de doce caracteres, comprobación de filtración, enlace inválido/caducado/reutilizado y cierre de sesión.
- [x] Contenido dinámico escapado, errores amistosos, administración revalidada en servidor y posiciones activas privadas.
- [ ] Migración aplicada en Supabase. **Pendiente manual; no ejecutar dos veces.**
- [ ] Edge Functions desplegadas. **Pendiente manual.**
- [ ] Programador periódico activado. **Pendiente manual.**
- [ ] SMTP propio y Mailjet configurados y correo real probado. **Pendiente manual.**

## 3. P1 · Calidad local

- [x] Foco visible, cierre y restauración de foco en buscador, menú y modales.
- [x] Navegación por teclado, nombres accesibles, estados dinámicos y errores asociados.
- [x] Sí/No diferenciados mediante texto, símbolo, posición y color.
- [x] Objetivos táctiles críticos de al menos 44 px.
- [x] `prefers-reduced-motion`, contraste AA de combinaciones canónicas y gráfica con resumen textual.
- [x] QA local sin desbordamiento global a 320, 375, 390, 768, 1024 y 1440 px en los recorridos inspeccionados.
- [x] Consola local sin errores o advertencias propios de Atinara.
- [x] Versión coordinada `v=20260803-step134a` en las diez páginas HTML.
- [x] Compatibilidad directa con `/Atinara/` y GitHub Pages sin compilación.
- [ ] Prueba autenticada de los flujos de usuaria y administradora. **Pendiente de activación y entorno controlado; no se fingió.**
- [ ] Envío real de recuperación. **Pendiente de SMTP/Mailjet.**

## 4. P2 · Sistema visual implantado

- [x] SVG A3 centralizados en `assets/brand/`: logotipos claro/oscuro, símbolo, favicon, Karma y doce glifos.
- [x] Geometría A3 procedente de los maestros aprobados, sin capturas, OCR o raster incrustado.
- [x] Tokens Atinara Sunset centralizados en `styles.css`.
- [x] Cabecera `Brand Ink`, línea Sunset fina, fondos claros, tarjetas blancas y lavanda secundaria.
- [x] Turquesa reservado a Sí, coral a No y cobre controlado para Karma.
- [x] Portada centrada en mercados, buscador real, tres columnas en escritorio, dos en tableta y una en móvil.
- [x] Sistema aplicado a ficha, predicciones, clasificación, perfil, comunidad, acceso, recuperación y administración.
- [x] Glifo de Karma después de las cantidades compactas con equivalente textual accesible.

## 5. Validación local

- [x] `npm run validate`: sintaxis válida en 30 JavaScript, 51/51 pruebas unitarias y TypeScript de Checkly.
- [x] Pruebas de economía LMSR, buscador, recuperación, privacidad, permisos, invalidación, fallo cerrado, HTML malicioso, marca, SVG y contraste.
- [x] `git diff --check`.
- [x] Búsquedas de `data.js`, Oraklo visible, secretos, lenguaje de compraventa, `×10` nuevo y fluctuaciones simuladas.
- [x] Revisión visual local como invitada, sin iniciar sesión ni crear datos.
- [ ] QA integral pública y aceptación final. **Pertenece al Paso 13.6.**

## 6. Orden seguro de activación manual

1. Conservar una copia del ZIP, su SHA-256 y el manifiesto. Verificar que el árbol extraído coincide con la entrega.
2. Aplicar **una sola vez** `supabase/migrations/20260803143000_add_market_administration_gate.sql`. No volver a ejecutar `20260801172543_add_live_prediction_market_model.sql`.
3. Comprobar en lectura que las tablas privadas, RPC, RLS y permisos existen; no crear mercados de prueba en producción.
4. Desplegar con verificación JWT las funciones `validate-market-draft`, `analyze-market-resolution`, `approve-market-resolution` y `publish-scheduled-markets`. Mantener `GEMINI_API_KEY`, `TAVILY_API_KEY` y `SUPABASE_SERVICE_ROLE_KEY` únicamente en secretos de Supabase.
5. Configurar Supabase Cron para invocar `publish-scheduled-markets` periódicamente con la autorización de `service_role` almacenada en Vault o en la configuración segura del proyecto. No copiar esa clave al repositorio, al frontend ni al chat.
6. Añadir a Supabase Auth la redirección exacta `https://marcilladiazyolanda-dotcom.github.io/Atinara/reset-password.html` y conservar la Site URL `https://marcilladiazyolanda-dotcom.github.io/Atinara/`.
7. Configurar SMTP propio/Mailjet desde el panel de Supabase: remitente Atinara, host, puerto y credenciales solo en el proveedor/panel. Revisar en español las plantillas de recuperación, confirmación e invitación. No registrar secretos en archivos.
8. Extraer el ZIP y subir **su contenido completo**, no el ZIP, mediante `Add file → Upload files` en `main`. No hay eliminaciones manuales previstas en esta entrega.
9. Esperar el despliegue de Pages y comprobar la versión `v=20260803-step134a`, recursos A3, diez HTML y rutas bajo `/Atinara/`.
10. Ejecutar la QA autenticada en un entorno controlado: administración, fallo cerrado, invalidación, programación, recuperación real, privacidad y LMSR. No utilizar el mercado contradictorio de julio ni alterar datos existentes.

El orden es intencionado: la capa de Supabase es aditiva y compatible con el frontend anterior; el frontend nuevo solo se publica después de que sus RPC y Edge Functions estén disponibles.

## 7. Punto de parada

No abrir el Paso 13.5 ni declarar 13.4 cerrado públicamente hasta que Yol complete la activación manual y la aceptación. Estado correcto: `Paso 13.4 implementado localmente y pendiente de activación manual y aceptación de Yol`.
