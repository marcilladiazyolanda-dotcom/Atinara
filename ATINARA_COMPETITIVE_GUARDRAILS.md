# Atinara · Salvaguardas competitivas y revisiones futuras

**Estado:** regla vinculante para todo el proyecto  
**Aprobado por Yol:** 7 de agosto de 2026  
**Ámbito:** cualquier conversación, propuesta, diseño, implementación, migración, despliegue o revisión relacionada con Atinara.

## 1. Regla permanente

Atinara no debe copiar únicamente las funciones visibles de otros mercados de predicción. También debe aprender de sus fallos de producto, economía, seguridad, moderación, escalabilidad y operación.

Antes de recomendar, aprobar o implementar una función nueva se debe comprobar expresamente que no reproduce riesgos ya observados en proyectos competidores. Cuando exista un riesgo material, debe explicarse a Yol antes de continuar y proponerse una alternativa o una medida preventiva.

Esta comprobación se aplica aunque Yol no la solicite de forma explícita en ese chat. No es una auditoría opcional ni una fase separada: forma parte de la definición de cada tarea.

## 2. Semáforo obligatorio para propuestas

Toda propuesta relevante debe clasificarse antes de implementarse:

- **Verde:** no altera economía, privacidad, resolución o infraestructura crítica; el riesgo está acotado y dispone de pruebas razonables.
- **Ámbar:** puede ser útil, pero introduce riesgos de concurrencia, abuso, carga, moderación, dependencia externa, ambigüedad o deuda operativa. Deben definirse mitigaciones y criterios de aceptación antes de implementarla.
- **Roja:** introduce dinero real, resolución autónoma, publicación sin revisión, doble fuente de verdad, riesgo económico no simulado, exposición de datos privados o complejidad incompatible con el estado del proyecto. Se aplaza hasta cumplir condiciones previas y recibir una decisión expresa de Yol.

El análisis no puede limitarse a «se puede programar». Debe responder también a «se puede operar, explicar, probar, revertir y mantener con seguridad».

## 3. Lista de control previa a cualquier función nueva

Antes de aceptar una propuesta se revisarán, cuando procedan, estos puntos:

1. **Camino crítico:** si toca cotización, descuento de Karma, confirmación, cierre, resolución o liquidación.
2. **Atomicidad e idempotencia:** qué ocurre ante doble clic, reintento de red, solicitudes simultáneas o una respuesta tardía.
3. **Concurrencia:** si varias usuarias pueden modificar el mismo mercado o estado a la vez.
4. **Privacidad:** si podría revelar Karma, posiciones activas, relaciones privadas, identidad administrativa o datos internos.
5. **Resolubilidad:** si la pregunta, fecha, opciones, criterios y fuentes permiten una resolución objetiva.
6. **Abuso y manipulación:** spam, multicuentas, coordinación, copia de posiciones, inflación de Prestigio o manipulación de rankings.
7. **Carga y escalabilidad:** consultas repetidas, procesos O(n), tareas pesadas, tiempo real, límites de proveedores y picos en mercados populares.
8. **Dependencias externas:** caída, latencia, cambio de API, duplicados, datos desactualizados, costes y límites de uso.
9. **Operación manual:** si exige una acción humana oculta, debe aparecer en un panel, con estado, fecha, responsable y alerta.
10. **Observabilidad:** métricas, logs, alertas y mensajes comprensibles para detectar y diagnosticar fallos.
11. **Fallback y recuperación:** comportamiento ante error, forma de reintentar, rollback y restauración.
12. **Fuente de verdad:** Supabase continúa siendo autoritativo; cachés, índices y modelos de lectura deben ser derivados y reconstruibles.
13. **Alcance:** si la función mejora el bucle central de predecir, resolver, aprender y competir o solo añade ornamentación y deuda.
14. **Evidencia:** qué prueba demostrará que la función funciona, no daña las invariantes y merece mantenerse.
15. **Compatibilidad:** no romper contratos `legacy_fixed_v1`, LMSR, GitHub Pages, RLS, perfiles, comunidad ni datos existentes.

## 4. Errores de competidores que Atinara debe evitar

### 4.1 Procesos pesados bloqueando funciones críticas

- Separar Radar, IA, sincronizaciones, recomendaciones, rankings pesados y tareas de mantenimiento del camino crítico económico.
- Establecer timeout, límites, colas o ejecución diferida cuando corresponda.
- Ninguna caída de Gemini, Tavily, Polymarket, Kalshi u otra fuente debe impedir predecir, consultar mercados propios o resolver manualmente.
- Añadir alertas por ausencia de ejecuciones críticas, no solo por errores emitidos.

### 4.2 Conflictos de base de datos tratados como errores genéricos

- Operaciones económicas atómicas en servidor.
- Identificador idempotente para mutaciones críticas cuando sea necesario.
- Errores tipados y mensajes seguros.
- Reintentos limitados con espera y jitter para conflictos transitorios.
- Nunca devolver stacks, rutas, SQL o secretos al navegador.
- Distinguir «no aplicado, puedes reintentar» de «estado desconocido, requiere comprobación».

