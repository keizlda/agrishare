# Capstone review suggestions — implementation report

Branch `feature/review-suggestions` (not deployed yet). Roles are unchanged:
MAO Admin (web), Farmers' Association President (web), Farmer (mobile).
Harvest monitoring was not part of this work.

Every rule below is enforced by the database (row-level security, triggers or
database functions), not only by hiding buttons.

## Design changes (for the panel)

- **Quantities follow farm size.** A farmer's quantity in a distribution is
  farm size × the commodity's allocation per hectare, capped at an optional
  maximum per farmer and rounded to 2 decimals. Starting rates: **Rice Seeds
  40 kg/ha in 20 kg bags** (1.25 ha → 50 kg = 2.5 bags) and **Hybrid Rice
  Seeds 15 kg/ha**. Other commodities have no rate and keep the equal split.
  The MAO Admin may change a farmer's quantity, but it is then marked
  **Adjusted** and needs a short reason, which is saved and audit-logged.
- **Both staff roles see all farmer requests** from the moment they are
  submitted, in every status, with the full timeline. Each still acts only at
  their own step: the Farmers' Association President endorses (or not), and
  the MAO Admin approves or rejects endorsed requests.
- **The Farmers' Association President files requests on farmers' behalf**
  (for farmers without a phone). These go straight to the MAO as Endorsed and
  are tagged "Filed by Farmers' Association President".
- **The Farmers' Association President sends association requests**
  (machinery, projects, other support) to the MAO, who marks them Under
  review, Approved or Rejected.

## Phase 1: distribution auto-fill and allocation by hectare

Commit `1a2f711`.

- **Commodities.** Allocation per Hectare (shown as kg/ha), Pack Size (kg per
  bag) and Maximum per Farmer were added to the inline edit and the details.
  Each is optional, must be above 0, and allows at most 2 decimals.
- **Picking a farmer** in New/Edit Distribution fills in their name, RSBSA
  no., sitio/purok, barangay, crop, farm size, status and computed quantity,
  with bags when the commodity has a pack size ("50 kg (2.5 bags)").
- **Adjusted quantities.** A changed quantity shows an "Adjusted" tag, the
  computed value and a required reason box. The database refuses a changed
  quantity that has no reason.
- **Commodities without a rate** keep the equal split and show the hint "Set
  an allocation per hectare in Commodities to compute this automatically."
- **Changing the commodity** recomputes the rows that weren't adjusted. On the
  database side, the tagged farmers now move to the new commodity; before,
  they stayed under the old one.
- **Total** is the read-only, live sum of the rows.
- **Add all eligible farmers** adds Active farmers whose crop matches the
  commodity's category. It skips farmers who already got that commodity under
  the same program this year and shows how many were added and skipped.
- **Kept:** the duplicate-distribution warning and the confirmation before
  tagging an inactive farmer.
- **Details panel and printed report (page 2):** a Farm Size (ha) column next
  to the quantity, and bags where the commodity has a pack size.
- **Older distributions** keep their saved quantities ("as saved before").
  Re-saving one unchanged needs no reasons.

**Migrations:**
- `20261121000000_commodity_allocation.sql`
- `20261121000100_allocation_by_farm_size.sql`

On live, the first one fills the new rate columns of "Rice Seeds (NSIC
Rc222)" (40 kg/ha, 20 kg bags) and adds a "Hybrid Rice Seeds" commodity
(15 kg/ha). No other commodity changes.

**Files:**
- `web/src/lib/allocation.js` (new)
- `web/src/pages/Commodities.jsx`
- `web/src/pages/Distributions.jsx`
- `web/src/pages/PrintDistribution.jsx`
- `web/src/lib/api/commodities.js`, `distributions.js`, `farmers.js`
- `web/src/theme.css`, `web/src/components/print/print.css`

## Phase 2: both roles see every farmer request

Commit `0f3e4e4`.

- **Requests page:** status filters (All, Pending, Endorsed, Not endorsed,
  Approved, Rejected, with counts) and search by farmer name, RSBSA no. or
  commodity.
- **Pending requests for the MAO Admin** are read-only, with the note
  "Waiting for the Farmers' Association President's endorsement."
- **Details:**
  - The farmer's farm size and crop.
  - The suggested quantity for their farm size, when the commodity has a rate.
  - A timeline: submitted by whom and when, endorsed / not endorsed by whom
    and when with remarks, approved / rejected by whom and when with notes.
- **Reading pending requests** was already allowed for the MAO Admin. The
  database still lets the MAO decide only Endorsed requests.
- **Spoofing fix.** Who decided and when is now stamped by the database from
  the signed-in user and the server clock. Before, the browser's values were
  trusted, so a decision could be recorded under someone else's name.
- **Dashboard:** the "requests to review" chip opens the right filter.

**Migration:** `20261121000200_request_decision_stamps.sql`

**Files:**
- `web/src/pages/Requests.jsx`
- `web/src/components/requests/RequestTimeline.jsx` (new)
- `web/src/lib/requestStatus.js` (new)
- `web/src/lib/api/requests.js`
- `web/src/pages/Dashboard.jsx`
- `web/src/theme.css`

