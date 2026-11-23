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

Updated November 23, 2026 (see the updates below).

- **Farmer forms have no pre-filled values.** Add Farmer starts empty: every
  choice shows a placeholder ("Select sitio/purok", "Select commodity",
  "Select seed program", "Select status") and required fields show an error
  when left empty. Edit Farmer keeps the farmer's saved values selected.
- **Barangay, municipality and province are fixed for Barangay Langapud**
  (shown as read-only text: Langapud, Labangan, Zamboanga del Sur).
- **Sitio/purok and farmers' association are chosen from managed lists** to
  prevent inconsistent data. Both are dropdowns (type to search) whose last
  option adds a new entry right in the form, after a check for the same or
  a similar name ("Did you mean Purok 1?"). The farm location uses the same
  sitio/purok list, and Commodity/Crop comes from a crop list. The MAO Admin
  renames or deactivates entries in Settings → Lists (an entry in use can't
  be deleted). The farmers' association shows in the farmer profile, the
  Farmers page filters and the List of Farmers report.
- **Commodities are managed inside the distribution form.** There is no
  separate Commodities page any more (old links open Distributions). In the
  New / Edit Distribution window the Commodity field is a searchable
  dropdown that shows each commodity with its rate ("Rice Seeds – Hybrid ·
  15 kg/ha"). Its last option, "+ Add new commodity", opens a small form in
  the same window (name, category, optional allocation in kg per hectare);
  saving adds the commodity and selects it. The selected commodity's rate is
  shown under the field with "Edit rate": the MAO Admin chooses whether the
  new rate also applies to future distributions (saved to the commodity) or
  to this distribution only. Saved distributions never change. "Manage
  commodities" opens a list where the MAO Admin can rename a commodity,
  change its rate or delete it (with a confirmation; a deleted commodity
  stays in past records but is no longer offered). Only the MAO Admin can
  add, edit or delete commodities.
- **Each commodity has one allocation rate in kg per hectare, set by the MAO
  Admin.** Nothing about commodities or rates is hardcoded. The rate is
  optional (left blank for items not given by hectare, whose quantities are
  then split equally or entered manually). Rate changes are in the Activity
  Log ("Rice Seeds – Hybrid: allocation 15.00 kg/ha → 18.00 kg/ha"). The
  Farmers' Association President can view rates.
- **New distributions start as Ongoing; the MAO Admin marks them
  Completed.** The New Distribution window has no Status field. In
  Distribution Details the MAO Admin clicks the "Ongoing ▾" badge and
  chooses "Mark as Completed" (with a confirmation). The badge turns green,
  "Completed on [date]" appears under it, and the tagged farmers are
  recorded as having received their items and are notified once. The Edit
  window keeps the Status field, so a distribution marked Completed by
  mistake can be set back to Ongoing (with a confirmation; the completion
  date is cleared). For the Farmers' Association President the badge is
  read-only. The buttons under the details are Edit | Delete, then Print
  Distribution Report.
- **Varieties are separate commodities.** "Rice Seeds – Inbred (RCEF)" (40
  kg/ha) and "Rice Seeds – Hybrid" (15 kg/ha) are two commodities, each with
  its own rate; there are no commodity "types" any more. Category is chosen
  from a list (Rice, Corn, Vegetables, Fertilizer, Farm Tools, Livestock,
  Other). All quantities are in kilograms.
- **Allocation by hectare with a barangay allocation.** A distribution has a
  "Total allocation for the barangay (kg)". Each farmer's quantity is farm
  size × the commodity's rate (for example 2.00 ha × 15 kg/ha = 30 kg),
  shown with the calculation. A colored bar shows how much is used (green,
  amber above 90%, red when over) and saving is blocked when the farmers'
  total is over the allocation. Changed quantities need a reason and are
  marked "Adjusted". Each row keeps the rate it was saved with.
- **Seed program in the farmer profile.** Each farmer can be enrolled in a
  seed program (a commodity with a rate, e.g. Rice Seeds – Inbred (RCEF)).
  "Add all eligible farmers" adds the Active farmers enrolled in the
  distribution's commodity, and a tagged farmer enrolled in a different one
  shows "Enrolled in …". It can be filtered on the Farmers page.
- **Harvest reports are reviewed on the Validation page with proof of
  planting.** One email-style inbox lists both kinds of submission; the MAO
  Admin verifies or returns harvest reports there. On the mobile app both
  are under the Validation tab: "Proof of Planting" and "Report Harvest"
  cards, the latest submission's status, and one list of both kinds
  (filter All / Planting / Harvest).
- **No Wet/Dry season on harvest reports.** A harvest is identified by its
  harvest date; lists show the month and year ("8,400 kg · Nov 2026"), the
  Harvest Report filters by a harvest date range, and the dashboard counts
  harvests dated this year.
- **Farmer requests go straight to the MAO.** The endorsement step is gone.
  A request is Pending until the MAO Admin approves or rejects it (a reason
  is required to reject). The Farmers' Association President sees every
  request at the same time and may add a remark or mark it "Recommended by
  Farmers' Association President" — optional, never a blocker.
- **Requests filed by the Farmers' Association President are labeled.** The
  Farmers' Association President can file a request on a farmer's behalf
  ("Add Farmer Request"). Such a request has a "Filed by Farmers'
  Association President" tag in the requests list (with a filter to show
  them together); its timeline starts with "Filed by [name] (Farmers'
  Association President) for [farmer]"; the farmer sees it in the mobile
  request history and details; and printed reports and the Activity Log
  show who filed it.
