# Economía del mercado predictivo vivo de Atinara

Fecha de aprobación: 1 de agosto de 2026.

Estado técnico: **activado en producción el 1 de agosto de 2026**. La migración `20260801172543_add_live_prediction_market_model.sql` fue aplicada una sola vez y no debe volver a ejecutarse. Supabase la registra en su historial remoto como `20260801184105_add_live_prediction_market_model`; esta diferencia de hora no autoriza una segunda aplicación. El frontend coordinado se publicó inicialmente en `f7aac42`.

Evidencia de activación:

- 11 mercados, 11 estados LMSR y 11 puntos históricos iniciales;
- 7 predicciones anteriores conservadas como `legacy_fixed_v1`, 5 de ellas activas en la fotografía de activación;
- 0 predicciones `lmsr_v1` tras la aceptación pública de solo lectura;
- saldos agregados de Karma y Prestigio sin cambios durante la migración;
- firma antigua de `place_prediction` eliminada y firmas nuevas disponibles;
- tablas internas sin lectura directa para `anon` o `authenticated`;
- cotización autoritativa de solo lectura válida, con contratos, precio medio, impacto, bonus y Prestigio separados;
- ninguna predicción, saldo o dato temporal creado durante la comprobación.

La validación y las pruebas autenticadas se distinguen en `STEP_LIVE_MARKET_ACTIVATION_CHECKLIST.md`. El árbol final de limpieza elimina `data.js`, corrige la exposición ficticia de métricas de invitada y usa `v=20260801-market2`. La escritura automática en GitHub devolvió `403 Resource not accessible by integration`; el commit remoto queda pendiente de publicación manual y no debe inventarse su hash.

## 1. Decisión de producto

Atinara tendrá durante la beta un precio colectivo vivo para cada mercado binario:

- `Sí` y `No` siempre suman 100 %;
- el precio cambia únicamente cuando se confirma una participación real;
- cada participación utiliza Karma y adquiere contratos de una sola opción;
- el precio medio real de entrada determina el retorno base;
- el bonus de dificultad y el Prestigio son capas propias de Atinara y se calculan por separado;
- la posición queda bloqueada hasta la resolución;
- no existen venta, salida anticipada, cambio de lado, cobertura, órdenes límite ni mercado secundario durante la beta.

La compraventa y la especulación solo se reevaluarán después de la beta, cuando el producto y la economía estén consolidados. No constituyen una función prometida.

## 2. Qué se toma de los mercados predictivos y qué no

El contrato ganador sigue el principio familiar de Polymarket y Kalshi: una unidad acertada liquida por su valor completo y una unidad fallada vale cero. Atinara no copia su infraestructura de negociación.

Durante la beta la formación de precio se realiza mediante un creador automático de mercado **LMSR** financiado con Karma ficticio, no mediante un libro de órdenes entre compradoras y vendedoras. Esta distinción debe explicarse con precisión en documentación técnica y no presentarse como «el mismo sistema exacto» de Polymarket o Kalshi.

La identidad, terminología y economía adicional son propias:

- `Predecir`, no comprar o apostar;
- Karma, no dinero;
- Prestigio y rangos como reputación;
- bonus de dificultad separado;
- una sola posición bloqueada por persona y mercado durante la beta.

## 3. Formación del precio

Cada mercado nuevo empieza en `Sí 50 % · No 50 %`. El parámetro de liquidez inicial de la beta es `b = 2000 Karma` por mercado.

Para una opción con probabilidad actual `p`, una participación de `k` Karma adquiere `q` contratos:

```text
q = b × ln((e^(k/b) − (1 − p)) / p)
p_después = 1 − (1 − p) / e^(k/b)
precio_medio = 100 × k / q
```

Si se participa en `No`, el mismo cálculo se aplica a la probabilidad de `No` y la de `Sí` queda como su complemento. El servidor limita los extremos numéricos sin permitir que una opción llegue matemáticamente a 0 o 100.

Los mercados existentes se inicializan una sola vez con su proporción real anterior de participaciones, limitada entre 1 % y 99 %. Esto evita un salto visible al activar el nuevo modelo. No se inventa una curva pasada: el histórico comienza en el momento real de la migración.

