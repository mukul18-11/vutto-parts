do $$ begin if to_regclass('demo_seed.meta') is not null then perform private.apply_seed(private.ist_today()); end if; end $$;
