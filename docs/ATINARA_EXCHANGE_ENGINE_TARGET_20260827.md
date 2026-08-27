# Atinara Exchange Engine · arquitectura objetivo B2B

**Estado:** decisión de producto aprobada por Yol el 27 de agosto de 2026.
**Ámbito:** target de Atinara Engine para el vertical Audience/B2B2C.
**No implica que esté implementado ni autoriza despliegue, SQL productivo o dinero real.**

## 1. Por qué cambia el motor

El LMSR fue introducido en Atinara Social para evitar una UX extrema/inestable con poco volumen y ofrecer precio continuo. Ese problema era real, pero la solución no debe convertirse en una restricción permanente de Atinara Engine.

El producto B2B objetivo debe comportarse como un **exchange de contratos de predicción**: las personas pueden entrar y salir de posiciones, comprar/vender a precios descubiertos por el mercado y ver liquidez real. El LMSR se conserva únicamente para posiciones/mercados históricos mientras exista dependencia.

## 2. Qué significa “lógica Polymarket/Kalshi”

No significa copiar blockchain, dinero, custody, regulación ni UI. Significa adoptar los principios funcionales comunes:

- Central Limit Order Book (CLOB);
- peer-to-peer matching/maker-taker;
- bid/ask/spread/depth;
- precios derivados de órdenes/fills;
- limit orders y órdenes ejecutables inmediatamente;
- partial fills;
- cancelación/expiración;
- posiciones negociables;
- salida antes de resolución;
- settlement final del contrato ganador;
- market makers/liquidity providers para mantener profundidad.

Polymarket documenta CLOB, buy/sell, partial fills y salida antes de resolución. Kalshi documenta orderbook, quick/limit orders, buy/sell y market makers.

Fuentes externas verificadas 27/08/2026:

- https://docs.polymarket.com/concepts/prices-orderbook
- https://docs.polymarket.com/concepts/positions-tokens
- https://docs.polymarket.com/concepts/order-lifecycle
- https://docs.polymarket.com/market-makers/overview
- https://help.kalshi.com/en/articles/13823828-the-orderbook
- https://help.kalshi.com/en/articles/13823808-who-are-you-trading-with
- https://help.kalshi.com/en/articles/13823819-how-to-become-a-market-maker-on-kalshi
- https://docs.kalshi.com/api-reference/orders/create-order-v2

## 3. Invariantes del matching engine

El matching engine debe ser autoritativo, determinista y aislado de la UI.

### Órdenes

Campos conceptuales mínimos:

- `tenant_id`;
- `market_id` / `outcome_id`;
- `account_id`;
- `side` (`buy`/`sell` o exposición normalizada);
- `price`;
- `quantity`;
- `remaining_quantity`;
- `time_in_force`;
- `status`;
- `created_at`;
- `sequence`;
- `idempotency_key`;
- versión de contrato/economía.

### Matching

- mejor precio primero;
- a igualdad de precio, prioridad temporal/sequence;
- fills parciales permitidos;
- una orden no puede ejecutar contra sí misma cuando self-trade prevention lo prohíba;
- matching y ledger se confirman atómicamente;
- un retry no duplica fill;
- cancel/replace respeta el estado ya ejecutado;
- no existe precio “estimado” que se guarde como trade sin contraparte/fill.

### Time in force objetivo

- `GTC`;
- `IOC/FAK`;
- `FOK`;
- `GTD`;
- `post_only` cuando se habilite para makers.

El primer cutover puede exponer un subconjunto de UX, pero el contrato del dominio no debe impedir los restantes.

## 4. Posiciones y salida

La posición deja de ser “una predicción única bloqueada”. El modelo debe soportar:

- múltiples fills sobre el mismo outcome;
- coste medio/price basis;
- aumentar posición;
- reducir parcialmente;
- cerrar completamente;
- órdenes abiertas independientes de la posición ejecutada;
- resultado realizado/no realizado expresado **solo en Karma ficticio**;
- settlement de inventario restante al resolver.

La salida no está garantizada: requiere liquidez. La UI debe mostrar spread/depth y no prometer una venta si el libro no puede ejecutarla.

## 5. Karma, ledger y colateral

Karma no es dinero. Aun así, el ledger debe tener calidad financiera para no corromper saldos.

- usar fixed-point/integer minor units o Postgres `numeric`, nunca floats;
- separar `available`, `reserved`, `position/inventory`;
- una orden buy resting reserva capacidad suficiente;
- una orden sell reserva el inventario necesario;
- cancelar libera solo el remanente no ejecutado;
- fill mueve reservas/inventario de forma atómica;
- no permitir double-spend entre pestañas/retries/órdenes concurrentes;
- ledger reconciliable con órdenes, fills y posiciones;
- settlement/cancelación idempotentes;
- auditoría de actor, tenant, versión y motivo.

La unidad de contrato y payout exactos se deben especificar antes de la migración E1. No hardcodear escalas de dinero real.

## 6. Liquidez bootstrap

### Problema

Un CLOB con pocos participantes puede quedar vacío, con spreads enormes o sin posibilidad de salida. Es el mismo problema de fondo que motivó LMSR.

### Solución objetivo

Atinara incorpora un **Virtual Liquidity Provider (VLP)** administrado/gestionado:

