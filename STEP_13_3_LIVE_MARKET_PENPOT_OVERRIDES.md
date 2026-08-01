# Paso 13.3 · Correcciones vinculantes para Penpot · mercado vivo

Fecha de aprobación: 1 de agosto de 2026.

Estado: **decisión de producto vinculante para la Fase B visual**. Este documento debe leerse después de `STEP_13_2_PRIORITIES_ACCEPTANCE.md` y `LIVE_MARKET_ECONOMY.md`.

## 1. Autoridad frente al primer prompt

El primer prompt enviado a Codex para la «Fase A · Arquitectura neutral» fue correcto para preparar páginas e inventarios sin decidir arte. Sin embargo, se redactó antes de aprobar el mercado predictivo vivo y contiene descripciones que ya no bastan o pueden inducir a diseñar el funcionamiento anterior.

**Ante cualquier diferencia, este documento y `LIVE_MARKET_ECONOMY.md` sustituyen al primer prompt, a las capturas del frontend antiguo y a cualquier mención anterior al porcentaje por recuento o al límite general `×10`.**

El segundo prompt de Penpot deberá nombrar expresamente ambos archivos y ordenar a Codex que corrija los marcos neutrales ya creados antes de aplicar el estilo definitivo.

## 2. Correcciones que el segundo prompt debe declarar

| Instrucción o supuesto anterior | Corrección obligatoria |
| --- | --- |
| Porcentajes calculados contando personas o votos | `Sí` y `No` son precios vivos LMSR movidos por el Karma confirmado. El recuento de participantes es una métrica distinta. |
| Una simple «tendencia» o barra estática | Gráfica temporal real y protagonista, con valores actuales y rangos `1 h`, `6 h`, `24 h`, `7 d` y `Todo`. |
| Retorno base limitado siempre a `×10` | El límite desaparece para posiciones nuevas `lmsr_v1`; solo se conserva para contratos anteriores `legacy_fixed_v1`. |
| Cálculo inmediato únicamente en el navegador | La cotización y la confirmación son autoritativas en Supabase, incluyen impacto y usan una versión exacta del mercado. |
| «Dificultad y recompensa» como una sola cifra | El diseño separa retorno base por contratos, bonus de dificultad y cambio de Prestigio. |
| Estado de predicción con elegir/confirmar/éxito | Añadir cotizando, cotización lista, precio movido, recotización, servicio de precio no disponible y confirmación transaccional. |
| Histórico completo desde la creación de todos los mercados | El histórico real empieza al activar la migración. Nunca se recrea ni dibuja volatilidad pasada. |
| Mecánica «igual a Polymarket/Kalshi» sin matiz | El pago por contrato es familiar, pero la beta usa LMSR y no libro de órdenes. |
| Posible compra, venta o salida | En beta solo se entra una vez y la posición queda bloqueada hasta resolución. |
| Apariencia actual del frontend como referencia final | El código actual valida el comportamiento; la Fase B debe aplicar el sistema artístico aprobado sin copiar la estética provisional. |

## 3. Dirección de interfaz ya aprobada

La arquitectura debe sentirse familiar para quien conozca productos como Polymarket o Kalshi, manteniendo una identidad completamente propia:

- aproximadamente 60 % de referencia funcional de Polymarket para exploración y descubrimiento;
- aproximadamente 40 % de referencia funcional de Kalshi para ficha y acción;
- 100 % de identidad Atinara en marca, color, tipografía, componentes, Karma, Prestigio, rangos y comunidad.

Son referencias de jerarquía, densidad y facilidad de uso, no plantillas. No se copian al píxel colores, tipografías, iconos, radios, sombras, proporciones, gráficos, botones, textos, ilustraciones ni animaciones.

La sensación buscada es la de un producto de mercado predictivo premium, sofisticado, claro e intuitivo. Debe necesitar muy poco texto explicativo porque la jerarquía y las acciones se entienden solas. Nunca debe parecer casino, casa de apuestas, plataforma de dinero real, bolsa genérica, cripto o clon de esports.

Logo, colores principales definitivos y el resto de la identidad artística continúan pendientes de la aprobación específica de Yol y se completarán en el segundo prompt.

## 4. Ficha de mercado obligatoria

### Escritorio

La estructura debe incluir:

- zona principal izquierda con categoría, pregunta, estado, cierre, precios actuales y gráfica;
- gráfica como pieza informativa principal, no como decoración;
- criterios, fuentes, debate y actividad debajo mediante información progresiva;
- panel derecho fijo para opción, Karma, cotización, desglose y confirmación;
- acción visible sin ocultar la evidencia necesaria para decidir.