### 4.3 Señales duplicadas inflando rankings o puntuaciones

- Deduplicar por evento, entidad, fecha, fuente y similitud semántica.
- Agrupar mercados hijos bajo su evento padre.
- Limitar cuánto puede aportar una misma señal o clúster.
- Penalizar señales genéricas y caducadas.
- Mostrar un desglose comprensible del score del Radar.
- No confundir popularidad externa con calidad predictiva.

### 4.4 Creación pública de mercados demasiado pronto

- Durante la beta, las usuarias pueden sugerir ideas, pero no publicar directamente.
- Toda propuesta pasa por revisión semántica, resolubilidad y confirmación humana.
- Los cambios esenciales obligan a repetir la revisión.
- Si en el futuro se abre la creación, debe existir reputación mínima, límites, moderación, auditoría y una política anti-spam diseñada antes de activarla.

### 4.5 Declarar funciones listas sin pruebas realistas

- No usar «listo para producción» sin criterios medibles.
- Probar casos normales, límites, concurrencia, recuperación y compatibilidad.
- Documentar el tamaño máximo probado y no extrapolarlo sin evidencia.
- Cualquier función económica nueva necesita simulación e invariantes.

### 4.6 Añadir dinero real, wallets o blockchain antes de tiempo

- Atinara mantiene Karma ficticio y no incorpora dinero real durante la beta.
- No añadir wallets, tokens, blockchain, KYC, depósitos, retiros ni CLOB sin una fase futura específica, estudio legal, auditoría de seguridad y aprobación expresa de Yol.
- Ninguna función debe presentar Karma como dinero, inversión o activo canjeable.

### 4.7 Automatizaciones con pasos manuales ocultos

- Cada intervención manual pendiente debe figurar en administración.
- Mostrar última ejecución, próximo intento, estado, error y acción recomendada.
- Añadir alerta cuando un mercado cierre sin resolución, una fuente deje de actualizarse o una publicación programada no se ejecute.

### 4.8 Amplitud de funciones sin coherencia de producto

- Priorizar el bucle: descubrir mercado, comprenderlo, predecir, esperar, resolver, aprender y competir.
- Toda función debe justificar qué métrica o problema mejora.
- No añadir varias capas complejas simultáneamente.
- Avatares, efectos, minijuegos y monetización no deben desplazar la claridad predictiva.

### 4.9 Medir solo aciertos o beneficio

- Separar precisión, calibración, beneficio, Prestigio, actividad y dificultad.
- No presentar una muestra pequeña como habilidad consolidada.
- Incorporar en el futuro probabilidad personal privada, Brier score o métrica equivalente, curva de calibración y tamaño de muestra.

### 4.10 Dependencia de una sola mantenedora

- Mantener `AGENTS.md`, contexto de proyecto, runbooks y registros de activación actualizados.
- Documentar despliegue, restauración, rotación de secretos e incidentes.
- Ensayar restauraciones y conservar copias verificables.
- Evitar operaciones que solo puedan repetirse recordando un chat antiguo.

### 4.11 Dos fuentes de verdad

- Supabase es la fuente autoritativa de mercados, economía, perfiles y resoluciones.
- El frontend no inventa ni corrige datos autoritativos.
- Cachés y tablas derivadas deben tener versión, caducidad, trazabilidad y posibilidad de reconstrucción.
- Las probabilidades externas nunca sustituyen el precio propio de Atinara.

### 4.12 Deriva hacia casino o especulación

- Mantener una estética de criterio, análisis y competición social.
- Evitar lenguaje de apuesta, dinero fácil, jackpot, inversión o ganancias reales.
- El Prestigio representa trayectoria predictiva, no gasto ni riqueza.

## 5. Roadmap de revisiones futuras

Estos bloques deben recordarse a Yol cuando el proyecto alcance el momento adecuado, aunque la conversación se produzca en otro chat del proyecto.

### Bloque A · Antes de aumentar tráfico o realizar una beta amplia

1. **Calibración predictiva**
   - Probabilidad personal privada.
   - Brier score, log score u otra métrica justificada.
   - Curva de calibración.
   - Muestra mínima e intervalos de incertidumbre.
   - Separación entre calibración, precisión, beneficio y Prestigio.

2. **Pruebas autenticadas de extremo a extremo**
   - Cotización y confirmación reales.
   - Cotización caducada y recotización.
   - Doble clic y repetición de solicitud.
   - Dos o más usuarias actuando simultáneamente.
   - Cierre, resolución, anulación y liquidación.
   - Protección de paneles y datos privados.

3. **Pruebas de carga y concurrencia**
   - Cotizaciones por segundo.
   - Confirmaciones simultáneas.
   - Mercado especialmente activo.
   - Supabase Realtime y polling de respaldo.
   - Ranking y perfiles.
   - Resolución con muchas posiciones.
   - Radar e IA ejecutándose en paralelo sin afectar al núcleo.

