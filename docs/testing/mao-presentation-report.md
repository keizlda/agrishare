# MAO presentation requests — implementation report

Deployed November 22, 2026: database migrations applied, web app live at
https://agrishare.vercel.app, mobile update published over the air
(Android, `production` branch, update group
`3511912e-1fdb-4b9d-be10-f02c88a92c48`). Commits `fce44a4`, `f0212fc`,
`baafc62`, `18b7a1b` (branch `feature/review-suggestions`, merged into
`main`).

Roles are unchanged: MAO Admin (web), Farmers' Association President (web),
Farmer (mobile). Every rule below is enforced by the database (row-level
security, triggers or database functions), not only by hiding buttons.
Quantities are in kilograms only; no bags or bag sizes are shown anywhere.

## Design changes (for the panel)

- **Commodity types and kg/ha rates are managed by the MAO Admin.** Nothing
  about commodities, types or rates is hardcoded. On the Commodities page the
  MAO Admin adds, edits, sets the default for, and removes types, each with
  its own rate in kg per hectare. Starting values: Rice Seeds · Inbred
  (RCEF) 40 kg/ha (default) and Hybrid 15 kg/ha. The separate "Hybrid Rice
  Seeds" commodity became the Hybrid type. Corn Seeds · Standard 20 kg/ha was
  added as test data. Rate changes are in the Activity Log ("Hybrid: rate
  15.00 → 18.00 kg/ha"). The Farmers' Association President can view rates.
- **Allocation by hectare with a barangay allocation.** A distribution has a
  "Total allocation for the barangay (kg)". Each farmer's quantity is farm
  size × their type's rate (for example 2.00 ha × 15 kg/ha = 30 kg). A
  colored bar shows how much is used (green, amber above 90%, red when over)
  and saving is blocked when the farmers' total is over the allocation.
  Changed quantities need a reason and are marked "Adjusted".
- **Program / type in the farmer profile.** Each farmer can have a program /
  type for their primary crop. It is used for allocations, suggested request
  quantities and harvest reports, and can be filtered on the Farmers page.
- **Farmer requests go straight to the MAO.** The endorsement step is gone.
  A request is Pending until the MAO Admin approves or rejects it (a reason
  is required to reject). The Farmers' Association President sees every
  request at the same time and may add a remark or mark it "Recommended by
  Farmers' Association President" — optional, never a blocker.
- **The Farmers' Association President files requests on a farmer's
  behalf** ("Add Farmer Request") and sends **association requests**
  (machinery, project or other) with the item chosen from a list the MAO
  Admin manages.
- **Harvest reporting in kilograms.** Farmers report harvests from the
  mobile app (season, crop and type, area harvested, kg, harvest date,
  optional geotagged photo). The yield per hectare is computed. The
  Farmers' Association President can report for a farmer. The MAO Admin
  verifies a report or returns it with remarks; a returned report can be
  corrected and resubmitted.
- **RSBSA number first** in the printed beneficiary list and other
  farmer-based reports. Wide reports print landscape.
- **Multi-tab sign-in fix.** If another tab logs out, logs in, or switches to
  a different account, this tab follows instead of acting as the wrong
  account.

## Phase 1: allocation by hectare

- **Commodities page:** "Types / Rate" column; a "Types and rates" list in the
  details with "Last updated [date] by [name]"; inline add / edit / set
  default / remove (with confirmation) for the MAO Admin; Add Commodity takes
  types too. Validation: name required and unique per commodity, rate above 0
  and up to 1,000 with at most 2 decimals. The Farmers' Association President
  can open Commodities (read-only).
- **Farmers page:** Program / type select (types of the farmer's crop, with
  rates), shown in the profile drawer, and a "Filter by program / type".
- **Distributions:** barangay allocation field and bar; rows filled in with
  RSBSA no., name, sitio/purok, farm size, type, quantity and the calculation
  ("2.00 ha × 15 kg/ha"); changing a row's type recomputes it; "Add all
  eligible farmers" stops at the allocation and lists who didn't fit; totals
  overall and per type; each row keeps the rate it was saved with. Editing an
  Ongoing distribution after a rate change asks "Hybrid's rate changed from
  15 to 18 kg/ha. Recompute quantities?" (Recompute / Keep current).
  Completed distributions are never recomputed. Details, reports and the
  printed list show type, farm size, quantity and "Allocation used: X of Y
  kg".
- **Suggested quantities:** farmer requests (mobile) and requests the
  Farmers' Association President files suggest farm size × rate.
- **Migration:** `20261122000000_commodity_types.sql`.

## Phase 2: requests go straight to the MAO

- Statuses are now Pending → Approved / Rejected. Endorsed / Not endorsed
  were removed from badges, filters, dashboard chips, notifications, mobile
  statuses and reports.
- The request timeline shows Submitted (by the farmer or filed by the
  Farmers' Association President), the optional recommendation or remark,
  and the MAO's decision.
- Existing endorsed requests became Pending with the recommendation kept
  (see "Live data changed" below). Decided requests were not changed.
- **Migration:** `20261122000100_direct_requests.sql`.

## Phase 3: association requests

- Requests page tabs: "Farmer Requests" and "Association Requests".
- The Farmers' Association President submits: type (Machinery / Project /
  Other), item from the list ("Other (specify)" asks for the item), quantity
  (machinery only, required), purpose / justification, number of farmer
  beneficiaries (required), preferred date, optional attachment (image or
  PDF, up to 5 MB). Edit or cancel only while Pending. Farmers can't see
  association requests.
- The MAO Admin manages the item list ("Manage items": add, rename, remove
  with confirmation; "Other (specify)" always stays). Starting list: hand
  tractor, four-wheel tractor, rice thresher, combine harvester, rice
  transplanter, water pump, irrigation rehabilitation, farm-to-market road,
  post-harvest facility, Other (specify).
- MAO Admin: Pending → Under review → Approved / Rejected (remarks required to
  reject). Both sides are notified. The Accomplishment Report counts
  association requests by type and status.
- **Migration:** `20261122000200_association_items.sql`.

## Phase 4: harvest reporting (kg)

- **Mobile:** "Report Harvest" card on Home (under Request Commodity) →
  Harvest Reports (history with status; Returned shows the MAO's remarks and
  "Resubmit") → Report Harvest form: season (Wet/Dry) and year, crop and
  program / type (from the farmer's profile), area harvested (prefilled with
  the farm size, can't exceed it), harvest in kg, harvest date (not in the
  future), optional link to a distribution received, remarks, and the same
  GPS + stamped photo capture as proof of planting (moved into a shared
  component). Yield per hectare is shown as you type.
- **Web "Harvest" page** (MAO Admin and Farmers' Association President):
  summary (reports, total kg, area, average kg/ha), table (RSBSA No., farmer,
  crop / type, season, area, kg, kg/ha, date, status), filters (season, crop,
  status, search), details with photo and map, timeline. MAO Admin: Verify /
  Return (remarks required to return). Both: "Add Harvest Report" for a
  farmer. Corrections only before verification.
- Farmer profile drawer: "Harvest History". Dashboard: "Harvest Reported" and
  "Average Yield" stats, and a "harvest reports to verify" chip for the MAO
  Admin. Reports: "Harvest Report" (with totals per crop / type), and harvest
  totals in the Accomplishment Report.
- Photos are stored in a private `harvest-photos` bucket (JPG/PNG/WebP, up to
  10 MB) in the farmer's folder.
- **Migration:** `20261122000300_harvest_reports.sql`.

## Phase 5: reports

- Beneficiary List columns: RSBSA No., Full Name, Barangay, Commodity, Type,
  Farm Size (ha), Quantity (kg), Date, Status, Acknowledgement, Date
  Received. Attendance Sheet starts with RSBSA No.
- Every report opens as a print preview first (prints only on "Print / Save
  as PDF"), shows real page sheets with page breaks, repeats the table header
  on each page, and ends with one signature block. The Beneficiary List and
  Harvest Report print landscape so their 10–11 columns fit.

## Phase 6: multi-tab sign-in

- Logging out in one tab sends the other tabs to Login with "You were logged
  out in another tab." (not "session expired").
- Logging in from one tab brings tabs that were on Login into the app.
- Signing in as a different account in another tab reloads this tab into the
  new account's home with the notice "You signed in as another account in
  another tab." — no stale screen, no permission errors.
- Refused actions (401/403) still show plain messages ("Your session has
  ended…", "You don't have permission to do that.").

## Phase 7: test data for evaluators

Loaded with `backend/scripts/seed-test-data.mjs` (removable with
`cleanup-test-data.mjs`). Maui Pelaez, Claude Oclarit and Luna Cuizon are
only referenced by new rows (requests, harvest reports); their own records
were not changed.

- Program / type set on 20 seeded farmers (rice: Inbred (RCEF) / Hybrid mix;
  corn: Standard). Farm sizes vary from 0.4 to 3 ha.
- Corn Seeds · Standard 20 kg/ha (a non-rice commodity with a type and rate).
- "RCEF Seed Distribution - Wet Season Replanting" (Nov 27, Ongoing): 2,000 kg
  barangay allocation, 10 farmers by hectare and type, one Adjusted with a
  reason — allocation used 476 of 2,000 kg.
- Farmer requests in every status: Pending, Pending + Recommended, Approved,
  Rejected, including ones filed by the Farmers' Association President.
- Association requests: Pending, Under review, Approved, Rejected.
- Harvest reports: Submitted, Verified, Returned (seeded farmers; and filed
  by the Farmers' Association President for Maui, Claude and Luna).
- The default-password reminder is off for the 25 seeded farmer accounts.

## Evaluator accounts

| Role | Login | Password | Good for |
| --- | --- | --- | --- |
| MAO Admin | the MAO's own account | (the client's; not listed here) | Types and rates, allocations, decisions, Verify / Return |
| Farmers' Association President | fapresident@agrishare.test | password123 | Recommend, Add Farmer Request, association requests, Add Harvest Report |
| Farmer (mobile) | 000201 (Rodel Bagas, Hybrid, 1.5 ha) | password123 | Harvest report Submitted; request with suggested kg |
| Farmer (mobile) | 000209 (Dionisio Omay, Inbred, 3 ha) | password123 | Harvest report Returned → Resubmit |
| Farmer (mobile) | 000202 (Marites Cabahug, Inbred, 1.2 ha) | password123 | Harvest report Verified |

All seeded farmers log in with their login ID (last 6 digits of the RSBSA
number) and `password123`.

## Permission matrix (new and changed features)

| Action | MAO Admin | FA President | Farmer |
| --- | --- | --- | --- |
| View commodity types and rates | Yes | Yes (read-only) | Rates used in their request form |
| Add / edit / remove types and rates | Yes | No (refused) | No |
| Set a farmer's Program / type | Yes | No | No |
| Barangay allocation, quantities by hectare | Yes | View | Own quantity |
| Submit a commodity request | — | For a farmer ("Filed by Farmers' Association President") | Own |
| Recommend / remark on a request | No | Yes, Pending only (optional) | No |
| Approve / Reject a request | Yes (reason to reject) | No (refused) | No |
| Association request: create / edit / cancel | No | Own, Pending only | No (can't see) |
| Association request: Under review / Approve / Reject | Yes (remarks to reject) | No | No |
| Manage the item list | Yes | View | No |
| Report a harvest | For a farmer | For a farmer | Own |
| Correct / resubmit a harvest report | Before verification | Own filings, before verification | Own, before verification |
| Verify / Return a harvest report | Yes (remarks to return) | No (refused) | No |
| See harvest reports | All | All | Own only |
| Harvest photos | Upload for a farmer, read all | Upload for a farmer, read all | Own folder only |

## Live data changed by the migrations

Saved before the change (`request_id, status, reviewed_by_fa, fa_decision_at,
forwarded_to_admin_at`), in case anything needs to be checked:

- Requests #7 (Test Farmer) and #54 (Joshua Jay Manlangit): Endorsed →
  Pending with "Recommended by Farmers' Association President" (the
  endorsement time and who endorsed are kept). Seeded requests #14, #63 and
  #66 changed the same way; #63 also moved from "Hybrid Rice Seeds" to Rice
  Seeds · Hybrid.
- "Hybrid Rice Seeds" (commodity 45, created by an earlier migration, no
  distributions) was removed (soft) and replaced by the Hybrid type.
- 6 earlier distribution rows that were sized by farm size got the default
  type and the rate they used (40 kg/ha).
- The 4 association requests were linked to items on the new list.
- Rice Seeds keeps its old pack-size value in the database column, unused.

## Checks run

| Check | Result |
| --- | --- |
| Database rules on a local copy (PGlite, all migrations): types, allocation, requests, items, harvest, photos, seed path | 65/65 |
| Web on a mock back end: Phases 1–2 / 3 / 4–5 | 37/37, 23/23, 34/34 |
| Two tabs, MAO Admin and FA President (log in / out / switch) | 10/10 |
| Mobile on the Expo web preview (360 and 412 px) | 18/18 |
| Live database, as each role, rolled back (stand-in MAO Admin) | 36/36, nothing left behind |
| Live site smoke test (FA President web; farmer 000201 mobile preview) | 11/11 |
| Older regression suite | Same as before except 2 expected differences: the FA President can no longer endorse (step removed), and there are now 5 storage buckets (harvest photos added; also size-capped, images only) |
| Lint, web build, mobile bundle | Pass (4 lint warnings, unchanged from before) |

Screen fit: Harvest, Requests, Commodities and Distributions show no page
scroll at 1366×768 and 1920×1080; mobile screens have no sideways scroll at
360 and 412 px and tap targets of at least 44 px.

## Mobile app

No new native permissions or packages (location, camera, map and photo
stamping were already in the installed app), so no new APK is needed: the
installed app picks up the update the next time it is opened (open it
twice if the first launch shows the old version).

## Things to know

- The map preview on the harvest form only renders on a phone; the Expo web
  preview shows "React Native WebView does not support this platform".
- The harvest photo is optional (recommended) so a harvest can still be
  reported after it is sold; a GPS location captured without a photo is
  saved too.
- The seed references the existing MAO Admin account as the reviewer of
  seeded decisions and notifies the MAO role, as in earlier rounds; the
  account itself is never signed into or changed.
- The Corn Seeds · Standard type is test data; cleanup removes it unless real
  records use it by then.
