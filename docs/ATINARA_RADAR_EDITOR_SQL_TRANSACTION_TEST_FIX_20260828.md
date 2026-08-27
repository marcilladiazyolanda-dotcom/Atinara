# Atinara · corrección del test SQL transaccional del puente Editor

Fecha: 2026-08-28  
Base: `81086eac63ceb1403f7054469837e93e27b47112`

## Incidencia

La validación preproductiva con PostgreSQL real detectó que
`market_expert_editor_bridge_contract_v1_transaction.sql` cualificaba la forma
especial `position(subcadena in texto)` como `pg_catalog.position(...)`. Esa
combinación no es sintaxis PostgreSQL válida y detenía el test antes de evaluar
la migración.

La migración
`20260827234500_fix_market_expert_editor_bridge_contract_v1.sql` compiló por
separado dentro de una transacción revertida y no contiene este defecto.

## Corrección

Las cuatro comprobaciones de contenido de la definición usan ahora
`pg_catalog.strpos(texto, subcadena)`. No cambia la función productiva, su
firma, ACL, writer, gates, idempotencia ni comportamiento.

## Evidencia

La migración y el test corregido se ejecutaron juntos sobre PostgreSQL 17 de
producción dentro de una única transacción finalizada con `ROLLBACK`. Todas las
aserciones de dependencia, writer vigente y privilegios pasaron. No se aplicó
la migración, no se desplegó ninguna Edge y no se modificaron datos.

Después de integrar esta entrega deben volver a verificarse las tres Actions
del nuevo `origin/main`. Solo entonces puede retomarse el checkpoint productivo
del cierre Radar/Editor.
