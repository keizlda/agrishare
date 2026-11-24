# AgriShare

## Live vs. local (until the owner says "deploy to live")

- `release/live` is what the live site runs (`main` follows it). New work
  goes on `develop` and runs only on localhost against the development
  database **agrishare-dev** (see README.md).
- Until the owner says "deploy to live": no Vercel production deploys, no
  EAS over-the-air updates, and no migrations or data changes on the live
  Supabase project (bofvqdywhyrlbzatvxve). The deploy steps are in README.md.
- Local apps use `web/.env.local` and `mobile/.env.local` (dev). The live
  keys are only in Vercel (Production env vars) and EAS (`production`
  environment).

## Git workflow

Auto-push is on for this repo: after finishing the changes for each user
request, stage, commit, and push to `origin/develop` without waiting to be
asked. Only skip this when there's nothing to commit (a question was
answered, no files changed) or when a change is clearly a work-in-progress
step the user is still iterating on within the same request. Don't commit
to `release/live` or `main` except as part of "deploy to live".

## Database checks

To inspect a database, run `node backend/scripts/db-query.mjs "<sql>"`
(reads `SUPABASE_ACCESS_TOKEN` from the gitignored `.env.deploy`; prints
JSON). Without a prefix it targets the **live** project; with
`AGRISHARE_DB=dev` it targets agrishare-dev. Use it when debugging instead
of asking the user to run SQL in the dashboard.

- Read-only queries (SELECT, `pg_policies`, grants, function definitions):
  run freely on either.
- Schema changes: write a migration in `backend/supabase/migrations/` and
  apply it to agrishare-dev with `npx supabase db push --remote` (the CLI
  is linked to agrishare-dev) — never ad-hoc DDL through the script. Live
  gets migrations only when the owner says "deploy to live".
- Destructive statements on live data (DELETE, broad UPDATE, DROP,
  TRUNCATE): show the statement to the user and wait for an OK first.
- Never print the access token.