4. **Idempotencia formal**
   - Claves de operación para mutaciones críticas.
   - Una repetición de red nunca descuenta Karma dos veces.
   - Una resolución nunca se liquida dos veces.
   - Estados finales comprobables después de timeout.

5. **Máquina de estados explícita**
   - `draft`
   - `under_review`
   - `scheduled`
   - `open`
   - `closed`
   - `resolving`
   - `resolved`
   - `annulled`
   - Transiciones autorizadas, auditadas y probadas.

6. **Aislamiento operativo**
   - Separar economía y resolución de Radar, IA, sincronización y analítica pesada.
   - Fallo cerrado donde afecte a publicación o resolución.
   - Degradación segura donde la creación manual pueda continuar.

7. **Endurecimiento continuo del Radar**
   - Deduplicación semántica.
   - Agrupación por evento.
   - Penalización de generalidad y caducidad.
   - Diversidad y calidad de fuentes.
   - Score explicable.
   - Comprobación de que la oportunidad sigue abierta antes de preparar.

8. **Copias, restauración y continuidad**
   - Backups documentados.
   - Ensayo real de restauración.
   - Runbook para pausar participaciones sin cerrar la web.
   - Registro de versiones y activaciones.

### Bloque B · Durante la beta y con datos reales

- Sugerencias de mercados por usuarias, siempre moderadas.
- Exportación pública de mercados resueltos.
- API pública de solo lectura para resultados y perfiles.
- Simulación y evaluación de diferentes valores de liquidez `b`.
- Medidas anti-multicuenta y anti-manipulación de Prestigio.
- Panel de retención y salud del catálogo.
- Alertas por mercados cerrados sin resolver.
- Historial de cambios de probabilidad personal.
- Medición de D1, D7, D30, participantes por mercado, retorno tras resolución, anulaciones y tiempo de resolución.

### Bloque C · Solo después de demostrar retención y estabilidad

- Mercados con múltiples resultados.
- Ligas o competiciones privadas.
- Salida anticipada controlada.
- Venta o mercado secundario.
- Internacionalización.
- Aplicaciones móviles o clientes externos.

Cada función de este bloque requiere una revisión económica, de concurrencia, abuso y operación independiente. La existencia de esa función en un competidor no constituye justificación suficiente.

## 6. Funciones aplazadas por defecto

No deben incorporarse durante la beta salvo nueva decisión expresa, condiciones previas y revisión específica:

- Dinero real.
- Compra o conversión monetaria de Karma.
- Wallets.
- Tokens o blockchain.
- CLOB o libro de órdenes.
- KYC.
- Resolución autónoma por IA.
- Publicación pública directa por usuarias.
- Gobernanza descentralizada.
- Entrenador IA permanente.
- Minijuegos de azar o mecánicas de casino.

## 7. Recordatorios que deben activarse automáticamente

- **Antes de anunciar o abrir una beta amplia:** recordar el Bloque A y comprobar su estado.
- **Antes de campañas, foros o captación significativa:** exigir carga, concurrencia, observabilidad y recuperación.
- **Antes de permitir sugerencias o creación de mercados:** revisar moderación, spam, resolubilidad y límites.
- **Antes de incorporar una API o agente nuevo:** revisar aislamiento, duplicados, caducidad, límites, coste, fallback y privacidad.
- **Antes de cambiar LMSR, `b`, bonus o Prestigio:** simular escenarios, comprobar invariantes y compatibilidad histórica.
- **Antes de permitir salida, venta o cambio de lado:** revisar liquidez, manipulación, front-running, concurrencia, contabilidad e idempotencia.
- **Antes de mercados multirresultado:** revisar modelo económico, resolución, UI y agrupación de opciones.
- **Antes de ligas privadas o temporadas activas:** comprobar retención, masa crítica, abuso y privacidad.
- **Antes de dinero real o Web3:** detener el roadmap ordinario y abrir una fase legal, financiera y de seguridad separada.
- **Después de un incidente de un competidor que resulte aplicable:** añadir la nueva lección y revisar Atinara.

## 8. Forma de comunicar riesgos a Yol

Cuando Yol proponga una función:

1. Explicar primero su utilidad real.
2. Indicar el semáforo de riesgo.
3. Señalar paralelismos con fallos conocidos, si existen.
4. Describir las medidas necesarias para hacerla segura.
5. Separar lo imprescindible para la beta de lo que puede esperar.
6. No bloquear por prudencia genérica: concretar el riesgo, la evidencia y la solución.
7. No aprobar por entusiasmo una función que todavía no puede probarse u operarse correctamente.

## 9. Criterio de éxito

Atinara no necesita superar a todos los competidores por cantidad de funciones. Debe ser mejor en su nicho mediante:

- mercados claros y resolubles;
- economía honesta;
- privacidad de posiciones activas;
- reputación verificable;
- resolución humana con fuentes;
- experiencia social comprensible;
- operación fiable;
- medición real de habilidad predictiva;
- crecimiento sin convertir la plataforma en un casino o un sistema financiero prematuro.

Este documento debe mantenerse actualizado cuando una nueva decisión, incidente o aprendizaje competitivo cambie los riesgos del proyecto.