- publica limit orders en el mismo CLOB;
- usa Karma e inventario ficticios;
- queda identificado como maker técnico/gestionado en auditoría;
- no altera el matching engine;
- no rellena histórico sin fills;
- no conoce ni usa la resolución futura;
- configura fair/reference price inicial, spread, depth, inventory skew, max exposure y cooldown con políticas versionadas;
- circuit breaker para mercados crossed, inventario fuera de límites o anomalías;
- puede apagarse por tenant/mercado;
- no recibe privilegios de price priority.

La fuente del precio de referencia inicial debe ser explícita: 50/50, forecast editorial aprobado, mercado externo verificable o política del cliente. No debe mezclarse una opinión de IA no aprobada con pricing autoritativo.

## 7. Multi-outcome

### 7.1 Binary

Caso especial de dos outcomes complementarios. Puede optimizarse con relaciones de complemento, pero dichas optimizaciones no deben filtrarse a todo el dominio.

### 7.2 Categorical single winner

Para “¿Quién ganará X?” o “¿Cuál de estas opciones ocurrirá?” cuando exactamente una sea correcta.

Requisitos:

- `event_id` común;
- N outcomes versionados;
- exclusividad explícita;
- exhaustividad explícita;
- `Other/None` si hace falta completar el espacio de resultados;
- winner único;
- resolución atómica de todo el conjunto;
- impedir estados donde dos outcomes queden ganadores;
- pricing/visualización coherentes a nivel de evento;
- colateral/netting diseñados de forma consistente.

### 7.3 Binary family

Para thresholds, strikes, ventanas temporales o afirmaciones relacionadas que pueden coexistir. Ejemplo: “superará 10”, “superará 20”, “superará 30” no siempre debe modelarse como un único outcome categórico.

La agrupación es de UX/domain family, no una mentira lógica.

### 7.4 Referencia Polymarket/Kalshi

Polymarket documenta cada unidad tradable como mercado binario y agrupa múltiples mercados bajo un evento. Kalshi usa jerarquía Series → Event → Market y contratos binarios/strikes. Atinara puede ofrecer una UX multiopción superior siempre que conserve la semántica correcta y no fuerce todos los casos a una sola representación física.

Fuentes:

- https://docs.polymarket.com/concepts/markets-events
- https://docs.polymarket.com/market-data/overview
- https://docs.kalshi.com/getting_started/terms
- https://help.kalshi.com/en/articles/13823816-collateral-return

## 8. Resolución y lifecycle

El nuevo trading no reduce las exigencias actuales de integridad. Cada outcome/event debe conservar:

- pregunta/subject;
- temporalidad y timezone;
- criterios;
- edge cases;
- fuentes/authority;
- cierre;
- suspensión;
- cancelación;
- resolución;
- evidencia;
- actor/version/fingerprint.

Lifecycle target:

`draft → review → approved → scheduled/open → suspended? → closed → resolving → resolved|cancelled`

Trading y settlement deben respetar exactamente la versión aprobada del contrato. Un cambio material invalida aprobación y puede requerir cancelar/recrear según política; nunca se modifica silenciosamente un contrato con órdenes/posiciones vivas.

## 9. Transición desde producción actual

Estado actual:

- `legacy_fixed_v1` existe;
- `lmsr_v1` existe y está activado en producción;
- no existe todavía CLOB productivo de Atinara.

Reglas:

1. No editar migraciones aplicadas.
2. No convertir posiciones antiguas a CLOB por backfill destructivo.
3. Introducir `orderbook_v1` aditivamente.
4. Mantener adapters/settlement legacy.
5. Nuevos mercados demo E1 usan el motor nuevo.
6. Cutover de Atinara Social solo tras pruebas y autorización.
7. Eliminar código legacy únicamente cuando no existan posiciones, mercados ni consumidores dependientes y exista recuperación documentada.

## 10. Pruebas mínimas E1

### Matching
- price priority;
- time priority;
- partial fill;
- multi-level fill;
- IOC/FOK/GTC;
- cancel/replace;
- self-trade prevention;
- stale/double submit;
- concurrencia sobre saldo e inventario.

### Ledger
- reserve/release exactos;
- no saldo negativo;
- no double-spend;
- reconciliación orders/fills/positions/ledger;
- rollback transaccional.

### Trading lifecycle
- buy → sell parcial → sell total;
- entrar en varios precios;
- orden resting tras recarga;
- cierre bloquea órdenes nuevas;
- resolución liquida inventario restante;
- cancelación devuelve lo exigido por contrato.

### Multi-outcome
- binary;
- 3+ outcomes;
- winner único;
- Other/None;
- family no exclusiva;
- no contradicción entre resolución del evento y outcomes;
- UI desktop/móvil.

### Seguridad/B2B
- cross-tenant orders/positions denegadas;
- RBAC;
- RLS;
- admin no implícito por `authenticated`;
- idempotency keys tenant-bound;
- logs sin PII/secrets.

## 11. Lo que NO autoriza esta decisión

- depósitos o retiradas;
- euros/USDC/crypto;
- wallets;
- KYC/AML monetario;
- market making con dinero real;
- conexión de liquidez externa monetaria;
- promesas de rentabilidad;
- saltarse R1.

Esta especificación mejora el **modelo de producto**, no cambia el estatus ficticio del Karma.