## 4. Cotización y confirmación

La interfaz solicita a Supabase una cotización autoritativa que contiene:

- precio actual de la opción;
- impacto de la participación;
- precio medio de entrada;
- precio posterior estimado;
- contratos adquiridos;
- retorno y beneficio base;
- bonus de dificultad separado;
- retorno total posible;
- Prestigio por acierto y por fallo;
- versión exacta del mercado.

La cotización no reserva el precio. Al confirmar, `place_prediction` vuelve a bloquear y comprobar mercado, perfil y estado del creador de mercado dentro de una única transacción. La operación solo continúa si la versión coincide y el precio medio no supera el máximo que la usuaria acaba de revisar. Si el mercado se movió, devuelve `PRICE_MOVED`, actualiza la cotización y exige una nueva confirmación.

Límites vigentes de beta:

- mínimo: 10 Karma;
- máximo: el menor valor entre 500 Karma y el 20 % del saldo disponible;
- una única predicción por persona y mercado;
- ninguna inserción económica directa desde el frontend.

## 5. Liquidación

Para las posiciones nuevas `lmsr_v1`:

- **acierto:** retorno base igual al número de contratos, más el bonus de dificultad guardado;
- **fallo:** retorno cero;
- **anulación:** devolución íntegra del Karma utilizado, sin cambio de Prestigio;
- **Prestigio:** cambio guardado al entrar y aplicado sin permitir saldo inferior a cero.

El antiguo límite `×10` se elimina únicamente del retorno base de las posiciones nuevas porque alteraría la correspondencia entre precio y pago. Una opción al 5 % puede superar `×10` y una opción al 1 % puede superar ampliamente ese múltiplo.

Las predicciones confirmadas antes de activar este sistema quedan marcadas como `legacy_fixed_v1` y conservan exactamente sus condiciones anteriores, incluido el límite `×10`. No se reescribe retroactivamente su contrato.

El parámetro `b = 2000`, los límites de participación y las tasas de bonus deberán someterse a simulaciones económicas y pruebas de abuso antes de abrir la beta. No deben ajustarse por intuición ni desde el cliente.

## 6. Histórico y actualización viva

- Cada confirmación guarda un punto real con hora, `Sí`, `No` y versión.
- La gráfica ofrece `1 h`, `6 h`, `24 h`, `7 d` y `Todo`.
- Supabase Realtime publica un evento anónimo `price_changed` sin identidad ni posición privada.
- El frontend vuelve a consultar el dato autoritativo y usa una comprobación cada 30 segundos como respaldo.
- Si todavía existe un solo punto, se muestra un estado honesto; no se dibuja volatilidad ficticia.
- Al cerrar o resolver un mercado, la gráfica queda congelada como registro.

## 7. Privacidad y permisos

- El precio, el histórico agregado, el Karma total participado y el número de participantes pueden ser públicos.
- El saldo de Karma, la opción elegida, los contratos y toda posición activa solo pertenecen a su usuaria autenticada.
- Las tablas internas del creador de mercado y del histórico no conceden acceso directo a `anon` ni `authenticated`; la lectura pública usa RPC con campos cerrados.
- `place_prediction` solo puede ejecutarlo `authenticated` y `resolve_market` permanece limitado a `service_role` y al flujo administrativo con confirmación humana.
- Un fallo de Broadcast no revierte una participación ya confirmada; la consulta periódica recupera el precio real.

## 8. Archivos que forman el contrato

- Migración: `supabase/migrations/20260801172543_add_live_prediction_market_model.sql`.
- Ficha, gráfica y cotización: `market-detail.js` y `styles.css`.
- Exploración: `script.js`.
- Posiciones privadas: `my-predictions.js`.
- Mapeo de RPC: `supabaseClient.js`.
- Regresión automatizada: `tests/live-market-economy.test.js`.
- Correcciones de diseño: `STEP_13_3_LIVE_MARKET_PENPOT_OVERRIDES.md`.
