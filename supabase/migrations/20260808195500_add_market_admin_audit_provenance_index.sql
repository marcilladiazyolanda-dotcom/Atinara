-- La puerta de confirmación y el historial administrativo consultan la
-- auditoría por borrador. Este índice evita recorrer toda la memoria cuando el
-- historial crezca y conserva el orden cronológico usado por el panel.

create index if not exists market_admin_audit_draft_action_created_idx
  on private.market_admin_audit (draft_id, action_code, created_at desc)
  where draft_id is not null;

comment on index private.market_admin_audit_draft_action_created_idx is
'Acelera la procedencia de Planes de Resolución y el historial privado por borrador.';
