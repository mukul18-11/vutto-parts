# Decision records

Short records of the choices that shape this system. Each one says what problem it answers, what was decided, why, and what it costs.

## 1. Stock is a ledger; balances are maintained by a trigger

- **Context:** store keepers, GRNs, returns and counts all change stock, and a wrong number on the shelf is the most expensive bug in the system.
- **Decision:** the only way to change stock is to insert into the append-only `stock_moves`. An AFTER INSERT trigger updates `stock_balances` and raises `INSUFFICIENT_BIN_STOCK` instead of going negative. No other code writes balances.
- **Why:** every quantity can be explained move by move, and invariant 1 (balance = sum of moves) can be checked after every RPC. A "fix" is a compensating move, never an edit.
- **Trade-off:** reads need a balances table plus views to stay fast. Undo is always a new move, which is sometimes more clicks than editing a number.

## 2. Every write is one RPC: idempotency, authorise, workshop lock

- **Context:** phones on shop Wi-Fi double-tap and retry; two store keepers can reach for the same last unit.
- **Decision:** each mutating action is one SECURITY DEFINER Postgres function. It runs in this order: (1) idempotency check on `(user, request_id)`; (2) load the row and its workshop; (3) `authorize`; (4) `pg_advisory_xact_lock` on the workshop; (5) do the work; (6) assert invariants; (7) store the result.
- **Why:** the whole business rule runs in one transaction under one lock. A retry with the same request_id returns the first result, and no deadlocks or lost updates are possible between stock and reservations.
- **Trade-off:** all stock writes in a workshop are serialised. That is fine at ~32 bikes a day, but it would need finer locks at much higher volume. Business logic lives in SQL, which is harder to refactor than TypeScript.

## 3. Reservations with FIFO allocation

- **Context:** free stock must never sit on the shelf while a confirmed bike waits for it, and a store keeper must not hand one bike's part to another.
- **Decision:** `qty_reserved` lives on job card lines. `allocate_free_stock` hands free units to waiting lines by needed-by date, then confirmation time, then line id, and runs after anything that adds stock or need. Reservations are never taken away silently; only a manager's `reallocate_reservation` moves one.
- **Why:** "issue" only consumes what is already reserved, so the last unit cannot be issued twice. The blocked board is exact.
- **Trade-off:** a late but urgent bike waits its turn unless a manager reallocates. Allocation runs often and must stay fast.

## 4. Demand comes from inspection findings

- **Context:** parts were ordered when the bike reached the bay, so bikes waited days for parts.
- **Decision:** findings recorded at purchase resolve to parts through finding-type rules and fitments (§9). They become job card lines, which are confirmed at purchase.
- **Why:** demand is known 2–5 days before the bike arrives, so parts are reserved or ordered early. This is the "after" period in the metrics.
- **Trade-off:** inspection quality now drives purchasing. A wrong finding orders a wrong part, so wrong-fit returns feed back into the fitment data.

## 5. No PO-to-bike links; a pegging view instead

- **Context:** buyers order per supplier and part, not per bike, and bikes get cancelled or reprioritised after the PO is sent.
- **Decision:** PO lines have no job card link. Supply is per (workshop, part). `v_line_eta` ranks waiting lines FIFO and open PO lines by expected date, and pegs them by running totals.
- **Why:** the ETAs stay right when priorities change, and a cancelled bike's PO simply turns into "Excess on order" for the manager to short-close.
- **Trade-off:** an ETA is a projection, not a promise to a specific bike, and pegging is harder to explain than a direct link.

## 6. All day logic is in IST

- **Context:** the workshops run on Indian days, while the database and Vercel run in UTC. An issue at 00:10 IST is still "yesterday" in UTC.
- **Decision:** `private.ist_date()` / `private.ist_today()` in SQL and `src/lib/time.ts` in TypeScript define every day. Date-only values are `YYYY-MM-DD` strings and are never parsed with `new Date()`. Unit tests run in `America/Los_Angeles` to catch slips.
- **Why:** reports, reorder windows and expected dates match what a workshop calls "today".
- **Trade-off:** every date needs care, and a unit-test source guard keeps date-string parsing out of `src/`.

## 7. Money is integer paise

- **Context:** prices include GST, and premiums and totals are compared to the paisa.
- **Decision:** `bigint` paise everywhere. One parser (`rupeesToPaise`) works on the string parts, never with `parseFloat × 100`. Totals are summed in SQL and formatted once.
- **Why:** there is no float drift, and the tile totals equal their list footers exactly.
- **Trade-off:** conversions happen at every edge (inputs, display, seed). A source guard checks that `parseFloat` never appears in app code.

## 8. Demo reset by template copy with a date shift

- **Context:** reviewers need realistic, current-looking data and must be able to reset it in seconds without breaking each other's demo chains.
- **Decision:** a deterministic generator writes a 90-day simulation to a `demo_seed` schema once. `apply_seed` truncates the operational tables, copies the template back with every date shifted to today, rebuilds balances from moves, and checks invariants and the planted scenarios.
- **Why:** a reset takes under 3 s and always looks like "today". The planted codes stay stable across resets, so the README and tests can rely on them.
- **Trade-off:** triggers are disabled during the copy, so the reset must re-check everything itself. Any schema change needs `pnpm seed:gen`, or the reset refuses with `DEMO_TEMPLATE_STALE`.

## 9. Page reads verify the JWT locally; demo-guard runs every 2 hours

- **Context:** each page needs the user's profile before its data, which cost two sequential calls (Auth `getUser`, then the profile). The demo logins are shared, and visitors can change their passwords.
- **Decision:**
  - Pages use `auth.getClaims()`. With production's asymmetric signing keys this verifies the JWT locally, so a page needs at most 2 sequential Supabase round trips. Server actions still call `getUser()` before every write (`SESSION_CHANGED`).
  - The demo-guard Action repairs broken logins every 2 hours, not every 30 minutes as SPEC §16 first said, and the login page says "every 2 hours".
- **Why:** pages load faster on Indian mobile networks. The repo stays private, where Actions minutes are limited, and 2-hourly runs (with the 6-hourly reseed and health ping) stay within the free tier.
- **Trade-off:**
  - A JWT revoked elsewhere stays valid for page reads until it expires (≤ 1 hour). Writes still re-check with Auth.
  - Locally, with a symmetric key, `getClaims()` still calls Auth.
  - A changed demo password can stay broken for up to 2 hours; the login page tells visitors to try another role.
