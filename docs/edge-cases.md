# Edge cases and the tests that cover them

Each edge case named in docs/SPEC.md §5–§8 and §11–§15, with the test that covers it, or **not covered**. Test names are `file › test title`. `db/` is `tests/db` (Vitest against local Supabase), `unit/` is `tests/unit`, `e2e/` is `tests/e2e` (Playwright).

Every DB test also checks `private.check_invariants()` in `afterEach`, so the §4 invariants are re-checked after every case below.

## §5 Bike and job card lifecycle

| Edge case | Covered by |
|---|---|
| Status change outside §5.1 raises INVALID_TRANSITION | db/triggers › raises INVALID_TRANSITION for a status change outside SPEC §5.1 |
| at_workshop needs arrived_at; in_repair needs a confirmed card | db/triggers › allows purchased -> at_workshop only with arrived_at; › requires a confirmed job card for at_workshop -> in_repair |
| An UPDATE never overwrites a set timestamp | db/triggers › never overwrites a set timestamp…; db/job-cards › enforces purchased -> at_workshop -> in_repair and never overwrites timestamps |
| workshop_id never changes | db/triggers › keeps workshop_id fixed |
| mfg_year outside the variant years or 1995..IST year | db/triggers › raises MFG_YEAR_OUT_OF_RANGE… |
| Variant of another model | db/triggers › rejects a variant of another model |
| Duplicate active reg no; reuse after cancel | db/triggers › keeps reg_no_norm unique…; db/job-card-lifecycle › rejects a duplicate active reg no and allows it after the first bike is cancelled |
| Confirm with unresolved findings → UNRESOLVED_FINDINGS | db/job-cards › refuses with UNRESOLVED_FINDINGS, then confirms… |
| needed_by default: arrival date, or purchase + 2 in transit; kept if set | db/job-cards › defaults needed_by…; › keeps a needed_by set before confirm |
| Card with no live lines is complete at confirm | db/job-cards › marks a card with zero lines complete at confirm |
| Findings locked while confirmed; unlocked when cancelled | db/triggers › are locked while the bike has a confirmed card; › unlock when the card is cancelled; db/job-cards › locks findings and draft edits once the card is confirmed |
| Draft edits regenerate suggested lines and keep manual ones | db/job-cards › update_draft_findings regenerates…; › set_bike_variant regenerates… |
| Store keeper extra line needs a reason; manager line clears needs_review | db/job-card-lifecycle › lets a store keeper add an extra part…; › clears needs_review_reason only for a manager's line… |
| set_line_qty below net_issued → RETURN_PARTS_FIRST; 0 cancels | db/job-card-lifecycle › decrease releases…, 0 cancels; › refuses below net_issued… |
| reallocate_reservation validation | db/job-card-lifecycle › validates qty, part, workshop, card state and role |
| Cancel card with issued parts → ISSUED_PARTS_OUTSTANDING | db/job-card-lifecycle › refuses to cancel while parts are issued; db/issue-returns › refuses set_line_qty, cancel_job_card and cancel_bike while parts are issued… |
| Close with open lines → OPEN_LINES; drop_remaining | db/job-card-lifecycle › lists open lines, then drop_remaining closes… |
| Close refused while needs_review_reason is set unless dropping | db/job-card-lifecycle › refuses with OPEN_LINES while needs_review_reason is set unless dropping |
| create_job_card after cancel relinks findings; refused for ready bikes | db/job-card-lifecycle › cancels, re-creates a card from the findings, and refuses ready bikes |
| parts_complete_at goes null and back after reallocation | db/reports › uses the final completion time when a card goes incomplete and complete again |

## §6 Allocation

| Edge case | Covered by |
|---|---|
| Partial reservation when short; second confirm changes nothing | db/job-cards › reserves free stock, partially when short… |
| FIFO by needed_by; set_needed_by affects only future allocations | db/job-cards › allocates new stock FIFO by needed_by… |
| Reservations kept, released and re-allocated FIFO as stock moves | db/job-card-lifecycle › keeps, releases and re-allocates reservations FIFO as stock moves |
| dereserve_excess in reverse FIFO after adjust_out / quarantine | db/job-card-lifecycle › keeps, releases and re-allocates reservations FIFO… |
| Reservations only on confirmed cards | db/triggers › allow reservations only on confirmed cards |
| Concurrent confirm and GRN on the same parts | **not covered** |

## §7 Purchasing

