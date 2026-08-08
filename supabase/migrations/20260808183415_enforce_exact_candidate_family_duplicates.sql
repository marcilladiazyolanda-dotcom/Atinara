begin;

create or replace function private.enforce_exact_candidate_family_duplicate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  canonical_row private.external_market_candidates%rowtype;
  blocker_value jsonb;
  hard_reasons jsonb := '[]'::jsonb;
  reason_item jsonb;
  previous_novelty integer := 0;
begin
  if new.family_key is null or new.family_child_key is null then return new; end if;

  select * into canonical_row
  from private.external_market_candidates candidate_alias
  where candidate_alias.id <> new.id
    and candidate_alias.family_key = new.family_key
    and candidate_alias.family_child_key = new.family_child_key
    and candidate_alias.state not in ('dismissed', 'expired', 'rejected')
    and candidate_alias.expires_at > now()
    and (candidate_alias.created_at, candidate_alias.id)
      < (coalesce(new.created_at, now()), new.id)
  order by candidate_alias.created_at, candidate_alias.id
  limit 1;

  if canonical_row.id is null then return new; end if;

  blocker_value := jsonb_build_object(
    'id', canonical_row.id,
    'question', coalesce(
      canonical_row.normalized_payload ->> 'atinara_question',
      canonical_row.normalized_payload ->> 'source_question'
    ),
    'relationship', 'exact_duplicate',
    'blocking', true,
    'family_key', new.family_key,
    'family_child_key', new.family_child_key,
    'kind', 'candidate'
  );
  if not exists (
    select 1
    from jsonb_array_elements(coalesce(new.duplicate_matches, '[]'::jsonb)) match_rows(match_item)
    where match_item ->> 'id' = canonical_row.id::text
      and match_item ->> 'relationship' = 'exact_duplicate'
  ) then
    new.duplicate_matches := coalesce(new.duplicate_matches, '[]'::jsonb) || jsonb_build_array(blocker_value);
  end if;

  for reason_item in
    select value from jsonb_array_elements(coalesce(new.normalized_payload -> 'hard_reject_reasons', '[]'::jsonb))
  loop
    if trim(both '"' from reason_item::text) <> 'DUPLICATE_MARKET' then
      hard_reasons := hard_reasons || jsonb_build_array(reason_item);
    end if;
  end loop;
  hard_reasons := hard_reasons || '"DUPLICATE_MARKET"'::jsonb;

  begin
    previous_novelty := greatest(0, coalesce((new.score_breakdown ->> 'novelty')::integer, 0));
  exception when invalid_text_representation then
    previous_novelty := 0;
  end;
  new.score_breakdown := jsonb_set(coalesce(new.score_breakdown, '{}'::jsonb), '{novelty}', '0'::jsonb, true);
  new.quality_score := greatest(0, new.quality_score - previous_novelty);
  new.family_relationship := 'exact_duplicate';
  new.normalized_payload := new.normalized_payload || jsonb_build_object(
    'duplicate_matches', new.duplicate_matches,
    'hard_reject_reasons', hard_reasons,
    'family_relationship', 'exact_duplicate'
  );
  return new;
end;
$function$;

revoke all on function private.enforce_exact_candidate_family_duplicate()
  from public, anon, authenticated;

drop trigger if exists zz_enforce_exact_candidate_family_duplicate_before_write
  on private.external_market_candidates;
create trigger zz_enforce_exact_candidate_family_duplicate_before_write
before insert or update of family_key, family_child_key, normalized_payload, duplicate_matches
on private.external_market_candidates
for each row execute function private.enforce_exact_candidate_family_duplicate();

commit;
