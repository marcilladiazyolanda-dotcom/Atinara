-- Eleva el máximo global por predicción a 1.000 Karma y elimina el límite
-- porcentual del 20 %. El saldo disponible, el mínimo de 10 Karma, la posición
-- única y la cotización versionada continúan siendo autoritativos en servidor.
-- La migración no modifica mercados, perfiles, predicciones ni histórico.

begin;

do $preflight$
declare
  quote_source text;
  place_source text;
  quote_hash text;
  place_hash text;
begin
  if to_regprocedure('public.get_prediction_quote(text,text,integer)') is null
     or to_regprocedure('public.place_prediction(text,text,integer,bigint,numeric)') is null then
    raise exception 'LIVE_PREDICTION_LIMIT_PREFLIGHT_FUNCTION_MISSING';
  end if;

  quote_source := replace(pg_catalog.pg_get_functiondef(
    'public.get_prediction_quote(text,text,integer)'::regprocedure
  ), chr(13) || chr(10), chr(10));
  place_source := replace(pg_catalog.pg_get_functiondef(
    'public.place_prediction(text,text,integer,bigint,numeric)'::regprocedure
  ), chr(13) || chr(10), chr(10));
  quote_hash := encode(extensions.digest(
    convert_to(quote_source, 'UTF8'), 'sha256'
  ), 'hex');
  place_hash := encode(extensions.digest(
    convert_to(place_source, 'UTF8'), 'sha256'
  ), 'hex');

  if quote_hash <> 'd89cf5c435a123c37eb1ae27584c3ae645cb3932d66257efe53ec4a5be35820d'
     or quote_source not like '%max_allowed_karma integer := 500;%'
     or quote_source not like '%if karma_risked_input > 500 then%'
     or quote_source not like '%floor(profile_row.karma * 0.2)::integer%'
     or quote_source not like '%SET search_path TO ''''%'
     or quote_source not like '%SECURITY DEFINER%' then
    raise exception 'LIVE_PREDICTION_LIMIT_PREFLIGHT_QUOTE_DRIFT:%', quote_hash;
  end if;

  if place_hash <> 'be6d594532128f780eacd38feb7cb9bce77700fa1c6da87fb1e1e55d68655373'
     or place_source not like '%floor(profile_row.karma * 0.2)::integer%'
     or place_source not like '%PREDICTION_ALREADY_EXISTS%'
     or place_source not like '%PRICE_MOVED%'
     or place_source not like '%SET search_path TO ''''%'
     or place_source not like '%SECURITY DEFINER%' then
    raise exception 'LIVE_PREDICTION_LIMIT_PREFLIGHT_PLACE_DRIFT:%', place_hash;
  end if;
end
$preflight$;

do $patch$
declare
  function_source text;
  patched_source text;
begin
  function_source := pg_catalog.pg_get_functiondef(
    'public.get_prediction_quote(text,text,integer)'::regprocedure
  );
  patched_source := replace(
    function_source,
    'max_allowed_karma integer := 500;',
    'max_allowed_karma integer := 1000;'
  );
  patched_source := replace(
    patched_source,
    'if karma_risked_input > 500 then',
    'if karma_risked_input > 1000 then'
  );
  patched_source := replace(
    patched_source,
    E'max_allowed_karma := least(\n      floor(profile_row.karma * 0.2)::integer,\n      500\n    );',
    'max_allowed_karma := least(profile_row.karma, 1000);'
  );
  if patched_source = function_source
     or patched_source like '%floor(profile_row.karma * 0.2)::integer%'
     or patched_source like '%if karma_risked_input > 500 then%'
     or patched_source not like '%max_allowed_karma integer := 1000;%'
     or patched_source not like '%least(profile_row.karma, 1000)%' then
    raise exception 'LIVE_PREDICTION_LIMIT_QUOTE_PATCH_INVALID';
  end if;
  execute patched_source;

  function_source := pg_catalog.pg_get_functiondef(
    'public.place_prediction(text,text,integer,bigint,numeric)'::regprocedure
  );
  patched_source := replace(
    function_source,
    E'max_allowed_karma := least(\n    floor(profile_row.karma * 0.2)::integer,\n    500\n  );',
    'max_allowed_karma := least(profile_row.karma, 1000);'
  );
  if patched_source = function_source
     or patched_source like '%floor(profile_row.karma * 0.2)::integer%'
     or patched_source not like '%least(profile_row.karma, 1000)%' then
    raise exception 'LIVE_PREDICTION_LIMIT_PLACE_PATCH_INVALID';
  end if;
  execute patched_source;
end
$patch$;

revoke all on function public.get_prediction_quote(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.get_prediction_quote(text, text, integer)
  to anon, authenticated;

revoke all on function public.place_prediction(text, text, integer, bigint, numeric)
  from public, anon, authenticated;
grant execute on function public.place_prediction(text, text, integer, bigint, numeric)
  to authenticated;

comment on function public.get_prediction_quote(text, text, integer) is
  'Cotización pública y autoritativa LMSR. Mínimo 10; máximo global 1000 Karma o saldo disponible.';
comment on function public.place_prediction(text, text, integer, bigint, numeric) is
  'Compra atómica LMSR. Mínimo 10; máximo global 1000 Karma o saldo disponible; una posición por mercado.';

do $postflight$
declare
  quote_source text;
  place_source text;
  quote_row pg_catalog.pg_proc%rowtype;
  place_row pg_catalog.pg_proc%rowtype;
begin
  select * into quote_row
  from pg_catalog.pg_proc
  where oid = 'public.get_prediction_quote(text,text,integer)'::regprocedure::oid;
  select * into place_row
  from pg_catalog.pg_proc
  where oid = 'public.place_prediction(text,text,integer,bigint,numeric)'::regprocedure::oid;

  quote_source := pg_catalog.pg_get_functiondef(quote_row.oid);
  place_source := pg_catalog.pg_get_functiondef(place_row.oid);

  if quote_source like '%floor(profile_row.karma * 0.2)::integer%'
     or quote_source like '%if karma_risked_input > 500 then%'
     or quote_source not like '%max_allowed_karma integer := 1000;%'
     or quote_source not like '%least(profile_row.karma, 1000)%'
     or place_source like '%floor(profile_row.karma * 0.2)::integer%'
     or place_source not like '%least(profile_row.karma, 1000)%' then
    raise exception 'LIVE_PREDICTION_LIMIT_POSTFLIGHT_SOURCE_INVALID';
  end if;

  if quote_row.prosecdef is not true
     or place_row.prosecdef is not true
     or quote_row.proconfig is distinct from array['search_path=""']::text[]
     or place_row.proconfig is distinct from array['search_path=""']::text[] then
    raise exception 'LIVE_PREDICTION_LIMIT_POSTFLIGHT_SECURITY_INVALID';
  end if;

  if not has_function_privilege('anon',
       'public.get_prediction_quote(text,text,integer)', 'EXECUTE')
     or not has_function_privilege('authenticated',
       'public.get_prediction_quote(text,text,integer)', 'EXECUTE')
     or has_function_privilege('anon',
       'public.place_prediction(text,text,integer,bigint,numeric)', 'EXECUTE')
     or not has_function_privilege('authenticated',
       'public.place_prediction(text,text,integer,bigint,numeric)', 'EXECUTE') then
    raise exception 'LIVE_PREDICTION_LIMIT_POSTFLIGHT_PRIVILEGES_INVALID';
  end if;
end
$postflight$;

commit;