| Edge case | Covered by |
|---|---|
| Negative projection; model-specific is always on-demand | db/purchasing › orders an auto part up to max from a negative projection…; › treats a model-specific part as on-demand… |
| avg_daily_issue as numeric, 28 complete IST days | db/purchasing › averages 28 complete IST days…; unit/reorder › averages slow movers without integer division… |
| Fewer than 7 days of history → ROP = safety stock | unit/reorder › uses ROP = safety stock with fewer than 7 days of history |
| Generation is idempotent | db/purchasing › is idempotent: a second run keeps the same POs and lines… |
| **Two concurrent generate_draft_pos** | db/purchasing › SPEC §17: two concurrent runs leave the same POs and lines as one run |
| Manual lines survive regeneration; removed suggested line comes back | db/purchasing › keeps a manually edited line…; › brings a removed suggested line back… |
| No supplier → unsourced, no line | db/purchasing › lists a part with no supplier as unsourced… |
| Send with missing price / no lines → PO_NOT_SENDABLE; frozen after send | db/purchasing › refuses a PO with a missing price or no lines…; › sends a draft…, then freezes it except for expected_on |
| expected_on from the IST date of sending | db/purchasing › computes expected_on from the IST date of sending |
| Over-receipt rejects the whole GRN with detail | db/purchasing-receipts › refuses an over-receipt with detail and posts nothing |
| Damaged / wrong units stay owed | db/purchasing-receipts › accepts received − damaged − wrong into receiving and keeps rejected units owed; › stays sent after a rejected-only GRN |
| Duplicate invoice in the same financial year | db/purchasing-receipts › rejects a duplicate invoice in the same financial year unless allowed |
| Receiving a draft, cancelled or closed PO → PO_NOT_RECEIVABLE | db/purchasing-receipts › refuses POs that are draft, cancelled or closed… |
| Price variance ≥ 5% flags but never blocks; emergency buys never set last price | db/purchasing-receipts › stores the invoice price, flags a 5% variance…; unit/purchasing › flags exactly 5% either way |
| PO status derivation (received / closed / cancelled / partial) | db/purchasing-receipts › derives received…; › derives closed…; › derives cancelled… |
| Cancel after anything accepted → ALREADY_RECEIVED | db/purchasing-receipts › cancels a draft by deleting it…, and refuses once anything was accepted |
| Overdue PO still counts as on order | db/purchasing-receipts › does not reorder a shortfall covered by a sent PO, even overdue… |
| ETA pegging by running totals | db/purchasing-receipts › pegs waiting lines to POs in FIFO order by running totals |
| Excess on order never shows what generation just suggested | db/purchasing-receipts › lists supply left over after demand disappears… |

## §8 Issue, returns, emergency buys

| Edge case | Covered by |
|---|---|
| Never issue the last unit reserved for another bike | db/issue-returns › test 1: never issues the last unit reserved for another bike |
| **Last unit issued by two store keepers at once** | db/issue-returns › SPEC §17: two store keepers issuing the last unit at once make exactly one issue |
| More than the reservation → INSUFFICIENT_RESERVATION with holders | db/issue-returns › test 3: refuses more than the line's reservation… |
| Allocate free stock before checking the reservation | db/issue-returns › allocates free stock to the line before checking the reservation |
| Bin kind, card state, bike state, line state, other workshop | db/issue-returns › test 4: bin stock and kind, card, bike and line state, workshop |
| Each return reason (not_needed, issued_by_mistake, damaged, wrong_fitment) | db/issue-returns › return_from_job_card (5 tests) |
| Return more than net issued; returns after close | db/issue-returns › refuses more than net issued, bad bins, and closed cards |
| Double-tapped issue makes one move | e2e/issue-return › ready card: double-tapped issue makes one move… |
| Emergency buy: issue vs reservation release, fully issued line, cancelled line | db/emergency-buys › record_emergency_buy: issue and reservations (6 tests) |
| Emergency buy on a draft card or a bike not arrived → stock + warning | db/emergency-buys › records a buy for a bike not arrived or a draft card as stock, with a warning |
| Reference price snapshot chain | db/emergency-buys › snapshots the reference price… |
| Bill photo path / BILL_NOT_FOUND / attach_emergency_bill | **not covered** |
| Concurrent emergency buys on two lines of one card | **not covered** |
| STALE_COUNT when the bin changed since the count loaded | db/stock-rpcs › raises STALE_COUNT… |
| Quarantine rules: reason in, manager out, return to supplier only from QRN | db/stock-rpcs › requires a reason to move into quarantine; › lets only a manager move stock out of quarantine; › returns to the supplier only from the quarantine bin |
| on_hand never negative; balances keep rows at 0 | db/triggers › never let on_hand go negative; › maintain stock_balances and keep rows that reach 0 |

