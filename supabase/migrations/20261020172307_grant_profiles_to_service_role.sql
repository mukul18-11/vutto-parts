-- The demo-user scripts (scripts/create-demo-users.ts and the demo-guard Action, SPEC §12, §16)
-- read and write public.profiles with the secret key, i.e. as service_role. Local Supabase grants
-- service_role every table by default; hosted projects no longer do, so the grant is explicit.
-- profiles is the only table the secret key touches directly (reseed_if_stale_service is
-- SECURITY DEFINER). service_role bypasses RLS. No DELETE: the scripts never delete profiles.

grant select, insert, update on public.profiles to service_role;
