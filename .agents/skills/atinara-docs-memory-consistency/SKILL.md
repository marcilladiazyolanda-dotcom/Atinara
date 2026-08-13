---
name: atinara-docs-memory-consistency
description: "Usa esta habilidad al crear, mover o actualizar documentación, README, runbooks, memoria de proyecto, manifiestos o rutas canónicas de Atinara. También cuando código, producción y documentación discrepen."
---

# Coherencia documental y memoria de Atinara

## 1. Fuente del hecho

- Estado persistente y despliegues: verifica Supabase y producción.
- Código vigente: usa `origin/main` y el commit exacto.
- Estrategia: usa `ATINARA_PRODUCT_STRATEGY.md` salvo cambio expreso de Yol.
- Historial técnico: usa `ORAKLO_PROJECT_CONTEXT.md`, sin convertirlo en autoridad sobre un sistema que pueda verificarse.

Separa hecho verificado, inferencia, investigación externa y recomendación.

## 2. Ruta canónica

Antes de crear un documento:

- busca versiones existentes y enlaces entrantes;
- elige una única ruta canónica;
- evita copias simultáneas en raíz y `docs/`;
- actualiza referencias relativas;
- enumera archivos obsoletos para eliminación.

No mantengas dos documentos que afirmen estados incompatibles.

## 3. Actualización mínima

- Actualiza `ORAKLO_PROJECT_CONTEXT.md` solo ante cambio material del estado.
- Modifica `ATINARA_PRODUCT_STRATEGY.md` únicamente si Yol cambia estrategia.
- No reescribas auditorías históricas cerradas como si fueran estado actual.
- Conserva identificadores `Oraklo` solo cuando sean históricos o técnicamente necesarios.

## 4. Repositorio público

No publiques secretos, credenciales, vulnerabilidades sin corregir, límites económicos internos, adjudicaciones de proveedor, corpus privado ni estrategia B2B sensible.

## 5. Verificación

Comprueba enlaces, rutas, títulos, fechas, versiones, hashes y coherencia con el código. En una entrega manual, confirma que los archivos aterrizarán en la ruta pretendida y no en la raíz por pérdida de carpetas.
