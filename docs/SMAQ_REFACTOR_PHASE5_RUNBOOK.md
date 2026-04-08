# ABA Refactor - Phase 5 Runbook

## 1) Migracion de saldos historicos (SMAQ_TRANSACTIONS -> citizens)

Script:

```bash
npm run migrate:smaq-balances -- --dry-run
```

Apply real migration:

```bash
npm run migrate:smaq-balances -- --apply
```

Useful flags:

- `--mode=max` (default): keeps the greater value between `citizens.dracma_balance` and Google Sheet reconstructed balance.
- `--mode=sheet`: forces balance to match reconstructed Sheet balance (clamped to `>= 0`).
- `--email=user@example.com`: migrate one user.
- `--limit=50`: process first N users.
- `--no-mark-zero`: do not insert migration marker transaction when delta is `0`.
- `--sheet=DRACMAS`: alternate source if legacy rows are in `DRACMAS` instead of `SMAQ_TRANSACTIONS`.

How idempotency is handled:

- The script writes a marker transaction in `dracma_transactions.description`:
  - `[migration:smaq_transactions] ...`
- If a citizen already has a marker, that user is skipped.
- `--dry-run` is read-only: it does not create citizens, and reports `plannedCitizenCreates` in summary.

## 2) Auditoria de logs (Supabase vs SMAQ_LOG)

Script:

```bash
npm run audit:smaq-log
```

Optional flags:

- `--days=14` (default): time window in days for Supabase transactions.
- `--tx-limit=200`
- `--log-limit=500`
- `--sheet=SMAQ_LOG`
- `--sheet=DRACMAS` if ABA logs are still being written in the old tab.

What it reports:

- number of Supabase transactions checked
- number of sheet rows checked
- matched entries
- missing entries
- coverage percentage
- if the sheet does not exist, it fails with an explicit message including the spreadsheet id.

## 3) Consolidacion users vs citizens (evaluacion)

Current state:

- `public.users` (Amorina): app profile, membership_level legacy, references from `purchases` and `magazine_orders`.
- `public.citizens` (Aquilea): identity + membership_type + DRACMA/ABA balance.

Recommendation:

1. Keep `citizens` as source of truth for identity + membership + wallet.
2. Keep `users` temporarily as compatibility table only while dependent flows migrate.
3. Expose a unified read model (`view`) to remove duplication in application code.
4. Migrate FK usage from `users(id)` to `auth.users(id)` or `citizens(auth_id)` depending on domain.
5. Decommission `users` once all writers/readers are moved.

Pre-migration diagnostics (run in SQL editor):

```sql
-- Mismatch by auth id
SELECT
  COALESCE(u.id, c.auth_id) AS auth_id,
  u.email AS users_email,
  c.email AS citizens_email,
  u.membership_level,
  c.membership_type,
  c.dracma_balance
FROM public.users u
FULL OUTER JOIN public.citizens c ON c.auth_id = u.id
WHERE
  u.id IS NULL
  OR c.auth_id IS NULL
  OR LOWER(COALESCE(u.email, '')) <> LOWER(COALESCE(c.email, ''))
ORDER BY auth_id;

-- Rows that exist in users but not in citizens
SELECT u.id, u.email, u.membership_level
FROM public.users u
LEFT JOIN public.citizens c ON c.auth_id = u.id
WHERE c.id IS NULL;
```

Transitional unified view suggestion:

```sql
CREATE OR REPLACE VIEW public.user_profile_unified AS
SELECT
  au.id AS auth_id,
  COALESCE(c.email, u.email, au.email) AS email,
  COALESCE(c.name, u.name, au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name') AS name,
  COALESCE(c.avatar_url, u.avatar_url) AS avatar_url,
  c.membership_type,
  c.dracma_balance,
  u.membership_level AS legacy_membership_level,
  u.is_admin
FROM auth.users au
LEFT JOIN public.users u ON u.id = au.id
LEFT JOIN public.citizens c ON c.auth_id = au.id;
```

## 4) Endpoint cleanup status

`api/smaq/charge.ts` and `api/smaq/credit.ts` were simplified to:

- share CORS + wallet helper logic in `api/smaq/_endpoint-utils.ts`
- avoid duplicated wallet sync code
- normalize email and amount parsing consistently
- return proper error response when credit operation fails
