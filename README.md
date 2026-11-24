# AgriShare

Web system (MAO Admin, Farmers' Association President), farmer mobile app and
Supabase backend for the Municipal Agriculture Office of Labangan.

| Folder | What |
| --- | --- |
| `web/` | React + Vite web system (live at https://agrishare.vercel.app) |
| `mobile/` | Expo farmer app (updates over the air on the EAS `production` channel) |
| `backend/supabase/` | Database migrations and the `manage-farmer-account` and `manage-fa-account` functions |
| `backend/scripts/` | Test data, cleanup and database query scripts |

## Branches: what is live and what is local

- **`release/live`** is exactly what the live site runs (`main` follows it).
- **`develop`** holds newer work. It runs only on your computer, against the
  development database **agrishare-dev**, a separate Supabase project. Nothing
  on `develop` reaches the live site, the live database or the farmers'
  phones until it is deployed to live (steps below).

## Run locally against the development database

The local settings files are gitignored and already point to agrishare-dev:
`web/.env.local`, `mobile/.env.local`, `backend/.env.seed.dev` and the
repo-root `.env.dev` (the dev project's ref and database password). The live
keys are kept only in Vercel (Production environment variables) and EAS
(`production` environment), so a local run can't touch live data.

```bash
git switch develop

# Web: http://localhost:5173
cd web && npm install && npm run dev

# Farmer app: Expo Go on a phone, or add --web for the browser preview
cd mobile && npm install && npx expo start
```

Development accounts (agrishare-dev only; password `password123`):

| Role | Sign in with |
| --- | --- |
| MAO Admin | `admin@agrishare.test` |
| Farmers' Association President, Langapod | `fapresident@agrishare.test` |
| Farmers' Association President, Bagalupa | `fapresident.bagalupa@agrishare.test` |
| Farmers' Association President, Bokong | `fapresident.bokong@agrishare.test` |
| Farmers (mobile), by barangay | Langapod `000201`–`000225`, Bagalupa `000226`, Bokong `000227`–`000228`, Combo `000229`–`000230`, New Labangan `000231`–`000232` |

### Barangays and accounts

- The `barangays` table holds the 25 official barangays of Labangan
  (Settings > Lists). A renamed barangay keeps its old names in
  `former_names` (Langapud → Langapod), so records typed with the old name
  still match it.
- Each Farmers' Association President belongs to exactly one barangay and
  sees only that barangay's data. The database enforces this (row-level
  security on every table and photo bucket), not just the screens.
- The MAO Admin creates Farmers' Association President accounts and assigns
  or changes their barangay in Settings > Farmers' Association Presidents
  (the `manage-fa-account` function makes the account and a temporary
  password).
- An account's role comes only from its **app_metadata** (which only the
  server can set), never from sign-up data. An account made by hand in the
  Supabase dashboard needs `app_metadata.role` (`mao_admin` or
  `fa_president`) and, for a Farmers' Association President,
  `app_metadata.barangay_id`; without a role it is a farmer.

Database work on the development database:

```bash
# Schema change: add a file to backend/supabase/migrations, then
# (the Supabase CLI is linked to agrishare-dev)
cd backend && npx supabase@3.2.0 db push --remote --password "<SUPABASE_DEV_DB_PASSWORD from .env.dev>"

# Test data: a dev MAO Admin and stand-ins, then the seed
AGRISHARE_DB=dev node backend/scripts/dev-setup.mjs
AGRISHARE_DB=dev node backend/scripts/seed-test-data.mjs

# Look at data
AGRISHARE_DB=dev node backend/scripts/db-query.mjs "select * from barangays"
```

Without `AGRISHARE_DB=dev`, the scripts target the **live** project
(`db-query.mjs` for read-only checks only).

## Deploy to live

Only when the owner says "deploy to live". Tokens come from the gitignored
`.env.deploy` (`set -a && . ./.env.deploy && set +a`).

1. **Code:** `git switch release/live && git merge --ff-only develop`, then
   `git switch main && git merge --ff-only release/live`; push both branches.
2. **Database:** check, then apply the new migrations to the live project:
   ```bash
   cd backend
   npx supabase@3.2.0 db push --remote=bofvqdywhyrlbzatvxve --password "" --dry-run
   npx supabase@3.2.0 db push --remote=bofvqdywhyrlbzatvxve --password "" --yes
   ```
   Before the farmer-types migration (`20261126000000`), fix the live
   farmers whose contact numbers have spaces (listed in
   docs/testing/mao-presentation-report.md): after it, changing those
   records asks for an 11-digit number first.
   Then deploy any new or changed functions (the barangay release adds
   `manage-fa-account`):
   ```bash
   npx supabase@3.2.0 functions deploy manage-fa-account --remote=bofvqdywhyrlbzatvxve --use-api --yes
   ```
3. **Test data on live (if the release adds any):** `node backend/scripts/seed-test-data.mjs`.
4. **Web** (from `release/live`; Vercel builds it with its Production environment variables):
   ```bash
   cd web
   npx vercel --prod --token "$VERCEL_TOKEN" --yes
   npx vercel alias set <deployment-url> agrishare.vercel.app --token "$VERCEL_TOKEN"
   ```
5. **Farmer app** (over the air; the `production` environment holds the live keys):
   ```bash
   cd mobile
   npx eas-cli update --branch production --platform android --environment production --non-interactive --message "<what changed>"
   ```
6. **Check:** open every page on https://agrishare.vercel.app with the test
   accounts and the farmer app with a test farmer.

### A new APK link (no live change)

EAS keeps a build's APK for about two weeks. For a fresh download link of
the app exactly as it is live, build from `release/live` (in a separate
worktree, so `develop` isn't packaged) with the `preview` profile. It uses
the live keys and the `production` update channel. A build doesn't publish
anything; installed phones are not affected.

```bash
git worktree add --detach ../agrishare-live release/live
cd ../agrishare-live/mobile && npm ci
npx eas-cli build --platform android --profile preview --non-interactive --no-wait
```

Rolling the web back: `npx vercel promote <older-deployment-url>` (or
`vercel alias set` to it). Every production deployment stays listed in
`npx vercel ls`.
