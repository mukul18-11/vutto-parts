-- Master-data triggers fire for admin edits made directly under RLS (SPEC §11.2), so they run as
-- the authenticated caller, who has no EXECUTE on private.err (and must not get it). Without this
-- an invalid bin or finding_type_parts edit failed with "permission denied for function err"
-- instead of VALIDATION. Run them as their owner; search_path is already pinned to ''.
-- bins_before_update then also sees every stock_balances row regardless of the caller's RLS.

alter function private.bins_before_insert() security definer;
alter function private.bins_before_update() security definer;
alter function private.finding_type_parts_check() security definer;

revoke execute on function private.bins_before_insert() from public, anon;
revoke execute on function private.bins_before_update() from public, anon;
revoke execute on function private.finding_type_parts_check() from public, anon;
