---
name: atinara-incident-diagnostics
description: "Usa esta habilidad cuando Yol reporte un fallo, bloqueo, error de producción, prueba rota, comportamiento intermitente o proveedor caído en Atinara. No usar para una función nueva sin incidencia previa."
---

# Diagnóstico de incidencias de Atinara

## 1. Conserva la evidencia

- Registra mensaje visible, ruta, actor, hora, input seguro, estado previo y resultado.
- Inspecciona logs sin copiar secretos, PII, prompts completos ni respuestas crudas innecesarias.
- No repitas una operación persistente hasta entender su idempotencia.

## 2. Traza la ruta real

Sigue el flujo completo que corresponda:

`UI → Auth → RPC/Edge → RLS/dominio → proveedor → persistencia → UI`

Comprueba también caché, versión de recursos, flags, settings privados, deadline, concurrencia y último estado válido.

## 3. Clasifica correctamente

Distingue explícitamente:

- error técnico frente a rechazo o aprobación de dominio;
- caída de proveedor frente a ausencia factual;
- bloqueo de seguridad frente a bug funcional;
- estado visual frente a estado autoritativo;
- dato obsoleto frente a dato corrupto;
- fallo reproducible frente a evidencia insuficiente.

Nunca conviertas timeout, 429, 5xx, JSON inválido o secreto ausente en veredicto factual.

## 4. Prueba hipótesis

- Formula pocas hipótesis ordenadas por evidencia.
- Busca controles compartidos y rutas hermanas.
- Reproduce con la ruta real o una transacción segura. Los mocks solo apoyan.
- Si producción es necesaria, prioriza lectura, logs o `BEGIN/ROLLBACK`.

## 5. Repara y vuelve a recorrer

Aplica la corrección general más pequeña que resuelva la causa. Repite el flujo de extremo a extremo, los casos negativos y el estado tras recarga o reintento. Si queda un bloqueo material, descríbelo con evidencia y no lo presentes como cierre.