## §11 RPC contract

| Edge case | Covered by |
|---|---|
| Retry with the same request_id returns the stored result | db/foundation › returns null for a new call and the stored result for an identical retry; db/stock-rpcs › returns the stored result for a repeated identical call and posts one move |
| **Concurrent double submit with the same request_id** | db/stock-rpcs › SPEC §17: a concurrent double submit with the same request_id posts one move and both get its result |
| Same request_id, other payload → IDEMPOTENCY_KEY_REUSED | db/foundation › raises IDEMPOTENCY_KEY_REUSED…; db/stock-rpcs › rejects the same request_id with a different payload |
| A failed call stores nothing and can be retried | db/foundation › stores nothing for a call that rolls back; db/stock-rpcs › stores nothing for a failed call… |
| authorize: NOT_AUTHENTICATED, NO_PROFILE, FORBIDDEN, NOT_FOUND | db/foundation › private.authorize (raises %s) |
| Grants, RLS, security_invoker, allowlist | db/security-catalog (12 tests); db/rls (workshop isolation, anon, no-profile user) |
| Error codes list and mapping | unit/errors › is exactly the SPEC §11.4 list; › covers every code the migrations raise |
| Lock timeout / deadlock is retryable | unit/errors › marks %s (lock timeout / deadlock) as retryable |

## §12 Security

| Edge case | Covered by |
|---|---|
| Sign-up and anonymous sign-in are off | db/auth-settings › refuses a self-service sign-up; › refuses an anonymous sign-in |
| Role from profiles only; no metadata in migrations | db/security-catalog › has no migration that mentions user or app metadata; unit/source-guards › src never uses JWT metadata |
| No secret key, cache, float money or date parsing in app code | unit/source-guards (6 patterns) |
| Login buttons map role keys to emails | unit/demo-accounts; e2e/login (5 buttons) |
| User without a profile → /no-access | e2e/login › a user without a profile gets /no-access and can sign out |
| Bills bucket policies | **not covered** |

## §13 Time and money

| Edge case | Covered by |
|---|---|
| 00:10 IST is still the previous UTC day | unit/time › is already the next day at 00:10 IST…; db/reports › buckets an issue at 00:10 IST on 18 Oct… |
| Date-only strings never shift | unit/time › formats a date-only string without a time zone shift |
| Rupee parsing edge cases ('195.5', '1,250', '1.005', '1e3') | unit/money › parses / rejects |
| Non-integer paise refused | unit/money › rejects non-integer paise |

## §14 UI rules

| Edge case | Covered by |
|---|---|
| Store keeper screens at 360 px in en and hi; inputs ≥ 16 px; targets ≥ 48 px; labels | e2e/phone-a11y › store keeper screens fit a 360 px phone in en / hi |
| Manager screens usable on a phone | e2e/job-card › manager screens fit a 360 px phone |
| Wide tables fit a laptop and show a scroll hint on a phone | e2e/metrics › the emergency buys table fits a laptop screen… |
| Request id renewed only after success; SESSION_EXPIRED → login | unit/rpc-form-logic › nextStep (5 tests) |
| Hindi dictionary parity | unit/i18n › hi has exactly the en keys… |
| DB unreachable → "waking up" instead of a digest | unit/health › classifyFailure… (the boundary itself: **not covered** end to end) |

## §15 Seed and demo reset

| Edge case | Covered by |
|---|---|
| Seed is deterministic, under 60,000 rows | unit/seed-determinism; unit/seed-budget |
| Reset under 3 s, no future events, nothing today | db/demo-seed › restores the seed in under 3 s…; › has no event in the future and nothing today |
| Every planted scenario exists per workshop | db/demo-seed › planted scenarios in %s (10 tests) |
| RESET_COOLDOWN; non-admin refused | db/demo-seed › refuses a second reset within the cooldown…; › refuses managers and store keepers with FORBIDDEN |
| New codes continue after the seeded ones | db/demo-seed › creates new codes past the seeded ones… |
| reseed_due: IST hour, idle 24 h, stale anchor | db/reseed-due (5 tests) |
| Two resets at once; reset racing an RPC | **not covered** |
