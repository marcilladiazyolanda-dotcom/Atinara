---
name: atinara-release-verification
description: "Usa esta habilidad antes de declarar terminado un cambio de Atinara, preparar ZIP, commit o PR, desplegar, o entregar archivos a Yol. No usar al inicio salvo que se evalúe readiness."
---

# Verificación de entrega de Atinara

## 1. Congela la candidata

- Registra rama, `HEAD`, base y `origin/main`.
- Inspecciona `git status` y diff final.
- Separa añadidos, modificados y eliminados.
- Excluye `.env`, secretos, `node_modules`, temporales, reportes generados, ZIP antiguos y binarios accidentales.

## 2. Matriz de pruebas

Toma los comandos del `package.json` y documentación actuales. Ejecuta según riesgo:

- sintaxis JavaScript;
- unitarias;
- TypeScript/monitorización;
- SQL estático y transaccional;
- Edge checks;
- benchmark offline si cambió IA;
- Playwright/Checkly si cambió UI;
- audit/dependencias si cambiaron paquetes;
- `git diff --check`.

Añade pruebas específicas de RLS, Auth, concurrencia, provider failure, accesibilidad o rendimiento.

## 3. Estado externo

Si existe autorización de despliegue, verifica el target real antes y después. Si no existe, informa “probado, no desplegado”. No deduzcas producción desde el árbol local.

## 4. Entrega manual a Yol

- Incluye solo archivos añadidos o modificados con rutas relativas exactas.
- Enumera eliminaciones por separado.
- No uses carpeta envolvente dentro del ZIP.
- Divide entregas superiores a 100 archivos.
- Genera manifiesto y SHA-256 cuando aporten trazabilidad.

## 5. Resultado

La puerta falla si una prueba material falla, no puede ejecutarse sin explicación suficiente, la producción requerida no se verificó o existen cambios sin justificar. Informa con precisión, sin maquillar bloqueos.