## Phase 3: association requests

Commit `60efd3b`.

- **New table `association_requests`:**
  - Type: Machinery, Project or Other.
  - Title, description / justification, item (free text with suggestions),
    quantity, estimated beneficiaries and preferred date.
  - Optional image or PDF attachment, up to 5 MB, in a private bucket.
  - Status: Pending, Under review, Approved or Rejected.
  - Requested by, reviewed by / at, admin remarks, created / updated /
    cancelled times.
- **Farmers' Association President:** creates requests, sees only their own,
  and can edit or cancel one only while it is Pending.
- **MAO Admin:** sees all requests and marks them Under review, Approved or
  Rejected. Remarks are required to reject, and a decided request is final.
- **Farmers:** no access.
- **Rules:**
  - The preferred date must be from today up to 2 years ahead.
  - The attachment must be in the requester's own folder.
- **Audit and notifications:** every change is audit-logged. The MAO is
  notified of new requests, and the Farmers' Association President of every
  status change (with the remarks).
- **Requests page:** "Farmer Requests" and "Association Requests" tabs. The
  Accomplishment Report counts association requests by type and status
  within its date range.

**Migration:** `20261121000300_association_requests.sql`

**Files:**
- `web/src/lib/api/associationRequests.js` (new)
- `web/src/components/requests/AssociationRequestsView.jsx` (new)
- `web/src/components/requests/AssociationRequestModal.jsx` (new)
- `web/src/pages/Requests.jsx`
- `web/src/pages/PrintReport.jsx`
- `web/src/components/ui/Pill.jsx`
- `web/src/theme.css`

## Phase 4: the Farmers' Association President files a farmer request

Commits `35b0c43` and `6c5af17`.

- **"Add Farmer Request" form:**
  - Search a farmer by name or RSBSA no.; their farm data fills in.
  - Choose a commodity. The quantity is prefilled with the suggested
    allocation and can be changed back with "Use 50 kg".
  - A reason is required.
- **Warnings:**
  - When the farmer already has a Pending or Endorsed request for the same
    commodity.
  - When the farmer is Inactive.
- **What it saves:** `filed_by` set to the Farmers' Association President.
  The request goes straight to the MAO as Endorsed.
- **Notifications:** the MAO is notified, and the farmer is told it was filed
  for them.
- **Tag "Filed by Farmers' Association President"** appears in the web list
  and details and in the farmer's mobile request history.
- **Database rules:**
  - Only the Farmers' Association President can file for another farmer, and
    never for a removed farmer.
  - A farmer can't fake `filed_by`.
  - Filed requests can't be changed afterwards except by the MAO's decision.

**Migration:** `20261121000400_requests_filed_by_fa.sql`

**Files:**
- `web/src/components/requests/FarmerRequestModal.jsx` (new)
- `web/src/pages/Requests.jsx`
- `web/src/lib/api/requests.js`
- `web/src/theme.css`
- `mobile/src/lib/api/requests.js`
- `mobile/src/screens/RequestsScreen.js`

## Phase 5: test data, checks and report

Commit `2b82410` (this report follows it).

**Seed (`backend/scripts/seed-test-data.mjs` and `agrishare-test-data.json`):**
- Allocation rates for Rice Seeds and Hybrid Rice Seeds.
- One Ongoing distribution whose quantities follow farm size, with one
  adjusted row and its reason.
- Requests filed by the Farmers' Association President for Maui Pelaez,
  Claude Oclarit, Luna Cuizon and one seeded farmer (Endorsed, Approved and
  Rejected). These are new request rows; the farmers' own records are only
  referenced.
- Four association requests, one in each status.

**Cleanup (`backend/scripts/cleanup-test-data.mjs`)** also removes:
- requests filed by the test Farmers' Association President;
- their association requests and attachments;
- the audit entries about them.

Run the seed and cleanup only after the new migrations are live.

## Permission matrix (new features)

"DB" means the database refuses the action, not only that the button is hidden.

| Feature | MAO Admin | Farmers' Association President | Farmer |
| --- | --- | --- | --- |
| Set allocation per hectare / pack size / maximum | Yes | No (DB: RLS) | No (DB: RLS) |
| Distribution quantities from farm size, Adjusted + reason | Yes (DB: reason required) | No (DB: save_distribution MAO only) | No |
| "Add all eligible farmers" lookup | Yes | No (DB returns nothing) | No (DB returns nothing) |
| Read another farmer's farm size | Yes | Yes | No (DB: RLS) |
| See all farmer requests, every status, timeline | Yes | Yes | Own only (DB: RLS) |
| Endorse / not endorse a Pending request | No (DB: RLS) | Yes | No |
| Approve / reject an Endorsed request | Yes | No (DB: RLS) | No |
| Record a decision under another name or date | No (DB: stamped) | No (DB: stamped) | No |
| File a farmer request on a farmer's behalf | No (DB: RLS) | Yes (goes straight to Endorsed) | Own requests only (DB: stays Pending, filed_by cleared) |
| Create an association request | No (DB: RLS) | Yes (always starts Pending) | No (DB: RLS) |
| See association requests | All | Own only (DB: RLS) | No (DB: RLS) |
| Edit / cancel an association request | No (DB: guard) | Own, while Pending (DB: RLS + guard) | No |
| Mark under review / approve / reject an association request | Yes (reject needs remarks; decided is final) | No (DB: guard) | No |
| Upload an association attachment | No (DB: storage policy) | Own folder (image/PDF, 5 MB) | No |
| View association attachments | All | Own | No |
| Accomplishment Report with association counts | Yes | No (page MAO only) | No |

