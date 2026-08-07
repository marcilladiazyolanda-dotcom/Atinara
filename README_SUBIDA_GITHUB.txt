ATINARA · PASO 13.5.2 · CORRECTOR EXPERTO DE BORRADORES

Subir los archivos descomprimidos conservando exactamente sus rutas:

admin-markets.html
market-draft-fixer.js
supabase/functions/market-draft-fixer/index.ts
supabase/migrations/20260807222112_add_market_draft_expert_repair.sql

ESTADO YA ACTIVADO EN SUPABASE PRODUCCIÓN
- Migración registrada una sola vez:
  20260807222112 · add_market_draft_expert_repair
- Edge Function activa:
  market-draft-fixer · versión 1 · verify_jwt=true
- Hash del bundle remoto:
  dbd3d0fc235c4ad21041411d9544b253affe27aa991d5e04c88e1b91b4555850

No volver a aplicar manualmente la migración ni volver a desplegar la función únicamente por subir este paquete. La subida al repositorio alinea el código y publica el botón en GitHub Pages.

FLUJO DESPUÉS DE LA SUBIDA
1. Recargar Gestión de mercados con Ctrl + F5.
2. Abrir el borrador rechazado.
3. Pulsar «Aplicar correcciones y volver a revisar».
4. El sistema corrige pregunta, fechas, zona horaria, criterios, casos límite y Plan de Resolución de forma auditada.
5. Si la revisión queda aprobada, pulsar «Confirmar humanamente».
6. Después se habilita «Revalidar y publicar».

El Corrector Experto no confirma, programa, publica ni resuelve automáticamente. Si queda una ambigüedad real o falla la revisión, el borrador permanece privado.
