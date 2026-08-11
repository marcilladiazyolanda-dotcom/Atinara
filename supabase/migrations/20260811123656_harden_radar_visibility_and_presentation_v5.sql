begin;

-- Defensa en profundidad: el trigger de clasificación ya marca duplicados al
-- persistir, pero la RPC de lectura vuelve a comprobar la identidad exacta en
-- el mismo snapshot. Así una carrera con un borrador o una publicación nunca
-- puede volver visible una opción ya ocupada.
create or replace function public.list_market_radar_candidates_v2(
  provider_filter text default null,
  category_filter text default null,
  quality_filter text default null,
  query_filter text default null,
  order_key text default 'recommended',
  horizon_filter text default '180d',
  limit_count integer default 240,
  offset_count integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  result jsonb;
  checked_at_value timestamptz := now();
begin
  perform private.require_current_admin();
  if provider_filter is not null and provider_filter <> ''
     and provider_filter not in ('polymarket', 'kalshi', 'tavily') then
    raise exception 'INVALID_RADAR_PROVIDER' using errcode = '22023';
  end if;
  if order_key not in ('recommended', 'popularity', 'closing', 'recent') then
    raise exception 'INVALID_RADAR_ORDER' using errcode = '22023';
  end if;
  if quality_filter is not null and quality_filter <> ''
     and quality_filter not in ('fit', 'review', 'rejected', 'all') then
    raise exception 'INVALID_RADAR_QUALITY' using errcode = '22023';
  end if;
  if horizon_filter not in ('30d', '90d', '180d', '365d') then
    raise exception 'INVALID_RADAR_HORIZON' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(private.market_radar_safe_payload(candidate_row)), '[]'::jsonb)
  into result
  from (
    select candidate.*
    from private.external_market_candidates candidate
    where candidate.normalizer_version = 'atinara-radar-v2'
      and candidate.family_version = 'atinara-market-family-v4'
      and candidate.family_key is not null
      and candidate.family_child_key is not null
      and candidate.state in ('available', 'needs_review')
      and candidate.verification_status in ('verified_open', 'needs_review')
      and candidate.quality_status <> 'rejected'
      and private.market_radar_discovery_fact_current_v2(candidate, checked_at_value)
      and not exists (
        select 1
        from public.markets market_alias
        where market_alias.family_key = candidate.family_key
          and market_alias.family_child_key = candidate.family_child_key
      )
      and not exists (
        select 1
        from private.market_drafts draft_alias
        where (
            draft_alias.radar_candidate_id = candidate.id
            or (
              draft_alias.family_key = candidate.family_key
              and draft_alias.family_child_key = candidate.family_child_key
            )
          )
          and draft_alias.workflow_status not in ('cancelled', 'annulled')
      )
      and (
        coalesce(
          nullif(candidate.normalized_payload ->> 'source_close_at', '')::timestamptz,
          nullif(candidate.normalized_payload ->> 'atinara_closes_at', '')::timestamptz
        ) is null
        or coalesce(
          nullif(candidate.normalized_payload ->> 'source_close_at', '')::timestamptz,
          nullif(candidate.normalized_payload ->> 'atinara_closes_at', '')::timestamptz
        ) <= checked_at_value + case horizon_filter
          when '30d' then interval '30 days'
          when '90d' then interval '90 days'
          when '365d' then interval '365 days'
          else interval '180 days'
        end
      )
      and (provider_filter is null or provider_filter = '' or candidate.provider = provider_filter)
      and (category_filter is null or category_filter = '' or candidate.atinara_category = category_filter)
      and (
        quality_filter is null or quality_filter = '' or quality_filter = 'all'
        or (quality_filter = 'fit' and candidate.verification_status = 'verified_open')
        or (quality_filter = 'review' and candidate.verification_status in ('verified_open', 'needs_review'))
      )
      and (
        query_filter is null or query_filter = ''
        or candidate.normalized_payload ->> 'source_title' ilike '%' || query_filter || '%'
        or candidate.normalized_payload ->> 'source_question' ilike '%' || query_filter || '%'
        or candidate.normalized_payload ->> 'atinara_question' ilike '%' || query_filter || '%'
      )
    order by
      case when order_key = 'recommended' then candidate.quality_score end desc nulls last,
      case when order_key = 'popularity' then coalesce((candidate.normalized_payload ->> 'source_volume_total')::numeric, 0) end desc nulls last,
      case when order_key = 'closing' then nullif(candidate.normalized_payload ->> 'source_close_at', '')::timestamptz end asc nulls last,
      case when order_key = 'recent' then coalesce(candidate.source_updated_at, candidate.fetched_at) end desc nulls last,
      candidate.quality_score desc,
      candidate.fetched_at desc
    limit least(greatest(coalesce(limit_count, 240), 1), 500)
    offset greatest(coalesce(offset_count, 0), 0)
  ) candidate_row;
  return result;
end;
$function$;

revoke all on function public.list_market_radar_candidates_v2(
  text,text,text,text,text,text,integer,integer
) from public, anon, authenticated, service_role;
grant execute on function public.list_market_radar_candidates_v2(
  text,text,text,text,text,text,integer,integer
) to authenticated;

comment on function public.list_market_radar_candidates_v2(
  text,text,text,text,text,text,integer,integer
) is 'Radar privado admin: solo hechos discovery vigentes e identidades v4 no ocupadas por mercados ni borradores activos.';

commit;