## How to test each role (after deploy)

**MAO Admin**
1. **Commodities.** Open Rice Seeds and check it shows 40 kg/ha and 20 kg per
   bag. Edit it, type -5 and check it is refused, then put 40 back.
2. **New Distribution.**
   1. Choose Rice Seeds and enter a program name.
   2. Pick a farmer. Check the row shows RSBSA, sitio/purok, crop, farm size,
      status and quantity (e.g. 1.25 ha → 50 kg (2.5 bags)).
   3. Change the quantity. "Adjusted" and a reason box appear, and Save is
      refused until you give a reason.
   4. Click "Add all eligible farmers" and read the added/skipped line.
   5. Switch to Hybrid Rice Seeds: quantities recompute at 15 kg/ha.
   6. Switch to Corn Seeds: the equal split and the hint come back.
3. **Saved distribution.** The details show Farm Size (ha), bags, the Adjusted
   tag and the reason. Print it; page 2 shows Farm Size (ha).
4. **Requests → Farmer Requests.**
   1. Open a Pending request: it is read-only with the waiting note.
   2. Open an Endorsed one: check the timeline and the suggested quantity,
      then approve it with notes.
   3. Requests filed by the Farmers' Association President carry the tag.
5. **Requests → Association Requests.**
   1. Try Reject without remarks; it is refused.
   2. Mark a request under review, then approve it with remarks.
6. **Reports → Accomplishment Report.** It counts association requests by type
   and status.

**Farmers' Association President**
1. **Distributions:** no New Distribution, Edit or "Add all eligible farmers";
   Farm Size (ha) is shown in the details.
2. **Farmer Requests.**
   1. All statuses are visible.
   2. Endorse a Pending request; the timeline shows your name and the time.
   3. An Endorsed request is read-only for you.
3. **Add Farmer Request.**
   1. Pick a farmer and Rice Seeds; the quantity is prefilled from farm size.
   2. You are warned if the farmer already has an open request for it.
   3. File it: it appears as Endorsed with the tag.
4. **Association Requests.**
   1. Create a request with a PDF quotation.
   2. Edit it while Pending, and cancel another one.
   3. Once the MAO marks it under review, editing is gone. You receive a
      notification for each status change.

**Farmer (mobile)**
1. Open Commodity Requests. A request the Farmers' Association President filed
   shows "Filed by Farmers' Association President", and the notification "A
   request was filed for you" arrives.
2. The farmer's own new request still goes to the Farmers' Association
   President as Pending.

## Checks run (all on local copies; nothing was written to the live database)

**Database (PGlite replay of every migration):**
- 74 checks for this work: Phase 1: 21, Phase 2: 10, Phase 3: 24, Phase 4: 13,
  seed/cleanup writes: 6.
- The earlier 42-check security/validation suite still passes.

**Web (mock back end):** 117 browser checks.
- Phase 1: 31, Phase 2: 25, Phase 3: 29, Phase 4: 19, permission/layout
  sweep: 13.
- Validation: invalid inputs, past and far-off dates, renamed and oversized
  files, missing reasons.
- No internet: plain messages, and the form is kept.
- Double-clicks save once.
- Layouts at 1366×768, 1920×1080, 412 px and 360 px: no sideways scrolling.

**Mobile:**
- The request history with the new tag was checked at 360 px and 412 px.
- The Android bundle builds.

**Web lint and build:** lint shows no new warnings (the 4 older ones remain),
and the production build passes.

**Read-only checks on live:**
- Which commodities get starting rates.
- That signed-in users can call `auth.uid()`, which the new triggers need.

## Deploying (when you say "deploy")

1. **Database:** `npx supabase db push`. The five new migrations run in order.
2. **Web:** deploy to Vercel and alias agrishare.vercel.app.
3. **Mobile: an OTA update is enough, no new APK.** Only two JavaScript files
   changed (`requests.js` and `RequestsScreen.js`). No native modules, no
   app.json changes, and the runtime version stays 1.0.0. Publish with
   `eas update --branch production`.
4. **Test data (optional):** re-run `node scripts/seed-test-data.mjs`. It adds
   only the new items; everything already seeded is skipped.

## Things to know

- **Large farms get large suggestions.** Maui Pelaez's record says 65 ha, so
  the suggested Rice Seeds quantity is 2,600 kg. Set a Maximum per Farmer on
  the commodity if the MAO wants a cap.
- **Older requests** made before decision stamping keep the reviewer saved
  with them.
- **Seeded association request dates.** Their preferred dates are in
  January–March 2027. The database refuses dates in the past, so if the seed
  is re-run after those dates, move them later in `agrishare-test-data.json`
  first.