- **Association requests were removed.** The Requests page lists farmer
  requests only (no tabs). The association request forms, list, details,
  notifications, dashboard chips and Accomplishment Report section are gone;
  the database table is kept, unused. The status column shows only Pending
  / Approved / Rejected; the Farmers' Association President's recommendation
  appears in the request's timeline.
- **List of Farmers report.** A farmer masterlist under Reports, filtered by
  barangay, status, commodity/crop, sex and an optional date-registered
  range. Columns: RSBSA No., full name (Last, First M.), sex, birth date,
  age, contact no., sitio/purok, barangay, commodity/crop, farm size, seed
  program and status, sorted by last name, with totals at the end (farmers,
  male / female, active / inactive, farm area). It prints landscape with the
  shared header, the table header on every page and one signature block.
  Deleted farmers are not listed.
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

## Update: sitio/purok, farmers' association and crop lists (November 24, 2026)

Migration `20261124000300_sitios_associations_crops.sql`; web deployed;
mobile update published over the air (update group
`ff8f2d27-88c8-4197-8fc2-da659846f089`). No new APK is needed.

- **Add / Edit Farmer:** no pre-filled values; placeholders for every
  choice; required: RSBSA no., names, sex, birth date, contact no.,
  sitio/purok, commodity/crop, farm size, ownership, PCIC insured and status
  (the database checks sitio/purok, commodity/crop, sex, ownership and
  status too). Seed program, farm location and farmers' association are
  optional. Barangay, municipality and province are fixed gray text and the
  database always saves Langapud, Labangan, Zamboanga del Sur.
