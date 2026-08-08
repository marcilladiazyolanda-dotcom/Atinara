-- Reparación detectada por la matriz transaccional de Paso 13.5.2.
-- El trim debe ejecutarse después de colapsar CR/LF y espacios para que una
-- nueva línea final no se convierta en un espacio final semántico.

begin;

create or replace function private.market_normalize_text(value_input text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select nullif(
    trim(regexp_replace(
      replace(replace(coalesce(value_input, ''), E'\r\n', E'\n'), E'\r', E'\n'),
      '[[:space:]]+',
      ' ',
      'g'
    )),
    ''
  );
$function$;

revoke all on function private.market_normalize_text(text) from public, anon, authenticated;

comment on function private.market_normalize_text(text) is
  'Normaliza whitespace y recorta después del colapso para que CR/LF terminales sean no-op.';

commit;
