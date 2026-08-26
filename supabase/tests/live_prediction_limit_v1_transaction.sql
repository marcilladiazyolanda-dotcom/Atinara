begin;

do $live_market_test$
declare
  suffix text := substr(md5(clock_timestamp()::text || random()::text), 1, 12);
  test_market_id text := 'transaction-live-market-' || suffix;
  buyer_yes uuid;
  buyer_no uuid;
  source_market public.markets%rowtype;
  anonymous_quote jsonb;
  low_balance_quote jsonb;
  stale_no_quote jsonb;
  yes_quote jsonb;
  no_quote jsonb;
  yes_result jsonb;
  no_result jsonb;
  yes_probability_after numeric;
  final_yes_probability numeric;
  final_no_probability numeric;
  expected_failure boolean;
  history_versions bigint[];
  history_sources text[];
begin
  if not has_function_privilege(
    'anon', 'public.get_prediction_quote(text,text,integer)', 'EXECUTE'
  ) or not has_function_privilege(
    'authenticated', 'public.get_prediction_quote(text,text,integer)', 'EXECUTE'
  ) or has_function_privilege(
    'anon', 'public.place_prediction(text,text,integer,bigint,numeric)', 'EXECUTE'
  ) or not has_function_privilege(
    'authenticated', 'public.place_prediction(text,text,integer,bigint,numeric)', 'EXECUTE'
  ) then
    raise exception 'TEST_LIVE_MARKET_LIMIT_PRIVILEGES_INVALID';
  end if;

  select profile.id into buyer_yes
  from public.profiles profile
  order by profile.karma desc, profile.id
  limit 1;
  select profile.id into buyer_no
  from public.profiles profile
  where profile.id <> buyer_yes
  order by profile.karma desc, profile.id
  limit 1;
  if buyer_yes is null or buyer_no is null then
    raise exception 'TEST_LIVE_MARKET_LIMIT_REQUIRES_TWO_PROFILES';
  end if;

  select market.* into source_market
  from public.markets market
  where market.status = 'Abierto'
    and (market.closes_at is null or market.closes_at > now() + interval '1 hour')
  order by market.created_at desc, market.id
  limit 1;
  if not found then
    raise exception 'TEST_LIVE_MARKET_LIMIT_REQUIRES_OPEN_MARKET';
  end if;

  update public.profiles
  set karma = case when id = buyer_yes then 2000 else 600 end,
      updated_at = now()
  where id in (buyer_yes, buyer_no);

  insert into public.markets
  select (jsonb_populate_record(
    null::public.markets,
    to_jsonb(source_market) || jsonb_build_object(
      'id', test_market_id,
      'question', 'Prueba transaccional de precio vivo ' || suffix,
      'status', 'Abierto',
      'yes_percent', 50,
      'no_percent', 50,
      'karma_total', 0,
      'participants_count', 0,
      'comments_count', 0,
      'created_at', now(),
      'closes_at', now() + interval '30 days',
      'evaluation_ends_at', now() + interval '30 days',
      'participation_closed_at', null,
      'participation_close_reason', null,
      'resolution_result', null,
      'resolution_note', null,
      'resolved_at', null,
      'resolution_reviewed_by', null,
      'resolution_ai_model', null,
      'resolution_ai_generated_at', null
    )
  )).*;

  if (select count(*) from public.market_maker_state where market_id = test_market_id) <> 1
     or (select count(*) from public.market_price_history where market_id = test_market_id) <> 1 then
    raise exception 'TEST_LIVE_MARKET_LIMIT_INITIAL_STATE_INVALID';
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'anon')::text,
    true
  );
  execute 'set local role anon';
  anonymous_quote := public.get_prediction_quote(test_market_id, 'Sí', 1000);
  execute 'reset role';
  if (anonymous_quote ->> 'max_karma_allowed')::integer <> 1000
     or (anonymous_quote ->> 'karma_risked')::integer <> 1000 then
    raise exception 'TEST_LIVE_MARKET_LIMIT_ANONYMOUS_1000_INVALID:%', anonymous_quote;
  end if;

  expected_failure := false;
  begin
    execute 'set local role anon';
    perform public.get_prediction_quote(test_market_id, 'Sí', 1001);
  exception when others then
    execute 'reset role';
    if sqlerrm = 'MAX_KARMA_EXCEEDED' then
      expected_failure := true;
    else
      raise;
    end if;
  end;
  execute 'reset role';
  if not expected_failure then
    raise exception 'TEST_LIVE_MARKET_LIMIT_ANONYMOUS_1001_ACCEPTED';
  end if;

  expected_failure := false;
  begin
    execute 'set local role anon';
    perform public.get_prediction_quote(test_market_id, 'Sí', 9);
  exception when others then
    execute 'reset role';
    if sqlerrm = 'MIN_KARMA_REQUIRED' then
      expected_failure := true;
    else
      raise;
    end if;
  end;
  execute 'reset role';
  if not expected_failure then
    raise exception 'TEST_LIVE_MARKET_LIMIT_MINIMUM_9_ACCEPTED';
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', buyer_no, 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';
  low_balance_quote := public.get_prediction_quote(test_market_id, 'No', 10);
  execute 'reset role';
  if (low_balance_quote ->> 'max_karma_allowed')::integer <> 600 then
    raise exception 'TEST_LIVE_MARKET_LIMIT_BALANCE_BOUND_INVALID:%', low_balance_quote;
  end if;

  expected_failure := false;
  begin
    execute 'set local role authenticated';
    perform public.get_prediction_quote(test_market_id, 'No', 601);
  exception when others then
    execute 'reset role';
    if sqlerrm = 'MAX_KARMA_EXCEEDED' then
      expected_failure := true;
    else
      raise;
    end if;
  end;
  execute 'reset role';
  if not expected_failure then
    raise exception 'TEST_LIVE_MARKET_LIMIT_BALANCE_OVERFLOW_ACCEPTED';
  end if;

  update public.profiles set karma = 2000, updated_at = now() where id = buyer_no;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', buyer_no, 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';
  stale_no_quote := public.get_prediction_quote(test_market_id, 'No', 1000);
  execute 'reset role';

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', buyer_yes, 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';
  yes_quote := public.get_prediction_quote(test_market_id, 'Sí', 1000);
  execute 'reset role';
  if (yes_quote ->> 'max_karma_allowed')::integer <> 1000
     or (yes_quote ->> 'market_version')::bigint <> 0 then
    raise exception 'TEST_LIVE_MARKET_LIMIT_YES_QUOTE_INVALID:%', yes_quote;
  end if;

  expected_failure := false;
  begin
    execute 'set local role authenticated';
    perform public.place_prediction(
      test_market_id,
      'Sí',
      1001,
      (yes_quote ->> 'market_version')::bigint,
      100
    );
  exception when others then
    execute 'reset role';
    if sqlerrm = 'MAX_KARMA_EXCEEDED' then
      expected_failure := true;
    else
      raise;
    end if;
  end;
  execute 'reset role';
  if not expected_failure then
    raise exception 'TEST_LIVE_MARKET_LIMIT_PLACE_1001_ACCEPTED';
  end if;

  execute 'set local role authenticated';
  yes_result := public.place_prediction(
    test_market_id,
    'Sí',
    1000,
    (yes_quote ->> 'market_version')::bigint,
    (yes_quote ->> 'average_entry_price_percentage')::numeric
  );
  execute 'reset role';
  yes_probability_after := (
    yes_result -> 'market_price' ->> 'yes_price_percentage'
  )::numeric;
  if yes_probability_after <= 50
     or (yes_result -> 'market_price' ->> 'market_version')::bigint <> 1
     or (select karma from public.profiles where id = buyer_yes) <> 1000 then
    raise exception 'TEST_LIVE_MARKET_LIMIT_YES_PURCHASE_INVALID:%', yes_result;
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', buyer_no, 'role', 'authenticated')::text,
    true
  );
  expected_failure := false;
  begin
    execute 'set local role authenticated';
    perform public.place_prediction(
      test_market_id,
      'No',
      1000,
      (stale_no_quote ->> 'market_version')::bigint,
      (stale_no_quote ->> 'average_entry_price_percentage')::numeric
    );
  exception when others then
    execute 'reset role';
    if sqlerrm = 'PRICE_MOVED' then
      expected_failure := true;
    else
      raise;
    end if;
  end;
  execute 'reset role';
  if not expected_failure
     or exists (
       select 1 from public.predictions
       where user_id = buyer_no and market_id = test_market_id
     ) then
    raise exception 'TEST_LIVE_MARKET_LIMIT_STALE_QUOTE_ACCEPTED';
  end if;

  execute 'set local role authenticated';
  no_quote := public.get_prediction_quote(test_market_id, 'No', 1000);
  no_result := public.place_prediction(
    test_market_id,
    'No',
    1000,
    (no_quote ->> 'market_version')::bigint,
    (no_quote ->> 'average_entry_price_percentage')::numeric
  );
  execute 'reset role';

  final_yes_probability := (
    no_result -> 'market_price' ->> 'yes_price_percentage'
  )::numeric;
  final_no_probability := (
    no_result -> 'market_price' ->> 'no_price_percentage'
  )::numeric;
  if final_yes_probability >= yes_probability_after
     or abs(final_yes_probability + final_no_probability - 100) > 0.0001
     or (no_result -> 'market_price' ->> 'market_version')::bigint <> 2
     or (select karma from public.profiles where id = buyer_no) <> 1000 then
    raise exception 'TEST_LIVE_MARKET_LIMIT_NO_PURCHASE_INVALID:%', no_result;
  end if;

  select array_agg(history.market_version order by history.recorded_at, history.market_version),
         array_agg(history.source order by history.recorded_at, history.market_version)
  into history_versions, history_sources
  from public.market_price_history history
  where history.market_id = test_market_id;
  if history_versions is distinct from array[0, 1, 2]::bigint[]
     or history_sources is distinct from array['initial', 'prediction', 'prediction']::text[] then
    raise exception 'TEST_LIVE_MARKET_LIMIT_HISTORY_INVALID:%/%',
      history_versions, history_sources;
  end if;

  if (select count(*) from public.predictions where market_id = test_market_id) <> 2
     or (select count(*) from public.predictions where market_id = test_market_id and option_selected = 'Sí' and karma_risked = 1000) <> 1
     or (select count(*) from public.predictions where market_id = test_market_id and option_selected = 'No' and karma_risked = 1000) <> 1
     or (select karma_total from public.markets where id = test_market_id) <> 2000
     or (select participants_count from public.markets where id = test_market_id) <> 2 then
    raise exception 'TEST_LIVE_MARKET_LIMIT_AGGREGATES_INVALID';
  end if;

  expected_failure := false;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', buyer_yes, 'role', 'authenticated')::text,
    true
  );
  begin
    execute 'set local role authenticated';
    perform public.get_prediction_quote(test_market_id, 'Sí', 10);
  exception when others then
    execute 'reset role';
    if sqlerrm = 'PREDICTION_ALREADY_EXISTS' then
      expected_failure := true;
    else
      raise;
    end if;
  end;
  execute 'reset role';
  if not expected_failure then
    raise exception 'TEST_LIVE_MARKET_LIMIT_DUPLICATE_ACCEPTED';
  end if;
end
$live_market_test$;

rollback;
