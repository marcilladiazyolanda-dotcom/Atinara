# Pautas de calidad SonarQube Cloud · Atinara

## Punto de partida del incidente

El análisis automático del 4 de agosto de 2026 sobre `main` y la revisión
`c7469c449ac7db44f9f8cfdbc4509ab87e76a12c` mantenía el Quality Gate en verde,
con seguridad y fiabilidad en A, pero todavía mostraba 347 incidencias activas.
Todas eran `CODE_SMELL`: no había bugs, vulnerabilidades ni hotspots de seguridad.

La distribución explicaba el origen:

- 111 avisos `plsql:S1192` en migraciones históricas ya aplicadas;
- 65 avisos en `styles.css`, principalmente selectores duplicados y contraste;
- 23 avisos de semántica HTML;
- el resto estaba en JavaScript y TypeScript: ternarios anidados, funciones con
  demasiadas responsabilidades, excepciones ignoradas y APIs antiguas.

## Por qué ocurrió

1. Las migraciones fueron acumulando SQL legítimo e inmutable. Sonar aplicó a ese
   historial una regla de mantenibilidad pensada para código que sí puede
   refactorizarse.
2. El CSS creció por fases añadiendo bloques de sobrescritura al final del archivo.
   Eso duplicó selectores y dejó colores translúcidos cuyo contraste dependía del
   fondo situado debajo.
3. Algunas ayudas ARIA replicaban semántica que HTML ya ofrece con elementos
   nativos.
4. Varias funciones incorporaron progresivamente carga, validación, renderizado,
   tratamiento de errores y persistencia. El comportamiento era correcto, pero
   la complejidad cognitiva dejó de ser fácil de revisar.
5. Las Edge Functions concentraban preflight HTTP, autenticación, autorización,
   proveedor externo, normalización y persistencia en un único manejador.

## Decisiones aplicadas

### Migraciones

Las migraciones aplicadas no se reescriben. El análisis automático de
SonarQube Cloud admite `sonar.cpd.exclusions` en `.sonarcloud.properties`; se
usa únicamente para retirar los snapshots SQL inmutables del cálculo de
duplicación. Esos archivos siguen dentro del análisis de seguridad, fiabilidad
y mantenibilidad. Las exclusiones por regla y ruta continúan configurándose en
el panel del proyecto, porque `sonar.issue.ignore.multicriteria` no forma parte
de los parámetros admitidos por el análisis automático.

Para los literales repetidos:

1. `Administration` → `General Settings` → `Analysis Scope`.
2. Abrir `Ignore Issues on Multiple Criteria`.
3. Añadir el criterio con regla `plsql:S1192`.
4. Usar el patrón de archivo `supabase/migrations/**/*.sql`.
5. Guardar y lanzar un análisis nuevo.

Esta combinación omite únicamente los literales repetidos de las migraciones
históricas. Los mismos archivos siguen analizándose para cualquier otra regla
de seguridad, fiabilidad o calidad.

El corte del 12 de agosto de 2026 requiere además excepciones exactas para
sentencias de backfill que recorrieron deliberadamente todas las filas y para
dos comparaciones `coalesce(..., '') = ''`. Se crea un criterio independiente
por cada pareja; nunca se usa un comodín para la regla de `UPDATE`:

| Regla | Ruta exacta | Motivo verificado |
|---|---|---|
| `plsql:DeleteOrUpdateWithoutWhereCheck` | `supabase/migrations/20260808120000_add_authoritative_draft_versions_and_review_attempts.sql` | Backfill completo y no repetible de metadatos de revisión. |
| `plsql:DeleteOrUpdateWithoutWhereCheck` | `supabase/migrations/20260808180729_add_autonomous_repair_and_market_families_v2.sql` | Recorrido completo para activar los triggers de familia recién instalados. |
| `plsql:DeleteOrUpdateWithoutWhereCheck` | `supabase/migrations/20260808185135_deduplicate_market_family_matches.sql` | Recorrido completo para deduplicar los arrays mediante el trigger vigente. |
| `plsql:DeleteOrUpdateWithoutWhereCheck` | `supabase/migrations/20260808204159_fix_radar_prepare_identity_and_blocking_duplicates.sql` | Reclasificación completa que elimina autocoincidencias. |
| `plsql:DeleteOrUpdateWithoutWhereCheck` | `supabase/migrations/20260808221745_fix_radar_editor_atomic_preparation.sql` | Reclasificación completa anterior al corte factual. |
| `plsql:NullComparison` | `supabase/migrations/20260809140000_authoritative_radar_fact_gate_v1.sql` | Las dos expresiones usan `coalesce` para equiparar explícitamente `NULL` y cadena vacía; no comparan directamente con `NULL`. |