- **Lists in the database:** `sitios`, `associations` and `crop_types` (id,
  name, is_active, created_at). Sitio/Purok and Farm Location use the sitio
  list; Commodity/Crop the crop list; Farmers' Association the association
  list. "+ Add new sitio/purok" and "+ Add new association" add an entry
  inline (MAO Admin and Farmers' Association President) after checking the
  same name ignoring case and spaces (refused, "Use Purok 1") and similar
  names ("Did you mean Purok 1?", "A similar association already exists:
  …"). Names are trimmed and an all-lowercase name is capitalized.
- **Settings → Lists (MAO Admin only):** Sitios / Puroks, Farmers'
  Associations and Crops, each with Add, Rename, Deactivate / Reactivate and
  (only when no farmer uses it) Delete. Renaming renames it on the linked
  farmer records; a deactivated entry is no longer offered but farmers who
  have it keep it. Changes are in the Activity Log ("Sitio/Purok renamed:
  Purok 1 → Purok Uno").
- **Where it shows:** Farmers page filters (sitio/purok, association,
  commodity from the lists), the profile drawer ("Farmers' Association"),
  the List of Farmers report (Farmers' Association column and filter; crop
  filter from the list) and the farmer's mobile profile (Sitio / Purok and
  Farmers' Association).
- **Existing records:** each list started with the values already in farmer
  records; values that are the same ignoring case and spaces became one
  entry and nothing else was merged. Records were linked only on an exact
  match (ignoring case and spaces); their text was left as it was. Not
  linked: the three records the team keeps unchanged (Maui Pelaez, Claude
  Oclarit, Luna Cuizon) and farm locations that are the barangay itself
  ("Langapud"). See "Items to decide" below.
- **Test data:** the test farmers use list entries; two fictional test
  associations (Langapud Rice Farmers Association, Langapud Corn and
  Vegetable Growers Association) were added and are removed by cleanup.

### Items to decide (nothing merged or changed)

| List | Entries | Note |
| --- | --- | --- |
| Sitios / Puroks | Balulang ↔ Sitio Balulang; Canitoan ↔ Sitio Canitoan; Macabalan ↔ Sitio Macabalan | Near-duplicates (the short names come from farm locations) |
| Sitios / Puroks | Iyot, Lami | Look like test entries (farmer "Ge Ge") |
| Sitios / Puroks | Barra Shoreline, Block 13, Villanena, Lakatan | Not confirmed as sitios of Langapud |
| Farmers' Associations | Department of Agriculture | A government agency, not a farmers' association; used only by Maui, Claude and Luna (not linked) |
| Farmers' Associations | Pala Iyot Farmers, Langapod Farmer, Labangan Crew | Look like test entries ("Langapod" may be a misspelling of Langapud) |
| Unmatched farm location | "Langapud" (the barangay) for Juan Dela Cruz, Maria Santos, Pedro Reyes, Ana Mendoza, Rogelio Torres, Liza Ramirez, Mario Bautista, Claude Oclarit, Luna Cuizon, Maui Pelaez, and the deleted Test Farmer | Kept as text; choose a sitio when editing |
| No sitio/purok on record | The same farmers, plus dtgrg fgb | Required the next time the farmer is edited |

### Checks run (this update)

| Check | Result |
| --- | --- |
| Database on a local copy (records as they were, then this migration) | 46/46 (17 new) |
| Web on a mock back end: empty form and required errors, pickers with add / same / similar names, saving, Edit keeps values, filters, profile, Settings → Lists (add, rename, deactivate, delete), Activity Log filter, List of Farmers, the Farmers' Association President's views, fit at 1366×768 and 1920×1080 | 44/44 |
| Earlier web suites (distributions and commodities, farm size × rate, Validation inbox, dashboard, no season) | 65, 29, 43, 9, 13 — all pass |
| Mobile profile on the Expo web preview (360 and 412 px) | 5/5 |
| Live database, as each role, rolled back | 66/66, nothing left behind |
| Live site as the test Farmers' Association President (1366×768, 1920×1080) | 10/10 |
| Test data re-run | Second run inserts nothing |
| Lint, web build, mobile bundle | Pass (3 lint warnings, unchanged from before) |

## Update: distributions, requests, commodities, List of Farmers (November 23, 2026)

Migration `20261124000200_distributions_requests_commodities.sql` (replaces
three database functions; no data changed); web deployed; mobile update
published over the air (update group
`ca6c37de-eaf2-42a6-83ef-6a919ce46673`). No new APK is needed.

- **Distributions:** no Status field when adding; the database saves every
  new distribution as Ongoing whatever is sent. The status badge in
  Distribution Details is a small menu for the MAO Admin ("Ongoing ▾" →
  "Mark as Completed", confirmation "Mark this distribution as completed?
  Tagged farmers will be recorded as having received their items and will
  be notified."); afterwards the badge is green, "Completed on [date]" shows
  under it, a confirmation message appears and the table row updates. The
  existing rules still apply: at least one tagged farmer, the completion date
  is saved, farmers are notified once (also after Completed → Ongoing →
  Completed), the acknowledgement is recorded. The separate "Mark as
  completed" button was removed.
- **Commodities:** the Commodities page, its menu item and route were
  removed (`/commodities` opens Distributions). The distribution form's
  searchable dropdown, inline "+ Add new commodity" form, "Edit rate" (Yes:
  saved to the commodity and logged; No: this distribution only) and
  "Manage commodities" window replace it. A rate for one distribution only
  is saved on that distribution's rows (above 0, up to 1,000 kg/ha). The
  farmer Seed Program dropdown, requests (mobile and on-behalf), harvest
  reports, report filters and the dashboard's Top Commodities are unchanged.
- **Requests:** one list without tabs; no "Recommended" badge in the status
  column (the recommendation stays in the timeline and the details); a
  "Filed by Farmers' Association President" filter; the timeline's first
  step for a filed request reads "Filed by [name] (Farmers' Association
  President) for [farmer]" with the date. New Activity Log entries say
  "Request filed by Pedro Lagunay (Farmers' Association President) for
  Marites Cabahug: 48 kg of …" or "Request submitted by …" (older entries
  keep their wording). The Accomplishment Report's "Farmer Requests" table
  counts requests submitted by farmers and filed by the Farmers' Association
  President (Pending / Approved / Rejected) and names who filed them.
- **Mobile:** a request in the farmer's history opens its details
  (commodity, quantity, status, date requested, who filed it — "Your
  Farmers' Association President, for you" — reason, decision date and the
  MAO's remarks). The list keeps the "Filed by Farmers' Association
  President" tag.
- **Association requests:** removed from the web app (tab, forms, list,
  details, dashboard chips, report section). Older association-request
  notifications are hidden from the bell and its count (not deleted). The
  table and its rows stay in the database, unused.
- **Seed data:** association requests are no longer seeded; the ones seeded
  earlier stay in the ledger so `cleanup-test-data.mjs` can remove them.

### Commodities to review (nothing changed)

Possible duplicates and odd entries on the live database, with how many
records use each (distributions / beneficiary rows / requests / harvest
reports / farmers enrolled):

| Commodity (id) | Rate | Used by | Note |
| --- | --- | --- | --- |
| Rice Seeds (NSIC Rc222) (1) | 40 kg/ha | 5 / 28 / 6 / 0 / 0 | Older general rice seed entry |
| Rice Seeds – Inbred (RCEF) (49) | 40 kg/ha | 2 / 12 / 1 / 6 / 8 | |
| Rice (48) | 40 kg/ha | 1 / 20 / 0 / 0 / 0 | Category typed "rice" (lowercase); used by one distribution |
| Rice Seeds – Hybrid (50) | 15 kg/ha | 1 / 5 / 2 / 2 / 6 | |
| RICE SEEDS-HYBRID (59) | 1.5 kg/ha | unused | Added Nov 23; looks like a duplicate of Rice Seeds – Hybrid with a mistyped rate |
| Corn Seeds (2) | 20 kg/ha | 2 / 7 / 5 / 2 / 6 | |
| Yellow Corn (47) | — | unused | Unit saved as "12 kg" |
| Fertilizer (3) | — | 0 / 0 / 3 / 0 / 0 | Generic; overlaps Organic Fertilizer and Urea Fertilizer (46-0-0) |
| Organic Fertilizer (4) | — | 2 / 9 / 1 / 0 / 0 | |
| Urea Fertilizer (46-0-0) (35) | — | 1 / 7 / 1 / 0 / 0 | |
| Bio Plant Activator (36) | — | unused | Unit "L"; an older deleted entry with the same name exists (5) |

### Checks run (this update)

| Check | Result |
| --- | --- |
| Database on a local copy (PGlite, all migrations) | 29/29 |
| Web on a mock back end: status badge and confirmations, Edit back to Ongoing, commodity dropdown / add / edit rate (Yes and No) / Manage commodities, requests without tabs, filed-by filter and timeline, bell, List of Farmers and Accomplishment Report prints, the Farmers' Association President's read-only views, fit at 1366×768 and 1920×1080 | 65/65 |
| Earlier web suites (Validation inbox, no season, two tabs, dashboard, farm size × rate, requests, fit) | 43, 13, 8, 10, 9, 29 — all pass; the Commodities-page and association-request suites were retired with those screens |
| Mobile request history and details (Expo web preview, 360 and 412 px) | 17/17 |
| Live database, as each role, rolled back | 54/54, nothing left behind |
| Live site as the test Farmers' Association President (1366×768, 1920×1080) | 18/18 |
| Lint, web build, mobile bundle | Pass (3 lint warnings, unchanged from before) |

## Update: Validation tab and no season (November 24, 2026)

Migration `20261124000000_harvest_without_season.sql`; web deployed, mobile
update published over the air (update group
`ad03c4e1-eb29-4d35-b1be-3f73c9f0c4ef`). No new APK is needed.

- **Mobile Validation tab:** title "Validation"; two action cards side by
  side ("Proof of Planting", green #2F9E44, camera icon; "Report Harvest",
  darker green #1F7A34, plant icon) that open the existing forms; "Latest
  submission" (the newest of either type, with a Planting / Harvest tag and a
  Submitted → Under review → Validated / Verified tracker; Rejected /
  Returned in red with the MAO's remarks and Resubmit); "My submissions"
  with All / Planting / Harvest chips and one list, newest first (photo or
  icon, crop, status, type tag and "1.5 ha · Validated Sep 12" or
  "8,400 kg · Nov 2026"); full details on tap (photo, map location,
  details, remarks, timeline); empty state "You haven't submitted anything
  yet.".
- The separate Harvest Reports screen and Home's "Report Harvest" card were
  removed. Notifications about a submission open it on the Validation tab.
  After sending either form the app returns to the Validation tab with a
  confirmation, and the new submission is the latest. Resubmit opens the
  matching form filled in with the earlier details.
- **Season removed:** from the mobile and web harvest forms, details, lists,
  the latest submission card, the printed Harvest Report (Harvest Date
  column, harvest date range, totals follow it), the farmer profile's
  Harvest History (by harvest date, with this year's total) and the
  dashboard stat (harvests dated this year). Notifications say "(harvested
  Nov 2026)". The database columns are kept but optional (older reports keep
  their value); the test data leaves them empty.
- **Duplicate check:** a warning (not a block) when the same farmer already
  reported the same crop with a harvest date within 60 days.

| Check | Result |
| --- | --- |
| Database on a local copy (with this migration) | 19/19 |
| Mobile Validation tab on the Expo web preview, 360 and 412 px | 33/34 (see below) |
| Web: inbox, opened report, Add harvest report, Harvest Report date range, drawer, dashboard, fit | 13/13 (+ earlier suites 41, 43, 18, 23, 8, 10 — all pass) |
| Live database, as each role, rolled back | 47/47, nothing left behind |
| Live site and mobile preview (FA President; farmer 000201) | 15/15 |
| Lint, web build, Android bundle | Pass (no new warnings) |

Not testable on the web preview: sending a proof of planting needs the
phone's photo stamping (it can't run in a browser); that part of the form
didn't change, and the return to the Validation tab with a confirmation is
the same code the harvest form uses (tested).

## Update: one rate per commodity (November 23, 2026)

Replaces the commodity types of Phase 1. Migration
`20261123000000_one_rate_per_commodity.sql`; web deployed, mobile update
published over the air (update group `f83a32dd-3dad-464a-a113-61b5e2170697`).

- **Commodities:** "Unit" replaced by "Allocation (kg per hectare)" with
  "kg/ha" inside the field and the helper "Leave blank for items not given by
  hectare (quantities are then split equally or entered manually)."; category
  dropdown; table columns NAME, CATEGORY, RATE, STATUS, DATE ADDED; details
  "Allocation: 40 kg/ha" (or "Not set") with "Last updated [date] by
  [name]". New commodities are always kg; older non-kg items keep their unit
  for display and can't take a rate. Validation: rate above 0, up to 1,000,
  at most 2 decimals.
- **Farmers:** "Seed Program" (optional) in the form, the profile drawer and
  the filter.
- **Distributions:** quantity = farm size × the commodity's rate with the
  calculation; barangay allocation bar; Adjusted with a reason; "Add all
  eligible farmers" uses Seed programs (or the crop, when nobody is
  enrolled) and stops at the allocation; "Enrolled in …" chip; after a rate
  change, editing an Ongoing distribution asks "Rice Seeds – Inbred (RCEF)'s
  allocation changed from 40 to 45 kg/ha since these quantities were saved.
  Recompute quantities?" (Recompute / Keep current).
- **Requests:** suggested quantity = farm size × the chosen commodity's rate
  (web "Add Farmer Request" and the mobile request form; both start on the
  farmer's Seed program).
- **Harvest reports, reports, printed lists, mobile history:** commodity
  name only (no Type column).
- **Mobile Harvest Reports screen** rebuilt to match Proof of Planting:
  shared header (AGRISHARE logo and bell), "Report Harvest" card, "Latest
  report" tracker (Submitted → Under review → Verified, or Returned with the
  MAO's remarks and "Resubmit"), History, full details on tap, empty state
  "You haven't reported a harvest yet.". It opens from Home's "Report
  Harvest" card and keeps the Home / Validation / Profile tab bar.

### Live data changed by this migration

- New commodities "Rice Seeds – Inbred (RCEF)" (40 kg/ha) and "Rice Seeds –
  Hybrid" (15 kg/ha), from the two rice types. "Rice Seeds (NSIC Rc222)"
  itself is unchanged (40 kg/ha) with its history.
- "Corn Seeds" got 20 kg/ha (from the test-data Standard type; cleanup takes
  it off again) and "Rice" got 40 kg/ha (from its only type); the
  "You know" distribution on Rice is unchanged.
- Farmers' types became Seed programs (20 seeded farmers).
- Typed requests and harvest reports moved to the variety commodity
  (quantities, statuses and dates kept; no notifications sent).
- Test distribution "RCEF Seed Distribution - Wet Season Replanting" (mixed
  varieties) was split: Inbred rows stay (404 of 2,000 kg); the 4 Hybrid rows
  (72 kg) are in "RCEF Seed Distribution - Wet Season Replanting (Rice Seeds –
  Hybrid)". "Allocation by Farm Size" moved to Rice Seeds – Inbred (RCEF).
  Saved quantities and rates were kept.
- The `commodity_types` table is kept but no longer used.

### Checks run (this update)

| Check | Result |
| --- | --- |
| Database on a local copy: conversion, rates, distributions, seed programs, requests, harvests | 15/15 (earlier phases 66/66) |
| Web on a mock back end: commodities, farmers, distributions, requests, harvest, print, fit | 41/41 (+ inbox 43/43, list rows 18/18, Phases 3/4/6 23/23, 8/8, 10/10) |
| Mobile on the Expo web preview (360 and 412 px) | 24/24 |
| Live database, as each role, rolled back (stand-in MAO Admin) | 43/43, nothing left behind |
| Live site and mobile preview (FA President; farmer 000201), 1366×768, 1920×1080, 360, 412 | 22/22 |
| Lint, web build, Android bundle | Pass (3 lint warnings, unchanged) |

## Phase 1: allocation by hectare

*(Superseded on November 23 by one rate per commodity — see above.)*

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

Removed from the apps on November 23, 2026 (see the latest update); kept
here as a record. The `association_requests` table and its rows remain in
the database, unused.

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
| MAO Admin | the MAO's own account | (the client's; not listed here) | Commodity rates, allocations, decisions, Verify / Return |
| Farmers' Association President | fapresident@agrishare.test | password123 | Recommend, Add Farmer Request, association requests, Add Harvest Report |
| Farmer (mobile) | 000201 (Rodel Bagas, Seed program Rice Seeds – Hybrid, 1.5 ha) | password123 | Harvest report Submitted; request suggested 1.5 × 15 = 22.5 kg |
| Farmer (mobile) | 000209 (Dionisio Omay, Rice Seeds – Inbred (RCEF), 3 ha) | password123 | Harvest report Returned → Resubmit |
| Farmer (mobile) | 000202 (Marites Cabahug, Rice Seeds – Inbred (RCEF), 1.2 ha) | password123 | Harvest report Verified |

All seeded farmers log in with their login ID (last 6 digits of the RSBSA
number) and `password123`.

## Permission matrix (new and changed features)

| Action | MAO Admin | FA President | Farmer |
| --- | --- | --- | --- |
| View commodity rates | Yes | Yes (read-only) | Rates used in their request form |
| Add / edit / delete commodities and rates (in the distribution form) | Yes | No (refused) | No (refused) |
| Add a sitio/purok or farmers' association | Yes | Yes | No (refused) |
| Add a crop; rename, deactivate or delete list entries (Settings → Lists) | Yes | No (refused) | No (refused) |
| Mark a distribution Completed, or back to Ongoing | Yes | No (read-only badge; refused) | No |
| Set a farmer's Seed program | Yes | No | No |
| Barangay allocation, quantities by hectare | Yes | View | Own quantity |
| Submit a commodity request | — | For a farmer ("Filed by Farmers' Association President") | Own |
| Recommend / remark on a request | No | Yes, Pending only (optional) | No |
| Approve / Reject a request | Yes (reason to reject) | No (refused) | No |
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
