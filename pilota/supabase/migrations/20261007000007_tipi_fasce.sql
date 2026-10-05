-- =====================================================================
-- FisioAgenda — versione pilota: tipi di fascia nel calendario di ogni collega.
-- Solo "amb" (Ambulatorio) riceve pazienti; tutte le altre fasce bloccano.
-- Si può eseguire più volte.
-- =====================================================================
create or replace function app.block_label(k text) returns text language sql immutable as $$
  select case k
    when 'amb' then 'ambulatorio' when 'reparto' then 'reparto' when 'pausa' then 'pausa'
    when 'documentazione' then 'cartelle / adempimenti burocratici' when 'segreteria' then 'segreteria'
    when 'corso' then 'corso obbligatorio' when 'permesso_ore' then 'permesso a ore' when 'recupero_ore' then 'recupero ore'
    when 'briefing' then 'briefing' when 'preparazione' then 'preparazione' else 'altra attività' end
$$;

create or replace function app.validate_blocks(p jsonb, p_where text) returns void
language plpgsql immutable as $$
declare x jsonb; v_prev time; v_s time; v_e time;
begin
  if p is null or jsonb_typeof(p) <> 'array' then raise exception '%: fasce non valide.', p_where using hint = 'FA_INPUT'; end if;
  for x in select e from jsonb_array_elements(p) e order by (e->>'start')::time loop
    if coalesce(x->>'kind', '') not in ('amb', 'reparto', 'pausa', 'documentazione', 'segreteria', 'corso', 'permesso_ore', 'recupero_ore',
                                        'briefing', 'preparazione', 'altro') then
      raise exception '%: tipo di fascia non valido.', p_where using hint = 'FA_INPUT';
    end if;
    if nullif(x->>'start', '') is null or nullif(x->>'end', '') is null then
      raise exception '%: indica inizio e fine di ogni fascia.', p_where using hint = 'FA_INPUT';
    end if;
    v_s := (x->>'start')::time; v_e := (x->>'end')::time;
    if v_e <= v_s then raise exception '%: la fascia delle % termina prima di iniziare.', p_where, x->>'start' using hint = 'FA_INPUT'; end if;
    if v_prev is not null and v_s < v_prev then raise exception '%: fasce sovrapposte alle %.', p_where, x->>'start' using hint = 'FA_INPUT'; end if;
    if nullif(x->>'max', '') is not null and (x->>'max')::int < 1 then raise exception '%: numero massimo di pazienti non valido.', p_where using hint = 'FA_INPUT'; end if;
    v_prev := v_e;
  end loop;
end $$;