Al pegar una regla o una ruta, hay que comprobar que el valor no contiene
espacios iniciales o finales. Sonar trata ese espacio como parte del patrón y el
criterio deja de coincidir. Después de guardar, se revisan de nuevo los siete
pares en el panel y se hace un push real para que el análisis automático aplique
la configuración; volver a ejecutar solo el workflow de GitHub Actions no crea
un análisis nuevo de Sonar.

Estas seis rutas ya están aplicadas en producción y permanecen byte a byte
intactas. Las pruebas SQL editables sí deben corregir el patrón que detecte
Sonar; no se incluyen en esta excepción.

Nunca se debe:

- excluir toda la carpeta de migraciones;
- desactivar una regla para todo el proyecto;
- aplicar `DeleteOrUpdateWithoutWhereCheck` a un patrón de carpeta;
- modificar una migración aplicada solo para silenciar Sonar;
- marcar manualmente un problema como resuelto si el código editable sigue
  conteniendo la causa.

Si una migración necesita cambiar el comportamiento de producción, se crea una
migración nueva, aditiva y trazable.

### HTML y accesibilidad

- Navegación y cuenta: `<nav>` en lugar de `role="group"`.
- Valores calculados o estados: `<output>` en lugar de `role="status"`.
- Grupos de filtros: `<fieldset>` y `<legend>`.
- Modales: `<dialog>` con `showModal()` y `close()`.

Regla práctica: primero se elige el elemento HTML nativo; ARIA solo completa lo
que el elemento no expresa por sí mismo.

### CSS

- Editar el selector canónico o usar un selector deliberadamente contextual;
  no copiar el mismo selector al final del archivo.
- Usar tokens semánticos y fondos opacos conocidos para estados de texto.
- Verificar contraste mínimo `4.5:1` para texto normal antes de aceptar un color.
- Una nueva fase visual debe consolidar reglas anteriores cuando las sustituya.

### JavaScript y TypeScript

- Una función coordina una responsabilidad. Autenticación, validación,
  transformación, renderizado y persistencia se separan en ayudantes con nombre.
- No usar ternarios anidados. Cuando existen tres estados, usar `if` o una tabla
  de configuración.
- Toda excepción se trata o se deja propagar. Si debe conservarse un mensaje
  genérico por privacidad, registrar solo el contexto y el nombre del error; no
  registrar correos, UUID, JWT, borradores, predicciones ni secretos.
- Preferir `replaceAll`, `.at()`, `.dataset`, encadenamiento opcional,
  `RegExp.exec()` y métodos DOM nativos cuando expresen directamente la intención.
- Mantener la complejidad cognitiva de cada función en 15 o menos.

### Edge Functions

Mantener explícitas estas capas:

1. preflight y tamaño de petición;
2. autenticación de sesión;
3. autorización `app_metadata.oraklo_admin === true`;
4. validación de entrada;
5. consulta o proveedor externo;
6. persistencia y respuesta pública.

Separar funciones no reduce la seguridad: cada recorrido administrativo conserva
la comprobación en servidor y continúa fallando de forma cerrada. La IA propone;
la resolución sigue requiriendo aprobación humana.

## Lista mínima antes de subir cambios

```bash
npm ci
npm audit --audit-level=high
npm run validate
git diff --check
```

Después de subir a `main`:

1. esperar el análisis automático nuevo de SonarQube Cloud;
2. confirmar Quality Gate verde;
3. confirmar 0 bugs, 0 vulnerabilidades y 0 hotspots;
4. revisar que no queden incidencias activas nuevas;
5. si aparece una incidencia, corregir la causa en código editable o documentar
   una excepción mínima y verificable.

Las pruebas `tests/sonarqube-quality.test.js` impiden volver a declarar una
exclusión avanzada ineficaz en `.sonarcloud.properties`, protegen la trampa de
foco que originó `javascript:S3403`, la semántica HTML nativa, los contrastes
corregidos, la separación de responsabilidades administrativas y la versión
coordinada de caché.
