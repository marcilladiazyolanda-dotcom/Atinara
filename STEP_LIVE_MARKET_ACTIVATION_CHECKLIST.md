# Activación coordinada · mercado predictivo vivo

Fecha de preparación: 1 de agosto de 2026.

Estado: **pendiente de autorización y ejecución manual**. Preparar el código no modifica producción. No ejecutar esta checklist hasta que Yol quiera coordinar Supabase y la publicación completa del frontend.

## 1. Por qué debe coordinarse

La migración cambia la firma de `place_prediction` y el frontend nuevo depende de RPC y campos que todavía no existen en producción. Por tanto:

- no se debe publicar primero el frontend nuevo;
- no se debe aplicar la migración y dejar durante horas el frontend anterior;
- la ventana entre SQL y frontend debe ser mínima y controlada;
- si no se puede completar la segunda parte, se detiene la apertura de nuevas predicciones y se informa del bloqueo; no se improvisan contratos mixtos.

La migración es transaccional: o termina completa o Supabase revierte sus cambios. Esto no sustituye un plan de coordinación de la interfaz.

## 2. Evidencia ya obtenida sin modificar producción

- Se auditó la firma viva de `place_prediction`, `resolve_market`, las RPC públicas, permisos, RLS y columnas afectadas.
- Se comprobó que existen predicciones activas anteriores y que deben conservar sus condiciones.
- La migración completa se ejecutó dentro de una transacción sobre el esquema vivo.
- En esa transacción se probó cotización, compra, cambio de precio, histórico y liquidación nueva superior a `×10`.
- La transacción terminó con `ROLLBACK` y una lectura posterior confirmó que no quedaron tablas, puntos, predicciones ni saldos de prueba.
- `npm run validate` supera sintaxis, pruebas unitarias y tipado.

## 3. Antes de activar

- [ ] Confirmar que la rama y el ZIP corresponden al mismo commit validado.
- [ ] Confirmar que ningún mercado se está resolviendo o recibiendo una participación durante la ventana.
- [ ] Registrar el número de mercados, predicciones totales, activas y saldos de las cuentas de aceptación sin copiar datos sensibles a documentación pública.
- [ ] Revisar los asesores de seguridad y rendimiento de Supabase inmediatamente antes del cambio.
- [ ] Preparar una cuenta normal de aceptación con al menos 50 Karma y un mercado abierto inequívoco que pueda anularse después de la prueba.
- [ ] Acordar quién ejecuta el SQL y quién sube el ZIP completo, con ambas superficies abiertas antes de empezar.

## 4. Orden de activación

1. Ejecutar una sola vez `supabase/migrations/20260801172543_add_live_prediction_market_model.sql` en Supabase SQL Editor.
2. Comprobar que termina sin error y que existen las RPC nuevas.
3. Publicar inmediatamente el ZIP completo del mismo commit en `main`; no subir solo archivos sueltos.
4. Esperar a que GitHub Pages termine y recargar con `Ctrl+F5`.
5. Confirmar que todos los HTML cargan `v=20260801-market1`.
6. No aceptar nuevas predicciones si la ficha no muestra cotización autoritativa y precio vivo.

## 5. Consultas de comprobación tras el SQL

Ejecutar como lectura administrativa y revisar los valores; no copiar identificadores personales a capturas públicas:

```sql
select
  (select count(*) from public.markets) as markets,
  (select count(*) from public.market_maker_state) as maker_states,
  (select count(*) from public.market_price_history) as initial_history_points,
  (select count(*) from public.predictions where pricing_model = 'legacy_fixed_v1') as legacy_predictions,
  (select count(*) from public.predictions where pricing_model = 'lmsr_v1') as live_predictions;
```

Criterios inmediatos:

- `markets = maker_states = initial_history_points` justo después de la migración;
- todas las predicciones anteriores son `legacy_fixed_v1`;
- ninguna posición anterior cambia de Karma, estado o liquidación;
- las tablas privadas no son legibles directamente por `anon` o `authenticated`;
- las RPC públicas no devuelven identidad de posiciones activas.

## 6. Aceptación funcional posterior

- [ ] Como invitada, abrir portada y ficha: datos reales o error honesto, nunca catálogo simulado.
- [ ] Ver `Sí + No = 100 %` y un histórico que empieza en la fecha real de activación.
- [ ] Cambiar entre `1 h`, `6 h`, `24 h`, `7 d` y `Todo`.
- [ ] Como usuaria, solicitar cotización de `Sí` y `No` y comprobar impacto, precio medio, contratos, retorno base, bonus y Prestigio.
- [ ] Confirmar una participación y comprobar descuento atómico, punto nuevo y actualización en otra pestaña.
- [ ] Intentar confirmar con una cotización antigua y comprobar `PRICE_MOVED` y recotización, sin descuento.
- [ ] Comprobar límites de 10 Karma, 20 % del saldo y 500 Karma.
- [ ] Comprobar que no hay venta, salida, cambio de lado o segunda posición.
- [ ] Comprobar «Mis predicciones»: entrada, precio actual, diferencia y privacidad.
- [ ] Anular el mercado de aceptación mediante el flujo humano y confirmar devolución íntegra y Prestigio sin cambios.
- [ ] En un entorno controlado separado, probar acierto y fallo tanto de una posición nueva como de una heredada.
- [ ] Ejecutar Checkly, revisar consola, Sentry, SonarQube y GitGuardian.
- [ ] Ejecutar de nuevo `npm run validate` y `git diff --check` sobre la versión publicada.

## 7. Condición de cierre

No marcar este bloque como activado hasta que Yol confirme la aceptación visual y económica. Si una comprobación económica falla, se bloquean nuevas participaciones y se conserva la evidencia; no se corrigen saldos manualmente sin un plan SQL auditado.

