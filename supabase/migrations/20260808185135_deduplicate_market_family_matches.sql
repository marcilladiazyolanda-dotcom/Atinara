begin;

create or replace function private.market_family_unique_jsonb_array(items_input jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select coalesce(jsonb_agg(unique_item.item order by unique_item.first_ordinal), '[]'::jsonb)
  from (
    select element.item, min(element.ordinality) as first_ordinal
    from jsonb_array_elements(
      case when jsonb_typeof(items_input) = 'array' then items_input else '[]'::jsonb end
    ) with ordinality as element(item, ordinality)
    group by element.item
  ) unique_item;
$function$;

revoke all on function private.market_family_unique_jsonb_array(jsonb)
  from public, anon, authenticated;

create or replace function private.deduplicate_market_candidate_family_arrays()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  blockers jsonb := private.market_family_unique_jsonb_array(new.duplicate_matches);
  siblings jsonb := private.market_family_unique_jsonb_array(new.normalized_payload -> 'family_matches');
  hard_reasons jsonb := private.market_family_unique_jsonb_array(new.normalized_payload -> 'hard_reject_reasons');
begin
  new.duplicate_matches := blockers;
  new.normalized_payload := coalesce(new.normalized_payload, '{}'::jsonb) || jsonb_build_object(
    'duplicate_matches', blockers,
    'family_matches', siblings,
    'hard_reject_reasons', hard_reasons
  );
  return new;
end;
$function$;

revoke all on function private.deduplicate_market_candidate_family_arrays()
  from public, anon, authenticated;

drop trigger if exists zzz_deduplicate_market_candidate_family_arrays_before_write
  on private.external_market_candidates;
create trigger zzz_deduplicate_market_candidate_family_arrays_before_write
before insert or update of normalized_payload, duplicate_matches, family_key, family_child_key
on private.external_market_candidates
for each row execute function private.deduplicate_market_candidate_family_arrays();

-- Recorre todas las candidatas por los clasificadores vigentes y elimina solo
-- elementos JSON idénticos. No cambia estados, preparación ni datos económicos.
update private.external_market_candidates candidate_alias
set normalized_payload = candidate_alias.normalized_payload;

commit;
