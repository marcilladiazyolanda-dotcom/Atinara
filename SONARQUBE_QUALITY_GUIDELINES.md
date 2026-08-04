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

Las migraciones aplicadas no se reescriben. `.sonarcloud.properties` ignora
exclusivamente `plsql:S1192` dentro de `supabase/migrations/**`. Los archivos
siguen analizándose para cualquier otra regla de seguridad, fiabilidad o calidad.

Nunca se debe:

- excluir toda la carpeta de migraciones;
- desactivar una regla para todo el proyecto;
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

Las pruebas `tests/sonarqube-quality.test.js` protegen la exclusión mínima de
migraciones, la semántica HTML nativa, los contrastes corregidos, la separación
de responsabilidades administrativas y la versión coordinada de caché.
