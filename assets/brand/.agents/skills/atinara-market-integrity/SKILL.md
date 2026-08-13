---
name: atinara-market-integrity
description: "Usa esta habilidad para Radar, Editor, Corrector, Validador, familias, duplicados, fuentes, elegibilidad, publicación, cierre, resolución o liquidación de mercados de Atinara. No usar para infraestructura genérica sin impacto de mercado."
---

# Integridad del ciclo de mercados

Trata la corrección del mercado como integridad de dominio, no como ajuste de prompt.

## 1. Contrato canónico

Todo mercado debe definir de forma inequívoca:

- sujeto y acontecimiento;
- periodo y zona horaria;
- criterios de Sí/No u opciones completas;
- casos límite;
- funciones de cada fuente y conflictos;
- cierre, anulación y resolución.

Un mercado que no cumpla permanece privado, rechazado o en revisión honesta. No rebajes la puerta para publicarlo.

## 2. Familias y duplicados

- Distingue duplicado real de hermano por opción, fecha, umbral o sujeto común.
- Usa identidad canónica, versión y huella, no solo similitud textual.
- Reutiliza una revisión solo con equivalencia demostrada.
- Mantén agrupación visual de familias separada de la prevención de duplicados.

## 3. Flujo experto

Separa siempre:

1. adquisición de evidencia;
2. comprobaciones deterministas;
3. diagnóstico;
4. decisión de política;
5. propuesta;
6. aplicación autorizada;
7. revalidación;
8. auditoría.

El Corrector aplica una reparación general cuando sea segura y vuelve a validar. Si no puede, deja un bloqueo explícito con causa y evidencia. Nunca fabrica fuentes, rebaja requisitos ni busca otro modelo para obtener aprobación.

## 4. Elegibilidad y autoridad

- Diferencia estado del proveedor, resultado terminal directo, autoridad futura de resolución, duplicidad e incidencia técnica.
- La autoridad futura requiere contrato exacto, URL y rol de fuente correctos, opción concreta, semántica y evidencia vigente.
- Un refresh material invalida revisiones o bindings incompatibles.
- Una caída reintentable conserva el último estado válido con degradación, no un resultado terminal inventado.

## 5. Autoridad humana

La IA puede investigar, clasificar, diagnosticar y proponer. No confirma humanamente, programa, publica, resuelve ni liquida.

## 6. Regresión mínima

Incluye según el cambio:

- mercado válido;
- ambiguo o irresoluble;
- evento vencido o ya resuelto;
- hermanos que deben coexistir;
- duplicado que debe bloquearse;
- evidencia caducada o contradictoria;
- proveedor caído, timeout o respuesta inválida;
- doble clic, retry y concurrencia;
- cambio material después de confirmar;
- frontera de confirmación humana.

No declares reparado Radar → Editor → Corrector → confirmación → publicación basándote solo en mocks.
