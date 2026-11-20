# AgriShare

## Git workflow

Auto-push is on for this repo: after finishing the changes for each user
request, stage, commit, and push to `origin/main` without waiting to be
asked. Only skip this when there's nothing to commit (a question was
answered, no files changed) or when a change is clearly a work-in-progress
step the user is still iterating on within the same request.

## Live database checks

To inspect the live Supabase database, run
`node backend/scripts/db-query.mjs "<sql>"` (reads `SUPABASE_ACCESS_TOKEN`
from the gitignored `.env.deploy`; prints JSON). Use it when debugging
instead of asking the user to run SQL in the dashboard.

- Read-only queries (SELECT, `pg_policies`, grants, function definitions):
  run freely.
- Schema changes: write a migration in `backend/supabase/migrations/` and
  apply it with `npx supabase db push` — never ad-hoc DDL through the script.
- Destructive statements on live data (DELETE, broad UPDATE, DROP,
  TRUNCATE): show the statement to the user and wait for an OK first.
- Never print the access token.
