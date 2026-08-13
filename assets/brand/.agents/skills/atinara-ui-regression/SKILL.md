---
name: atinara-ui-regression
description: "Usa esta habilidad para HTML, CSS o JavaScript de interfaz de Atinara: móvil, responsive, accesibilidad, temas, navegación, formularios, modales, estados de carga/error o regresiones visuales. No usar para backend sin impacto visible."
---

# Regresión de interfaz de Atinara

## 1. Superficies compartidas

Localiza todas las páginas que reutilizan el CSS, JavaScript, cabecera, modal, tarjeta, formulario o estado afectado. Incluye superficies públicas y administrativas cuando compartan componentes.

## 2. Estados reales

Valida cuando aplique:

- carga;
- vacío honesto;
- éxito;
- error recuperable y reintento;
- autenticada/no autenticada;
- mercado abierto, cerrado, pendiente y resuelto;
- claro/oscuro;
- proveedor degradado.

No inventes usuarias, actividad, mercados o métricas para rellenar la pantalla.

## 3. Responsive y accesibilidad

Comprueba móvil, tableta y escritorio representativos:

- sin scroll horizontal accidental;
- texto legible y contraste suficiente;
- targets táctiles y separación;
- foco visible;
- nombres accesibles y semántica;
- teclado completo;
- modales con foco, cierre y retorno correctos;
- wrapping de títulos, URLs y contenido largo;
- zoom o ampliación de texto cuando sea relevante.

## 4. Comportamiento

Recorre la interacción real. En formularios y administración comprueba lock de carga, doble clic, retry, mensajes, respuesta server-authoritative y estado tras recargar.

## 5. Caché

Cuando cambien recursos estáticos, actualiza el versionado siguiendo la convención vigente para evitar mezclar frontend viejo y nuevo en GitHub Pages.

## 6. Evidencia

Usa Playwright, Checkly o automatización disponible. Indica rutas, viewports, estados y limitaciones. Una captura bonita sin recorrido funcional no demuestra ausencia de regresión.
