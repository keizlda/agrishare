# AgriShare

Web system (MAO Admin, Farmers' Association President), farmer mobile app and
Supabase backend for the Municipal Agriculture Office of Labangan.

| Folder | What |
| --- | --- |
| `web/` | React + Vite web system (live at https://agrishare.vercel.app) |
| `mobile/` | Expo farmer app (updates over the air on the EAS `production` channel) |
| `backend/supabase/` | Database migrations and the `manage-farmer-account` function |
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
| Farmers' Association President, Langapud | `fapresident@agrishare.test` |
| Farmers' Association President, Bagalupa | `fapresident.bagalupa@agrishare.test` |
| Farmer, Langapud / Bagalupa (mobile) | login ID `000201` / `000226` |

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

Rolling the web back: `npx vercel promote <older-deployment-url>` (or
`vercel alias set` to it). Every production deployment stays listed in
`npx vercel ls`.
