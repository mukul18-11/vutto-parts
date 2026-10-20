do $$ begin if to_regclass('demo_seed.meta') is not null then perform private.apply_seed(private.ist_today()); end if; end $$;
-- Local only (production never runs this file): no reset cooldown in local development.
update public.demo_meta set cooldown_seconds = 0 where id = 1;