La cotización muestra, antes de confirmar:

- `Sí` y `No` actuales;
- Karma utilizado;
- precio actual de la opción;
- impacto estimado en puntos;
- precio medio real de entrada;
- precio posterior estimado;
- contratos adquiridos;
- retorno base y beneficio base;
- bonus de dificultad;
- retorno total posible;
- Prestigio por acierto y fallo.

### Móvil

El orden principal es:

1. miniatura o motivo propio, categoría, estado y cierre;
2. pregunta protagonista;
3. `Sí` y `No` actuales;
4. gráfica táctil y selector temporal;
5. acciones grandes `Predecir Sí` y `Predecir No`;
6. hoja inferior de cotización y confirmación;
7. criterios, fuentes, debate y actividad en secciones posteriores.

No se copiará la composición exacta de la captura de Polymarket. Se conservará su inmediatez: pregunta, precios, evolución y acción deben entenderse en unos segundos.

## 5. Exploración y posiciones privadas

Las tarjetas de exploración pueden mostrar una *sparkline* real solo cuando haya puntos suficientes. Si no los hay, muestran el valor actual sin inventar movimiento.

Cada tarjeta diferencia claramente:

- precio colectivo `Sí · No`;
- participantes reales;
- Karma total real;
- estado y cierre;
- llamada a abrir o predecir.

«Mis predicciones» debe mostrar de forma privada:

- opción elegida;
- precio medio de entrada;
- precio actual;
- diferencia en puntos;
- Karma utilizado;
- contratos y retorno base posible cuando pertenezcan al modelo nuevo;
- estado activo, acertado, fallado o anulado.

Las posiciones heredadas pueden necesitar una etiqueta comprensible como «Condiciones anteriores», pero nunca deben exponerse identificadores técnicos como `legacy_fixed_v1` a la usuaria.

## 6. Estados que no pueden faltar

Penpot debe diseñar en escritorio y móvil:

- histórico cargando;
- histórico con un único punto real;
- histórico con varios puntos;
- rango sin movimientos dentro del periodo;
- histórico no disponible y reintento;
- conexión viva activa y recuperación silenciosa por consulta;
- cotización pendiente;
- cotización lista;
- importe por debajo del mínimo;
- importe por encima del límite personal;
- saldo insuficiente;
- precio movido antes de confirmar;
- recotización obligatoria;
- confirmando;
- éxito con desglose guardado;
- predicción ya existente;
- mercado recién cerrado;
- mercado cerrado, resuelto y anulado;
- invitada que puede explorar la mecánica pero debe iniciar sesión para confirmar;
- servicio de precio no disponible;
- reducción de movimiento, teclado, foco visible y lector de pantalla.

Las líneas de la gráfica deben identificarse también por texto y no solo por color. Tooltip, puntos táctiles, cambio de rango y cualquier actualización dinámica necesitan nombre accesible y estado legible.

## 7. Datos y mensajes prohibidos

- Ningún punto, usuario, participación, porcentaje o actividad de demostración.
- Ninguna animación que haga fluctuar el precio sin una confirmación real.
- Ningún símbolo de moneda, beneficio financiero, inversión o retirada.
- Ningún botón `Comprar`, `Vender`, `Cash out`, `Cambiar posición` u orden de negociación.
- Ninguna promesa de liquidez o rentabilidad económica.
- Ninguna exposición pública del Karma disponible o de posiciones activas.
- Ninguna simplificación que oculte criterios de resolución, impacto o precio medio antes de confirmar.

## 8. Punto de parada de la Fase B

Codex podrá corregir los inventarios y diseñar estas superficies solo cuando reciba la dirección artística aprobada. Debe detenerse si intenta inferir por su cuenta logo, paleta, tipografía, iconografía, emblemas o avatares todavía pendientes.

Antes de dar por terminada la Fase B deberá confirmar expresamente que:

1. eliminó de Penpot todos los restos del porcentaje por recuento;
2. eliminó el límite `×10` de las posiciones nuevas y mantuvo la compatibilidad histórica;
3. representó el precio actual, impacto, precio medio, contratos y bonus por separado;
4. incluyó gráfica real, ausencia honesta de histórico y estados de recotización;
5. no introdujo compraventa ni especulación en la beta;
6. no copió ninguna pantalla o activo de Polymarket o Kalshi.

