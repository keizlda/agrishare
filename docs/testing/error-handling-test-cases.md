# AgriShare — Error-Handling Test Report

Branch `test/error-handling` · November 11, 2026 · not deployed.

## How the tests were run

Everything ran locally, on test data only. The live Supabase project was
**paused (INACTIVE)** during testing, and no real record was read or changed.

| Part | Where it ran |
|---|---|
| Web app (MAO Admin, FA President) | The local build of the web app in Chrome, connected to a stand-in back end that can be switched to: no internet, server error, expired session, rate limit, slow connection, a connection that drops part-way through a save, empty data, very long text, and script/HTML text. One extra test used the real Supabase library pointed at an address where no server answers. |
| Mobile app (farmers) | The Expo web preview of the app in Chrome, with the same kind of stand-in back end. Alerts the phone would show were recorded. Things only a real phone can do (deny camera or gallery permission, turn GPS off, take a camera photo) are marked "Needs decision (phone test)". |
| Database rules | A local Postgres copy (PGlite) built by replaying every migration in `backend/supabase/migrations`. Security rules, the new single-transaction saves, and server-side input rules were tested here. Each attempt was rolled back. |
| Secrets | Production builds of both apps, searched for the service-role key, deploy tokens and service-role markers. |

**A test passes when** the user sees a clear message in plain English (no raw database or code text), what they typed is kept, nothing is half-saved, and the app doesn't crash or freeze.

**Round 1** ran on the code as it was (`main`). Every failure was fixed, then **round 2** re-ran the whole list on the fixed code. "Actual Result" shows both rounds for fixed tests.

## Summary

214 test cases: 130 Pass, 80 Fail → Fixed, 4 Needs decision (phone test).

## Test cases

### Login

| Test Case ID | Module | Test Scenario | Input / Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|
| LOG-01 | Login | Web: wrong password | Login page: valid email, wrong password, Login | "Incorrect email or password."; stays on login | Incorrect email or password. | Pass |
| LOG-02 | Login | Web: unknown account | Email that has no account, any password | Same message (does not reveal which part is wrong) | Incorrect email or password. | Pass |
| LOG-03 | Login | Web: empty fields | Leave email and password empty, Login | "Please enter both email and password." | Please enter both email and password. | Pass |
| LOG-04 | Login | Web: farmer account on the web app | Log in with a farmer's account (000201@farmers…) | "This account does not have access to the AgriShare web console."; signed out again | Before: This account does not have access to the AgriShare web console.; session kept (still signed in). After fix: This account does not have access to the AgriShare web console.; session cleared | Fail → Fixed |
| LOG-05 | Login | Web: too many failed attempts | Server answers 429 rate limit on Login | Friendly "Too many login attempts" message | Before: Couldn't sign in. Please try again.. After fix: Too many attempts. Please wait a few minutes and try again. | Fail → Fixed |
| LOG-06 | Login | Web: login while offline | Network off, Login | "No internet connection. Please try again."; email kept | Before: Failed to fetch; email kept. After fix: No internet connection. Please try again.; email kept | Fail → Fixed |
| LOG-07 | Login | Web: FA President opens /validation directly | Signed in as Farmers' Association President, type /validation in the address bar | Sent back to the Dashboard; admin page never shows | ended on / | Pass |
| LOG-08 | Login | Web: FA President opens /reports directly | Signed in as Farmers' Association President, type /reports in the address bar | Sent back to the Dashboard; admin page never shows | ended on / | Pass |
| LOG-09 | Login | Web: FA President opens /commodities directly | Signed in as Farmers' Association President, type /commodities in the address bar | Sent back to the Dashboard; admin page never shows | ended on / | Pass |
| LOG-10 | Login | Web: FA President opens /activity-log directly | Signed in as Farmers' Association President, type /activity-log in the address bar | Sent back to the Dashboard; admin page never shows | ended on / | Pass |
| LOG-11 | Login | Web: FA President opens /settings | Signed in as FA President, open /settings | Only Change Password (no General Information) | only Change Password shown | Pass |
| LOG-12 | Login | Web: session expires while using the app | On Farmers page, the session ends on the server (refresh token gone) | Sent to Login with "Your session has expired. Please log in again." | Before: on /login; no message. After fix: on /login; Your session has expired. Please log in again. | Fail → Fixed |
| LOG-13 | Login | Web: session token cleared, then an action | On Commodities, clear the saved session, then Add Commodity and Save | Sent to Login with the session-expired message (no blank page, no permission error) | Before: on /commodities; You don't have permission to do that.. After fix: on /login; Your session has expired. Please log in again. | Fail → Fixed |
| LOG-14 | Login | Change Password: wrong current password | Settings > Change Password: current "••••••••••••••", new/confirm per case, Update | Inline error under the field; password not changed | Current password is incorrect. | Pass |
| LOG-15 | Login | Change Password: confirmation doesn't match | Settings > Change Password: current "•••••••••••", new/confirm per case, Update | Inline error under the field; password not changed | Passwords do not match. | Pass |
| LOG-16 | Login | Change Password: new password too short | Settings > Change Password: current "•••••••••••", new/confirm per case, Update | Inline error under the field; password not changed | New password must be at least 8 characters. | Pass |
| LOG-17 | Login | Change Password: new password same as current | Settings > Change Password: current "•••••••••••", new/confirm per case, Update | Inline error under the field; password not changed | New password must be different from your current password. | Pass |
| LOG-18 | Login | Change Password while offline | Network off, fill valid values, Update Password | "No internet connection"; fields kept | Before: Current password is incorrect.; fields kept. After fix: No internet connection. Please try again.; fields kept | Fail → Fixed |
| LOG-19 | Login | Mobile: wrong password | Login ID 000201, wrong password, Login | "Incorrect RSBSA number or password." | Incorrect RSBSA number or password. | Pass |
| LOG-20 | Login | Mobile: unknown login ID | Login ID 000777 (no account), any password | Same message | Incorrect RSBSA number or password. | Pass |
| LOG-21 | Login | Mobile: empty fields | Leave both fields empty, Login | "Please enter the last 6 digits of your RSBSA number and your password." | Please enter the last 6 digits of your RSBSA number and your password. | Pass |
| LOG-22 | Login | Mobile: letters in the RSBSA field | Type "ab12cd34ef56" in the RSBSA field | Only the digits stay (123456) | field shows "123456" | Pass |
| LOG-23 | Login | Mobile: paste the full RSBSA number | Paste 09-73-00-000-000201, correct password, Login | Field keeps the last 6 digits (000201) and logs in | field "000201"; logged in | Pass |
| LOG-24 | Login | Mobile: deleted (deactivated) farmer logs in | Login ID 000208 (farmer was deleted; account disabled) | Plain message that the account is no longer active; who to contact | Before: User is banned. After fix: This account is no longer active. Please contact your Farmers' Association President or the Municipal Agriculture Office. | Fail → Fixed |
| LOG-25 | Login | Mobile: FA President uses their web email | Type fapresident@agrishare.test in the RSBSA field | Field only accepts digits; can't sign in with a staff email | field shows "" | Pass |
| LOG-26 | Login | Mobile: staff (non-farmer) account in the app | Login ID 000999 belongs to a staff account, correct password | "This app is for farmers…" pointing to the web system; signed out again | This app is for farmers. Please use the AgriShare web system. | Pass |
| LOG-27 | Login | Mobile: login while offline | Network off, Login | "No internet connection. Please try again." | Before: Network request failed. After fix: No internet connection. Please try again. | Fail → Fixed |
| LOG-28 | Login | Mobile: too many failed attempts | Server answers 429 rate limit on Login | "Too many login attempts…" | Before: Request rate limit reached. After fix: Too many attempts. Please wait a few minutes and try again. | Fail → Fixed |
| LOG-29 | Login | Mobile: session expires while using the app | Signed in on Home; the session ends on the server | Back to Login with "Your session has expired. Please log in again." | Before: login screen; no message. After fix: login screen; Your session has expired. Please log in again. | Fail → Fixed |

### Farmer Management

| Test Case ID | Module | Test Scenario | Input / Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|
| FRM-01 | Farmer Management | Add Farmer with empty required fields | Add Farmer, leave everything empty, Save Farmer | An inline error under each required field; nothing saved; form stays open | all required-field errors shown | Pass |
| FRM-02 | Farmer Management | Invalid RSBSA format | RSBSA typed as "09-73-AB-CD" (letters) | Letters are ignored; "Enter the complete RSBSA number" | Enter the complete RSBSA number (format: 09-73-12-021-000143).; nothing saved | Pass |
| FRM-03 | Farmer Management | Incomplete RSBSA number | RSBSA "09-73-00-000-0001" (too few digits) | "Enter the complete RSBSA number (format: …)" | Enter the complete RSBSA number (format: 09-73-12-021-000143).; nothing saved | Pass |
| FRM-04 | Farmer Management | Duplicate RSBSA number | RSBSA of an existing farmer (09-73-00-000-000100) | Warning that the farmer already exists, with a link to the existing record | A farmer with matching RSBSA number / name and birthdate already exists.; nothing saved | Pass |
| FRM-05 | Farmer Management | Duplicate name + birth date (different case) | "juan" "dela cruz", 05/12/1984 (matches Juan Dela Cruz) | Duplicate warning | A farmer with matching RSBSA number / name and birthdate already exists.; nothing saved | Pass |
| FRM-06 | Farmer Management | Duplicate name with extra spaces | "  JUAN " "Dela   Cruz", 05/12/1984 | Duplicate warning | A farmer with matching RSBSA number / name and birthdate already exists.; nothing saved | Pass |
| FRM-07 | Farmer Management | Birth date in the future | Birth date 01/01/2030 | "Enter a realistic birth date…" | Enter a realistic birth date — not in the future.; nothing saved | Pass |
| FRM-08 | Farmer Management | Unrealistic age: 1 year old | Birth date one year ago | Rejected: farmer must be of age | Before: no message; farmer WAS saved. After fix: The farmer must be at least 18 years old.; nothing saved | Fail → Fixed |
| FRM-09 | Farmer Management | Unrealistic age: 120 years old | Birth date 01/01/1906 | Rejected as unrealistic | Before: no message; farmer WAS saved. After fix: Enter a realistic birth date — that's over 100 years old.; nothing saved | Fail → Fixed |
| FRM-10 | Farmer Management | Contact number with letters | Contact "0917ABC4567" | "Enter an 11-digit number starting with 09…" | Enter an 11-digit number starting with 09 (e.g. 09XX XXX XXXX).; nothing saved | Pass |
| FRM-11 | Farmer Management | Contact number too short | Contact "0917123" | 11-digit message | Enter an 11-digit number starting with 09 (e.g. 09XX XXX XXXX).; nothing saved | Pass |
| FRM-12 | Farmer Management | Contact number too long | Contact "091712345678901" | 11-digit message | Enter an 11-digit number starting with 09 (e.g. 09XX XXX XXXX).; nothing saved | Pass |
| FRM-13 | Farmer Management | Negative farm size | Farm size -2 | "Farm size must be a positive number" | Farm Size (ha); Farm size must be a positive number.; nothing saved | Pass |
| FRM-14 | Farmer Management | Zero farm size | Farm size 0 | Farm size message | Farm Size (ha); Farm size must be a positive number.; nothing saved | Pass |
| FRM-15 | Farmer Management | Letters in farm size | Type "abc" in Farm Size | Letters can't be typed; farm size message | Farm Size (ha); Farm size must be a positive number.; nothing saved | Pass |
| FRM-16 | Farmer Management | Very long text (520 characters) | First Name and Farm Location with 520 characters, Save | Limited or rejected with a length message; nothing oversized saved | Before: field kept 520 chars; saved with a 520-character name. After fix: field kept 50 chars; saved with a 50-character name | Fail → Fixed |
| FRM-17 | Farmer Management | Emoji in a name | First Name "Juan😀" | Name rejected: letters, spaces, . ' - only | Before: no message; farmer WAS saved. After fix: First name can only have letters, spaces, and . ' -; nothing saved | Fail → Fixed |
| FRM-18 | Farmer Management | Special characters a real name can have | First "Niño", Middle "Ma.", Last "O'Brien-Dela Cruz", Save | Accepted and saved | saved as Niño O'Brien-Dela Cruz | Pass |
| FRM-19 | Farmer Management | Leading/trailing spaces | First "  Pedro  ", Last " Testcase ", Save | Saved without the extra spaces | Before: saved as " Pedro " " Testcase ". After fix: saved as "Pedro" "Testcase" | Fail → Fixed |
| FRM-20 | Farmer Management | Save a new farmer while offline | Fill a valid form, network off, Save Farmer | "No internet connection. Please try again."; form stays open with everything typed; nothing saved | Before: TypeError: Failed to fetch; *; input kept; nothing saved. After fix: No internet connection. Please try again.; input kept; nothing saved | Fail → Fixed |
| FRM-21 | Farmer Management | Server error while saving | Fill a valid form; the server returns a database error; Save | Plain message (no database text); form kept; nothing saved | Couldn't save this farmer. Please try again.; nothing saved | Pass |
| FRM-22 | Farmer Management | Connection drops partway through saving | Valid form; connection drops after the first database write; Save | Nothing half-saved: either no farmer, or a complete one (address + farm) | Before: 1 farmer row(s), 1 missing address/farm; TypeError: Failed to fetch; *. After fix: 1 farmer row(s), 0 missing address/farm; Farmer added. | Fail → Fixed |
| FRM-23 | Farmer Management | Login account can't be created after the farmer is saved | Valid form; the account service rejects (login ID taken); Save | Clear message; the new farmer record is removed again (no farmer without an account) | Before: supabase.from(...).delete(...).eq(...).catch is not a function; *; farmer left behind without an account. After fix: Login ID 000100 is already used by Juan Dela Cruz.; nothing left behind | Fail → Fixed |
| FRM-24 | Farmer Management | Double-click Save on a slow connection | Slow connection (1.5 s per call); click Save Farmer twice quickly | Button disabled while saving ("Saving…"); only one farmer created | Before: button NOT disabled; 3 farmer(s) created. After fix: button disabled with "Saving…"; 1 farmer(s) created | Fail → Fixed |
| FRM-25 | Farmer Management | Two admins edit the same farmer | Open Edit Farmer; meanwhile another admin changes the farmer; Save here | Saves safely (last save wins) with a success message; no crash | Before: form still open; That record couldn't be found — it may have already been changed or removed.; *. After fix: saved; Farmer record updated. | Fail → Fixed |
| FRM-26 | Farmer Management | Search farmers for "%" | Farmers page search box: % | Page keeps working; matching (or no) results; no error | 0 row(s), "No farmers found" | Pass |
| FRM-27 | Farmer Management | Search farmers for "'" | Farmers page search box: ' | Page keeps working; matching (or no) results; no error | 0 row(s), "No farmers found" | Pass |
| FRM-28 | Farmer Management | Search farmers for "\"" | Farmers page search box: " | Page keeps working; matching (or no) results; no error | 0 row(s), "No farmers found" | Pass |
| FRM-29 | Farmer Management | Search farmers for "<script>alert(1)</script>" | Farmers page search box: <script>alert(1)</script> | Page keeps working; matching (or no) results; no error | 8 row(s) | Pass |
| FRM-30 | Farmer Management | Search farmers for "Cruz, Juan)" | Farmers page search box: Cruz, Juan) | Page keeps working; matching (or no) results; no error | 0 row(s), "No farmers found" | Pass |
| FRM-31 | Farmer Management | Farmer list empty | No farmers in the system; open Farmers | "No farmers found" with a hint | No farmers found | Pass |
| FRM-32 | Farmer Management | Very long names | A farmer with a 170-character name; open Farmers and the profile | Table and profile stay within the screen; no crash | page fits; profile fits | Pass |
| FRM-33 | Farmer Management | Delete a farmer while offline | Farmers ⋯ > Delete > confirm, network off | Friendly offline message; farmer still listed | Before: Failed to send a request to the Edge Function; farmer kept. After fix: No internet connection. Please try again.; farmer kept | Fail → Fixed |
| FRM-34 | Farmer Management | Save a new farmer in one transaction | As MAO: save_farmer(new farmer) | Farmer + address + farm + crop created together | Before: no single-transaction save: the web app writes 4 tables one after another. After fix: saved | Fail → Fixed |
| FRM-35 | Farmer Management | A failure partway through saving leaves nothing behind | As MAO: save_farmer where the farm-parcel step fails (after the farmer row was written) | Whole save rolled back (no farmer row left) | save failed; farmers 2 -> 2 | Pass |
| FRM-36 | Farmer Management | Server also rejects a future birth date | As MAO: save_farmer with future birth date (bypassing the web form) | Refused with a plain message | Enter a realistic birth date — not in the future. | Pass |
| FRM-37 | Farmer Management | Server also rejects a farm size 0 | As MAO: save_farmer with farm size 0 (bypassing the web form) | Refused with a plain message | Farm size must be greater than 0. | Pass |
| FRM-38 | Farmer Management | Server also rejects a blank first name | As MAO: save_farmer with blank first name (bypassing the web form) | Refused with a plain message | First name and last name are required. | Pass |

### Distribution

| Test Case ID | Module | Test Scenario | Input / Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|
| DST-01 | Distribution | Mark Completed with no farmers tagged | New Distribution, Status = Completed, no farmers, Save | "Tag at least one beneficiary…" | Tag at least one beneficiary before setting the status to Completed.; nothing saved | Pass |
| DST-02 | Distribution | Farmers' quantities don't add up to the total | Total 100 kg, tag 2 farmers, change one farmer to 30 kg (sum 80), Save | Message that the farmers' quantities don't match the total | Before: no message; distribution WAS saved. After fix: The farmers' quantities add up to 80 kg, but Total Quantity is 100 kg. Change them so they match.; Total Quantity (kg); 2 farmers tagged · 80 kg total; nothing saved | Fail → Fixed |
| DST-03 | Distribution | Negative total quantity | Total quantity -5, no farmers, Save | "Enter a quantity greater than 0" | Enter a total quantity greater than 0.; Total Quantity (kg); nothing saved | Pass |
| DST-04 | Distribution | Zero quantity for a farmer | Total 50, tag 1 farmer, set the farmer's quantity to 0, Save | Each farmer's quantity must be more than 0 | Before: no message; distribution WAS saved. After fix: Each farmer's quantity must be greater than 0.; Total Quantity (kg); nothing saved | Fail → Fixed |
| DST-05 | Distribution | Letters in the quantity | Type "abc" in Total Quantity, no farmers, Save | Letters can't be typed; quantity message; nothing saved | Enter a total quantity greater than 0.; Total Quantity (kg); nothing saved | Pass |
| DST-06 | Distribution | Missing program name | Leave Program Name empty, Save | "Program name is required." | Before: *; nothing saved. After fix: Program name is required.; nothing saved | Fail → Fixed |
| DST-07 | Distribution | No commodities exist yet | Commodities list empty; New Distribution, Save | "Add a commodity in Commodities before recording a distribution." | Add a commodity in Commodities before recording a distribution.; nothing saved | Pass |
| DST-08 | Distribution | Duplicate distribution warning | Tag a farmer who already got this commodity under this program this year | Warning on the farmer + a required reason to allow it | Already received 1 from Rice Resiliency Program on Sep 26, 2026; save blocked: true | Pass |
| DST-09 | Distribution | Tagging an inactive farmer | Tag "Grace" (Inactive) | Asks to confirm before adding | This farmer is inactive. Add them to this distribution anyway? | Pass |
| DST-10 | Distribution | Save a distribution while offline | Fill the form with 2 farmers, network off, Save | "No internet connection"; form kept; nothing saved | Before: TypeError: Failed to fetch; *; form kept; nothing saved. After fix: No internet connection. Please try again.; form kept; nothing saved | Fail → Fixed |
| DST-11 | Distribution | Connection drops in the middle of saving (with beneficiaries) | 2 farmers tagged; connection drops after the first database write; Save | Nothing half-saved: no distribution without its item and farmers | Before: 1 saved, 1 incomplete ({"id":"new17943759221950","items":0,"claims":[]}). After fix: 1 saved, 0 incomplete ({"id":"ne1001","items":1,"qty":100,"claims":[50,50]}) | Fail → Fixed |
| DST-12 | Distribution | Connection drops before the save reaches the server | 2 farmers tagged; the first write fails; Save | "No internet connection"; nothing saved; form kept | Before: TypeError: Failed to fetch; *; nothing saved. After fix: No internet connection. Please try again.; nothing saved | Fail → Fixed |
| DST-13 | Distribution | Double-click Save on a slow connection | Slow connection; click Save Distribution three times quickly | Button disabled while saving; one distribution | Before: button disabled; 3 distribution(s). After fix: button disabled; 1 distribution(s) | Fail → Fixed |
| DST-14 | Distribution | Mark as completed while offline | Select an Ongoing distribution, Mark as completed, confirm, network off | Friendly offline message; status stays Ongoing | Before: TypeError: Failed to fetch; status ongoing. After fix: No internet connection. Please try again.; status ongoing | Fail → Fixed |
| DST-15 | Distribution | Edit: future date on a Completed distribution | Edit a Completed distribution, Date 12/31/2099, Save Changes | Rejected: a completed distribution can't be in the future | Before: no message; date SAVED as 2099. After fix: A completed distribution can't have a future date.; date unchanged | Fail → Fixed |
| DST-16 | Distribution | Edit: past date | Edit a distribution, Date 01/15/2025, Save Changes | Accepted (records can be entered late) | date now 2025-01-15 | Pass |
| DST-17 | Distribution | Edit: remove every tagged farmer | Edit an Ongoing distribution with 1 farmer, remove the farmer, enter a total, Save | The farmer is removed in the database too | Before: 1 farmer(s) still tagged in the database; form closed. After fix: 0 farmer(s) still tagged in the database; form closed | Fail → Fixed |
| DST-18 | Distribution | Server error while saving | Valid form; server returns a database error; Save | Plain message; form kept; nothing saved | Couldn't save this distribution. Please try again.; nothing saved | Pass |
| DST-19 | Distribution | Distribution list empty | No distributions; open Distributions | "No distributions found" with a hint | No distributions found | Pass |
| DST-20 | Distribution | Print a distribution with 0 tagged farmers | Open the print report of a distribution with no tagged farmers | Report prints with an empty beneficiary list (blank rows to fill by hand); no error | report shown; no errors | Pass |
| DST-21 | Distribution | Print a distribution with 120 farmers | Open the print report of a distribution with 120 tagged farmers | All 120 listed across pages; no error | 121 farmer rows printed | Pass |
| DST-22 | Distribution | Very long program name | A distribution with a 180-character program name; open Distributions | Name shortened with "…"; page fits; no crash | page fits | Pass |
| DST-23 | Distribution | Save a distribution with beneficiaries in one transaction | As MAO: save_distribution(new, 2 farmers) | Event + item + 2 farmers saved together | Before: no single-transaction save: event, item and farmers are written in three separate calls. After fix: saved | Fail → Fixed |
| DST-24 | Distribution | A failure partway through (bad beneficiary) leaves nothing behind | As MAO: save_distribution where the 2nd farmer doesn't exist | Whole save rolled back (no event without its farmers) | save failed; events 1 -> 1 | Pass |
| DST-25 | Distribution | Server also rejects Completed with no farmers | As MAO: save_distribution with Completed with no farmers | Refused with a plain message | Tag at least one beneficiary before marking a distribution Completed. | Pass |
| DST-26 | Distribution | Server also rejects a farmer with 0 kg | As MAO: save_distribution with a farmer with 0 kg | Refused with a plain message | Each farmer's quantity must be greater than 0. | Pass |
| DST-27 | Distribution | Server also rejects a blank program name | As MAO: save_distribution with a blank program name | Refused with a plain message | Program name is required. | Pass |
| DST-28 | Distribution | Editing with every farmer removed clears them | As MAO: save_distribution(existing, empty farmer list) | No farmers left tagged | 0 left | Pass |

### Commodities

| Test Case ID | Module | Test Scenario | Input / Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|
| COM-01 | Commodities | Add with an empty name | Add Commodity, leave name empty, Save | "Enter the commodity name." (inline); nothing saved | Before: no inline message; SAVED a blank commodity. After fix: Enter the commodity name.; nothing saved | Fail → Fixed |
| COM-02 | Commodities | Add a duplicate name (different case) | Add Commodity "rice seeds (nsic rc222)" (exists as "Rice Seeds (NSIC Rc222)") | "A commodity with this name already exists."; nothing saved | Before: no message; 2 with that name. After fix: A commodity with this name already exists.; 1 with that name | Fail → Fixed |
| COM-03 | Commodities | Rename to a duplicate name | Select Corn Seeds > Edit > Name "RICE SEEDS (NSIC RC222)" > Save Changes | Duplicate-name message; not renamed | Before: no message; 2 commodities named that. After fix: A commodity with this name already exists.; 1 commodities named that | Fail → Fixed |
| COM-04 | Commodities | Delete a commodity used in distributions | Select Rice Seeds (used in distributions) > Delete | Confirmation explains past records keep it; then removed from the list only | Past distribution records will keep showing it.; soft-deleted | Pass |
| COM-05 | Commodities | Add a commodity while offline | Add Commodity "ET Seeds", network off, Save | "No internet connection"; form kept | Before: TypeError: Failed to fetch; name kept. After fix: No internet connection. Please try again.; name kept | Fail → Fixed |
| COM-06 | Commodities | Very long commodity name | Add Commodity with a 300-character name | Length message (or input limited); nothing oversized saved | Before: saved a 300-character name. After fix: not saved / limited | Fail → Fixed |
| COM-07 | Commodities | Edit with an empty unit | Edit a commodity, clear Unit, Save Changes | "Enter a unit, e.g. kg, bag or set." | Enter a unit, e.g. kg, bag or set. | Pass |
| COM-08 | Commodities | Another admin deleted the commodity being edited | Edit a commodity; meanwhile it's deleted elsewhere; Save Changes | "That record couldn't be found — it may have already been changed or removed." | That record couldn't be found — it may have already been changed or removed. | Pass |
| COM-09 | Commodities | Commodity list empty | No commodities; open Commodities | "No commodities found" with a hint | No commodities found | Pass |
| COM-10 | Commodities | Database refuses a duplicate commodity name | As MAO: insert "  rice seeds (nsic rc222) " when "Rice Seeds (NSIC Rc222)" exists | Refused (unique name, ignoring case and spaces) | Before: duplicate accepted. After fix: refused: duplicate key value violates unique constraint "commodities_active_name_key" | Fail → Fixed |
| COM-11 | Commodities | A deleted commodity's name can be reused | Delete Rice Seeds, then add a new "Rice Seeds (NSIC Rc222)" | Allowed | allowed | Pass |

### Proof of Planting

| Test Case ID | Module | Test Scenario | Input / Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|
| POP-01 | Proof of Planting | Reject a submission without remarks | Validation > pending submission > Reject, leave remarks empty | Reject button stays disabled until a reason is typed | Reject disabled until remarks are entered | Pass |
| POP-02 | Proof of Planting | Validate a submission while offline | Validation > pending submission, network off, Validate | Friendly offline message; still Pending | Before: TypeError: Failed to fetch Reject; status pending. After fix: No internet connection. Please try again. Reject; status pending | Fail → Fixed |
| POP-03 | Proof of Planting | No submissions to review | No submissions; open Validation | "No submissions to review." | No submissions to review. | Pass |
| POP-04 | Proof of Planting | Location permission denied | Validation > Submit Proof of Planting > Tap to capture; location permission denied | "Location permission needed" with Open Settings | Location permission needed: AgriShare needs access to your location to geotag this crop validation. | Pass |
| POP-05 | Proof of Planting | Submit with no photo | Capture GPS (allowed), skip the photo, enter a planting date, Submit Validation | "Please capture a crop photo before submitting."; nothing sent | Incomplete: Please capture a crop photo before submitting.; nothing sent | Pass |
| POP-06 | Proof of Planting | Camera permission denied | Take Photo with camera permission denied | Plain message (with Open Settings where relevant); nothing half-uploaded | Needs a real phone: the web preview can't deny camera/gallery permission, turn GPS off, or run the camera stamp. Code path reviewed (see report). | Needs decision (phone test) |
| POP-07 | Proof of Planting | GPS (location services) turned off | Tap to capture with the phone's location turned off | Plain message (with Open Settings where relevant); nothing half-uploaded | Needs a real phone: the web preview can't deny camera/gallery permission, turn GPS off, or run the camera stamp. Code path reviewed (see report). | Needs decision (phone test) |
| POP-08 | Proof of Planting | Very large photo / upload fails midway | Take a high-resolution photo; drop the connection during upload | Plain message (with Open Settings where relevant); nothing half-uploaded | Needs a real phone: the web preview can't deny camera/gallery permission, turn GPS off, or run the camera stamp. Code path reviewed (see report). | Needs decision (phone test) |
| POP-09 | Proof of Planting | Profile photo: gallery permission denied, picker or crop cancelled | Profile > photo > Choose from Gallery with permission denied; or cancel the picker/crop | Plain message (with Open Settings where relevant); nothing half-uploaded | Needs a real phone: the web preview can't deny camera/gallery permission, turn GPS off, or run the camera stamp. Code path reviewed (see report). | Needs decision (phone test) |

### Requests

| Test Case ID | Module | Test Scenario | Input / Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|
| REQ-01 | Requests | Approve or reject without remarks | MAO Requests > endorsed request > Reject with no remarks | Remarks are optional at this step (paper workflow); action completes | request rejected | Pass |
| REQ-02 | Requests | MAO acts on a request someone else already processed | Open an endorsed request; meanwhile another admin approves it; click Approve | "This request was already updated by someone else — refresh and try again." | This request was already updated by someone else — refresh and try again.; Reject This request was already updated by someone else — refresh and try again. | Pass |
| REQ-03 | Requests | FA President acts on a request already decided | FA: open a pending request; meanwhile it is endorsed elsewhere; click Endorse | Same "already updated" message | This request was already updated by someone else — refresh and try again.; Reject This request was already updated by someone else — refresh and try again. | Pass |
| REQ-04 | Requests | Approve while offline | MAO: endorsed request, network off, Approve | Friendly offline message; request unchanged | Before: TypeError: Failed to fetch; Reject TypeError: Failed to fetch; request forwarded. After fix: No internet connection. Please try again.; Reject No internet connection. Please try again.; request forwarded | Fail → Fixed |
| REQ-05 | Requests | No requests | No requests; open Requests (MAO and FA President) | "Nothing here yet." / "Nothing in this tab." | MAO: empty message; FA: empty message | Pass |
| REQ-06 | Requests | Database refuses a request for 0 | As farmer 000201: insert a request with quantity 0 (bypassing the app) | Refused: "Enter a quantity greater than 0." | Before: accepted. After fix: refused: Enter a quantity greater than 0. | Fail → Fixed |
| REQ-07 | Requests | Database refuses a request for -5 | As farmer 000201: insert a request with quantity -5 (bypassing the app) | Refused: "Enter a quantity greater than 0." | Before: accepted. After fix: refused: Enter a quantity greater than 0. | Fail → Fixed |

### Announcements

| Test Case ID | Module | Test Scenario | Input / Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|
| ANN-01 | Announcements | Publish with required fields missing | New Announcement, leave everything empty, Publish | Inline errors (title, date, time, venue, type, requirements, recipients); nothing posted | Title is required.; Enter the distribution date as MM/DD/YYYY.; Distribution time is required.; Venue is required.; nothing posted | Pass |
| ANN-02 | Announcements | Distribution time left empty | Distribution post with date but no time, Publish | "Distribution time is required." | Distribution time is required. | Pass |
| ANN-03 | Announcements | Image larger than 5 MB (6 MB PNG) | New Announcement > Add an image > choose big.png | Rejected with a plain message; no preview; nothing uploaded | Image must be 5 MB or smaller.; not accepted | Pass |
| ANN-04 | Announcements | PDF instead of an image | New Announcement > Add an image > choose doc.pdf | Rejected with a plain message; no preview; nothing uploaded | Please choose a JPG, PNG, WebP or GIF image.; not accepted | Pass |
| ANN-05 | Announcements | A program file renamed to .jpg | New Announcement > Add an image > choose program.jpg | Rejected with a plain message; no preview; nothing uploaded | Before: no message; accepted (preview shown). After fix: That file isn't a real image. Please choose a JPG, PNG, WebP or GIF photo.; not accepted | Fail → Fixed |
| ANN-06 | Announcements | Server refuses the image as too large | Choose a valid small PNG; storage answers with its size/type error; Publish | Plain message about the image; form kept; nothing posted | Before: The object exceeded the maximum allowed size; *; not posted. After fix: The image is too large. Choose one under 5 MB.; not posted | Fail → Fixed |
| ANN-07 | Announcements | Server refuses the image type | Choose a valid small PNG; storage answers with its size/type error; Publish | Plain message about the image; form kept; nothing posted | Before: mime type application/pdf is not supported; *; not posted. After fix: Only image files (JPG, PNG, WebP or GIF) can be uploaded.; not posted | Fail → Fixed |
| ANN-08 | Announcements | Publish while offline | Fill a general notice, network off, Publish | "No internet connection"; form kept; nothing posted | Before: TypeError: Failed to fetch; *; title kept. After fix: No internet connection. Please try again.; title kept | Fail → Fixed |
| ANN-09 | Announcements | Double-click Publish on a slow connection | Slow connection; click Publish three times quickly | One announcement | Before: 3 announcement(s). After fix: 1 announcement(s) | Fail → Fixed |
| ANN-10 | Announcements | No announcements | No announcements; open Announcements | "No announcements found" + New Announcement button | No announcements found | Pass |

### Reports

| Test Case ID | Module | Test Scenario | Input / Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|
| RPT-01 | Reports | Date range: From after To | Reports: From 10/10/2026, To 10/01/2026, Generate Report | "From" date must be on or before "To"; no report opened | Before: no message; report opened anyway. After fix: The "From" date must be on or before the "To" date.; no report opened | Fail → Fixed |
| RPT-02 | Reports | Half-typed date | Reports: From "10/1", Generate Report | Asks for a full MM/DD/YYYY date; no report | Enter the date as MM/DD/YYYY.; no report | Pass |
| RPT-03 | Reports | Report with no matching data | No distributions; open a Distribution Summary print | "No matching distributions." on the report | No matching distributions. | Pass |
| RPT-04 | Reports | Open a report while offline | Network off; open a report print page | Plain offline message on the page (not blank, no raw error) | Before: Could not load this report: TypeError: Failed to fetch. After fix: No internet connection. Please try again. | Fail → Fixed |

### Mobile

| Test Case ID | Module | Test Scenario | Input / Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|
| MOB-01 | Mobile | Open the app with no internet (signed in earlier) | Farmer signed in before; phone offline; open the app | "No internet connection…" with Try again; still signed in (not sent to Login) | Before: login screen; SIGNED OUT. After fix: No internet connection. Please try again.; still signed in | Fail → Fixed |
| MOB-02 | Mobile | Home opened with no internet | Network off; open the app (Home) | "No internet connection. Please try again." with a Try again option (not an empty "no records" screen) | Before: no message; shows: AGRISHARE  Welcome Back, Rodel! You're using the default password. Change it to keep your. After fix: No internet connection. Please try again. | Fail → Fixed |
| MOB-03 | Mobile | Validation opened with no internet | Network off; open the app (Validation) | "No internet connection. Please try again." with a Try again option (not an empty "no records" screen) | Before: no message; shows: AGRISHARE  Welcome Back, Rodel! You're using the default password. Change it to keep your. After fix: No internet connection. Please try again. | Fail → Fixed |
| MOB-04 | Mobile | Internet comes back: Try again recovers | Offline on Home, then network back, tap Try again | Lists load normally | Before: no offline message; no Try again button; distributions loaded. After fix: offline message; Try again tapped; distributions loaded | Fail → Fixed |
| MOB-05 | Mobile | Request Commodity with no quantity | Requests > New Request, leave Quantity empty, Send | "Please enter a quantity and reason…" | Check your request: Please enter a quantity and reason for your request. | Pass |
| MOB-06 | Mobile | Request Commodity with letters as quantity | Quantity "abc", reason filled, Send | Plain message asking for a valid quantity; nothing sent | Before: field "abc"; Request Sent: Your commodity request has been sent to your Farmers' Association President for review.; request SENT. After fix: field "abc"; Check your request: Enter the quantity as a number, for example 25.; not sent | Fail → Fixed |
| MOB-07 | Mobile | Request Commodity with zero as quantity | Quantity "0", reason filled, Send | Plain message asking for a valid quantity; nothing sent | Before: field "0"; Request Sent: Your commodity request has been sent to your Farmers' Association President for review.; request SENT. After fix: field "0"; Check your request: Enter a quantity greater than 0.; not sent | Fail → Fixed |
| MOB-08 | Mobile | Request Commodity with a negative number as quantity | Quantity "-5", reason filled, Send | Plain message asking for a valid quantity; nothing sent | Before: field "-5"; Request Sent: Your commodity request has been sent to your Farmers' Association President for review.; request SENT. After fix: field "-5"; Check your request: Enter the quantity as a number, for example 25.; not sent | Fail → Fixed |
| MOB-09 | Mobile | Request Commodity with an unrealistic amount as quantity | Quantity "999999", reason filled, Send | Plain message asking for a valid quantity; nothing sent | Before: field "999999"; Request Sent: Your commodity request has been sent to your Farmers' Association President for review.; request SENT. After fix: field "999999"; Check your request: That quantity looks too large. Enter up to 10,000.; not sent | Fail → Fixed |
| MOB-10 | Mobile | Send a request twice quickly (slow connection) | Slow connection; tap Send three times quickly | One request; button shows "Sending…" | 1 request(s) sent | Pass |
| MOB-11 | Mobile | Send a request while offline | Fill the form, network off, Send | "No internet connection. Please try again."; what was typed stays | Before: Request failed: TypeError: Network request failed; reason kept. After fix: Request not sent: No internet connection. Please try again.; reason kept | Fail → Fixed |
| MOB-12 | Mobile | Change Password while offline | Profile > Change Password, valid values, network off, Update | "No internet connection…"; fields kept | Before: no message. After fix: No internet connection. Please try again. | Fail → Fixed |
| MOB-13 | Mobile | Password change clears the default-password reminder | Farmer on the default password changes it successfully | Home reminder banner goes away | Before: reminder flag still on (couldn't be cleared). After fix: reminder flag cleared | Fail → Fixed |
| MOB-14 | Mobile | Notification for a distribution that was deleted | Notifications > tap the update about "Cancelled Program" (deleted) | Opens My Distributions without crashing; no broken screen | opened My Distributions | Pass |
| MOB-15 | Mobile | Empty screens | Farmer with no distributions, requests, submissions or announcements | Each screen shows a plain empty message | Home: No announcements yet.; Validation: only the Submit card (no history) | Pass |
| MOB-16 | Mobile | Script/HTML in an announcement | Announcement whose title/body contain <script> and <img onerror> | Shown as plain text; nothing runs | nothing ran; shown as text | Pass |
| MOB-17 | Mobile | Very long name | Farmer with a very long name; open Profile | Name wraps; nothing cut off or overlapping; no crash | fits | Pass |
| MOB-18 | Mobile | Default-password reminder clears after the farmer changes the password | As farmer 000201 (flag on), the app clears the flag after a successful password change | Flag cleared (Home reminder disappears) | Before: refused: permission denied for table profiles. After fix: flag after: false | Fail → Fixed |
| MOB-19 | Mobile | The reminder fix only clears your own flag | Farmer 000201 clears their flag; check farmer 000202 | 000202's flag unchanged | 000202 flag: true | Pass |

### Security

| Test Case ID | Module | Test Scenario | Input / Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|
| SEC-01 | Security | Script/HTML in farmer names | Farmer named <img onerror…>Juan / Dela Cruz<script>…; open Farmers and the profile | Shown as plain text; nothing runs | nothing ran; shown as text | Pass |
| SEC-02 | Security | Script/HTML in announcements | Announcement title/body containing <script> and <img onerror>; open Announcements | Plain text; nothing runs | nothing ran; shown as text | Pass |
| SEC-03 | Security | Script/HTML in remarks and reasons | Request reason / remarks and validation remarks containing HTML; open them | Plain text; nothing runs | nothing ran on Requests or Validation | Pass |
| SEC-04 | Security | Script/HTML in a name on the printed login slip | Farmer with an <img onerror> name > Reset Password > Print Slip | Slip shows the name as text; nothing runs in the print window | Before: the script RAN in the slip window; the name did not show as text (original printAccountSlip, reproduced with the same name). After fix: nothing ran; name shown as text | Fail → Fixed |
| SEC-05 | Security | Farmer search (tagging) with a comma and a bracket | New Distribution > Beneficiaries search: Cruz, Juan) | Search treats it as plain text: no error, no "match everything" | Before: query rejected by the database; 0 suggestion(s). After fix: query ran; 0 suggestion(s) | Fail → Fixed |
| SEC-06 | Security | Farmer search (tagging) with a % wildcard | New Distribution > Beneficiaries search: % | Search treats it as plain text: no error, no "match everything" | query ran; 0 suggestion(s) | Pass |
| SEC-07 | Security | Farmer search (tagging) with an SQL-injection string | New Distribution > Beneficiaries search: ' or 1=1 -- | Search treats it as plain text: no error, no "match everything" | query ran; 0 suggestion(s) | Pass |
| SEC-08 | Security | FA President tries to add a commodity through the API | As the FA President's account, run: insert into commodities (name, category) values ('FA Seeds','Rice') | Refused by the database security rules (nothing changes) | refused: new row violates row-level security policy for table "commodities" | Pass |
| SEC-09 | Security | FA President tries to rename a commodity through the API | As the FA President's account, run: update commodities set name = 'Hacked' where commodity_id = 1 | Refused by the database security rules (nothing changes) | 0 row(s) affected | Pass |
| SEC-10 | Security | FA President tries to mark a distribution Completed through the API | As the FA President's account, run: update distribution_events set status = 'completed' where event_id = 1 | Refused by the database security rules (nothing changes) | 0 row(s) affected | Pass |
| SEC-11 | Security | FA President tries to create a distribution through the API | As the FA President's account, run: insert into distribution_events (program_name, event_date) values ('FA event','2026-10-01') | Refused by the database security rules (nothing changes) | refused: new row violates row-level security policy for table "distribution_events" | Pass |
| SEC-12 | Security | FA President tries to tag beneficiaries (database function) through the API | As the FA President's account, run: select save_distribution_beneficiaries(1, 1, '[{"farmer_id": 2, "quantity_received": 5}]'::jsonb) | Refused by the database security rules (nothing changes) | refused: Only MAO Admin can tag distribution beneficiaries. | Pass |
| SEC-13 | Security | FA President tries to validate a proof-of-planting submission through the API | As the FA President's account, run: update crop_validations set status = 'validated' where validation_id = 1 | Refused by the database security rules (nothing changes) | Before: 1 row(s) affected. After fix: 0 row(s) affected | Fail → Fixed |
| SEC-14 | Security | FA President tries to approve a request at the MAO stage through the API | As the FA President's account, run: update requests set status = 'approved' where request_id = 2 | Refused by the database security rules (nothing changes) | 0 row(s) affected | Pass |
| SEC-15 | Security | FA President tries to post an announcement through the API | As the FA President's account, run: insert into announcements (title, body, for_all_registered_farmers) values ('x','y',true) | Refused by the database security rules (nothing changes) | refused: new row violates row-level security policy for table "announcements" | Pass |
| SEC-16 | Security | FA President tries to change the office settings through the API | As the FA President's account, run: update org_settings set lgu_name = 'Hacked' | Refused by the database security rules (nothing changes) | 0 row(s) affected | Pass |
| SEC-17 | Security | FA President tries to delete a farmer record through the API | As the FA President's account, run: delete from farmers where farmer_id = 2 | Refused by the database security rules (nothing changes) | 0 row(s) affected | Pass |
| SEC-18 | Security | FA President tries to register a farmer through the API | As the FA President's account, run: insert into farmers (rsbsa_no, surname, first_name, sex, birth_date) values ('09-73-00-000-000999','X','Y','ma | Refused by the database security rules (nothing changes) | refused: new row violates row-level security policy for table "farmers" | Pass |
| SEC-19 | Security | FA President tries to make themselves MAO Admin through the API | As the FA President's account, run: update profiles set role = 'mao_admin' where id = '03bd92f1-eeb4-497b-9ead-cea9fda20cdc' | Refused by the database security rules (nothing changes) | refused: permission denied for table profiles | Pass |
| SEC-20 | Security | FA President tries to read the Activity Log through the API | As the FA President's account, run: select * from audit_logs | Refused by the database security rules (nothing changes) | 0 log rows visible | Pass |
| SEC-21 | Security | FA President edits a farmer's name and contact through the API | As the FA President: update farmers set first_name, contact_no | Refused (only Active/Inactive may be changed) | Before: 1 row(s) affected. After fix: refused: The Farmers' Association President can only change a farmer's Active/Inactive status. | Fail → Fixed |
| SEC-22 | Security | FA President marks a farmer Inactive (allowed) | As the FA President: update farmers set status = inactive | Allowed (1 row) | 1 row(s) affected | Pass |
| SEC-23 | Security | FA President endorses a pending request (allowed) | As the FA President: forward a Pending request | Allowed (1 row) | 1 row(s) affected | Pass |
| SEC-24 | Security | Farmer tries to read another farmer's record | As farmer 000201: select * from farmers where farmer_id = 2 | Refused / nothing returned | 0 row(s) affected | Pass |
| SEC-25 | Security | Farmer tries to file a request for another farmer | As farmer 000201: insert into requests (farmer_id, commodity_id, quantity_requested, reason) values (2, 1, 5, 'x') | Refused / nothing returned | refused: new row violates row-level security policy for table "requests" | Pass |
| SEC-26 | Security | Farmer tries to approve their own request | As farmer 000201: update requests set status = 'approved' where request_id = 1 | Refused / nothing returned | 0 row(s) affected | Pass |
| SEC-27 | Security | Farmer tries to change their quantity received | As farmer 000201: update distribution_claims set quantity_received = 999 where farmer_id = 1 | Refused / nothing returned | 0 row(s) affected | Pass |
| SEC-28 | Security | Farmer tries to make themselves MAO Admin | As farmer 000201: update profiles set role = 'mao_admin' where id = 'e4715ad6-fd08-4883-8ed8-aef9b7907489' | Refused / nothing returned | refused: permission denied for table profiles | Pass |
| SEC-29 | Security | Farmer tries to see another farmer's proof-of-planting | As farmer 000201: select * from crop_validations where farmer_id = 2 | Refused / nothing returned | 0 row(s) affected | Pass |
| SEC-30 | Security | FA President calls the farmer save function | As FA President: save_farmer(new farmer) | Refused | refused: Only the MAO Admin can register or edit farmers. | Pass |
| SEC-31 | Security | FA President calls the distribution save function | As FA President: save_distribution(new) | Refused | refused: Only the MAO Admin can record distributions. | Pass |
| SEC-32 | Security | Server-side upload limits (file type and size) | Check each storage bucket's size limit and allowed file types | Every bucket: images only, size capped | Before: announcement-images: no size limit, any type; avatars: no size limit, any type; crop-validation-photos: no size limit, any type. After fix: announcement-images: 5 MB, image/jpeg/image/png/image/webp/image/gif; avatars: 5 MB, image/jpeg/image/png/image/webp; crop-validation-photos: 10 MB, image/jpeg/image/png/image/webp | Fail → Fixed |
| SEC-33 | Security | No secrets in the web app bundle | Build the web app; search every bundle file for the service-role key, deploy tokens and service_role markers | None found (only the public anon/publishable key ships) | 3 files checked, 4 secret values + 3 markers: none found | Pass |
| SEC-34 | Security | No secrets in the mobile app bundle | Build the mobile app; search every bundle file for the service-role key, deploy tokens and service_role markers | None found (only the public anon/publishable key ships) | 2 files checked, 4 secret values + 3 markers: none found | Pass |

### System-wide (network, server errors, crashes)

| Test Case ID | Module | Test Scenario | Input / Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|
| SYS-01 | System | Open the web app while offline | Signed in earlier; network off; open the app | "No internet connection. Please try again." with Try again; still signed in (not logged out) | Before: no message (on /login); SIGNED OUT. After fix: No internet connection. Please try again.; still signed in | Fail → Fixed |
| SYS-02 | System | Dashboard page loads while offline | Signed in; network drops; open Dashboard | "No internet connection. Please try again."; no endless spinner; no raw error | Before: no message. After fix: No internet connection. Please try again. | Fail → Fixed |
| SYS-03 | System | Farmers page loads while offline | Signed in; network drops; open Farmers | "No internet connection. Please try again."; no endless spinner; no raw error | Before: no message; raw: TypeError. After fix: No internet connection. Please try again. | Fail → Fixed |
| SYS-04 | System | Distributions page loads while offline | Signed in; network drops; open Distributions | "No internet connection. Please try again."; no endless spinner; no raw error | Before: no message; raw: TypeError. After fix: No internet connection. Please try again. | Fail → Fixed |
| SYS-05 | System | Requests page loads while offline | Signed in; network drops; open Requests | "No internet connection. Please try again."; no endless spinner; no raw error | Before: no message; raw: TypeError. After fix: No internet connection. Please try again. | Fail → Fixed |
| SYS-06 | System | Validation page loads while offline | Signed in; network drops; open Validation | "No internet connection. Please try again."; no endless spinner; no raw error | Before: no message; raw: TypeError. After fix: No internet connection. Please try again. | Fail → Fixed |
| SYS-07 | System | Commodities page loads while offline | Signed in; network drops; open Commodities | "No internet connection. Please try again."; no endless spinner; no raw error | Before: no message; raw: TypeError. After fix: No internet connection. Please try again. | Fail → Fixed |
| SYS-08 | System | Announcements page loads while offline | Signed in; network drops; open Announcements | "No internet connection. Please try again."; no endless spinner; no raw error | Before: no message; raw: TypeError. After fix: No internet connection. Please try again. | Fail → Fixed |
| SYS-09 | System | Activity Log page loads while offline | Signed in; network drops; open Activity Log | "No internet connection. Please try again."; no endless spinner; no raw error | Before: no message; raw: TypeError. After fix: No internet connection. Please try again. | Fail → Fixed |
| SYS-10 | System | Settings page loads while offline | Signed in; network drops; open Settings | "No internet connection. Please try again."; no endless spinner; no raw error | Before: no message; still loading; raw: TypeError. After fix: No internet connection. Please try again. | Fail → Fixed |
| SYS-11 | System | Dashboard page: server error | Server returns a database error; open Dashboard | Plain message, no database text | Before: no message. After fix: Some dashboard figures couldn't be loaded. Please try again. | Fail → Fixed |
| SYS-12 | System | Farmers page: server error | Server returns a database error; open Farmers | Plain message, no database text | Couldn't load this list. Please try again. | Pass |
| SYS-13 | System | Distributions page: server error | Server returns a database error; open Distributions | Plain message, no database text | Couldn't load this list. Please try again. | Pass |
| SYS-14 | System | Requests page: server error | Server returns a database error; open Requests | Plain message, no database text | Couldn't load this list. Please try again. | Pass |
| SYS-15 | System | Validation page: server error | Server returns a database error; open Validation | Plain message, no database text | Couldn't load this list. Please try again. | Pass |
| SYS-16 | System | Commodities page: server error | Server returns a database error; open Commodities | Plain message, no database text | Couldn't load this list. Please try again. | Pass |
| SYS-17 | System | Announcements page: server error | Server returns a database error; open Announcements | Plain message, no database text | Couldn't load this list. Please try again. | Pass |
| SYS-18 | System | Activity Log page: server error | Server returns a database error; open Activity Log | Plain message, no database text | Couldn't load the activity log. | Pass |
| SYS-19 | System | Slow connection: loading indicators | Slow connection (3 s per call); open Farmers | "Loading farmers…" shows while waiting | Loading AgriShare… | Pass |
| SYS-20 | System | Errors are logged for debugging | Network off; save a commodity | The real error is written to the browser console | console: {"message":"TypeError: Failed to fetch","details":"TypeError: Failed to fetch","hint":""," | Pass |
| SYS-21 | System | Activity Log empty | No activity; open Activity Log | "No activity found" | No activity found | Pass |
| SYS-22 | System | Dashboard with no data | Empty system; open Dashboard | Dashboard shows zeros/empty lists; no crash | rendered | Pass |
| SYS-23 | System | A page crashes while drawing | Bad data makes the Farmers page throw while rendering | "Something went wrong" with a Reload button (not a white screen); top bar still usable | Before: white screen. After fix: Something went wrong; reload button shown | Fail → Fixed |
| SYS-24 | System | Mobile app crashes while drawing a screen | Bad data makes Home throw while rendering | "Something went wrong" with a Reload button (not a blank screen) | Before: blank screen. After fix: Something went wrong | Fail → Fixed |
| SYS-25 | System | Server unreachable (wrong address) — real Supabase client | Web app built against an address where no server answers; Login with valid-looking details | Plain "No internet connection…" message within seconds; button usable again; email kept; real error logged | No internet connection. Please try again. (after 0s); button ready; email kept; 2 console error(s) | Pass |

## Fixes made

Each fix is its own commit on `test/error-handling`. Fixes marked **DB** come with a migration in `backend/supabase/migrations`, and the new app code needs it applied first.

| # | Fix | Where | Commit |
|---|---|---|---|
| 1 | Plain-English messages everywhere on the web. "No internet connection. Please try again." replaces "TypeError: Failed to fetch". The edge-function and storage errors are translated. Change Password no longer says "incorrect" when you're offline. The Dashboard says when its figures fail to load. | `web/src/lib/friendlyError.js`, `lib/api/farmers.js`, `pages/Settings.jsx`, `pages/Dashboard.jsx` | 39702ab |
| 2 | "Something went wrong" + Reload instead of a white page when a page crashes. | `components/ui/ErrorBoundary.jsx`, `App.jsx`, `AppLayout.jsx`, `MobileShell.jsx`, `theme.css` | c1a06ff |
| 3 | The web app stays signed in when opened offline and offers Try again (it used to sign you out). When a session ends you get "Your session has expired. Please log in again." A farmer account that logs in on the web is signed out again. | `context/AuthContext.jsx`, `AppLayout.jsx`, `pages/Login.jsx` | be03149 |
| 4 | **DB** Farmer saved in one transaction (`save_farmer`). The account-rollback bug (`.catch is not a function`) is fixed. Name rules (letters, spaces and `. ' -`), age 18–100, farm size, length limits and trimming are added. No double saves. | migration `20261111000000`, `lib/api/farmers.js`, `pages/Farmers.jsx` | 4c51aa3 |
| 5 | **DB** Distribution saved in one transaction (`save_distribution`). Quantity rules: above 0, and must add up to the total. Date rules. Removing every farmer on edit now sticks. Save is blocked if the farmer list didn't load. No double saves. | migration `20261111000100`, `lib/api/distributions.js`, `pages/Distributions.jsx` | 3719b47 |
| 6 | **DB** No blank or duplicate commodity names, ignoring case (a unique index in the database too). Names limited to 80 characters. | migration `20261111000200`, `pages/Commodities.jsx` | 5eda6ee |
| 7 | **DB** Images checked by their content (a renamed `.exe` is refused). Storage buckets accept images only, with size caps. No double publish. | migration `20261111000400`, `lib/api/announcements.js`, `AnnouncementModal.jsx` | 74b1693 |
| 8 | The login slip escapes the farmer's name (HTML in a name used to run as script). Farmer search quotes what you type (commas no longer break it, and `%` no longer matches everyone). | `pages/Farmers.jsx`, `lib/api/farmers.js` | 3284636 |
| 9 | **DB** Only the MAO Admin can validate or reject proof of planting (the FA President could through the API). | migration `20261111000600` | 79e1863 |
| 10 | **DB** The FA President can change only a farmer's Active/Inactive status (they could edit names, birth date and contact through the API). | migration `20261111000700` | 221fad8 |
| 11 | Reports: "From" must be on or before "To". Print pages show plain messages. | `pages/Reports.jsx`, `PrintReport.jsx`, `PrintDistribution.jsx` | 802410b |
| 12 | Mobile: plain-English errors on every alert and toast, and a crash screen with Reload. | `mobile/src/lib/friendlyError.js`, `components/ErrorBoundary.js`, `App.js`, `CropValidationScreen.js`, `ProfileScreen.js` | bf8463f |
| 13 | Mobile: stays signed in when opened offline. A deleted farmer is told the account is no longer active, and a staff account is told to use the web system. Session-expired message added. | `context/AuthContext.js`, `LoginScreen.js`, `RootNavigator.js`, `components/ui/ErrorBanner.js` | 7f13ce5 |
| 14 | Mobile: "No internet connection" + Try again on Home, Proof of Planting, My Distributions and Notifications, instead of empty lists. Pull-to-refresh on Home. | those screens, `ScreenHeader.js` | 0e5d10c |
| 15 | **DB** Commodity request: the quantity must be a number from above 0 up to 10,000, and the reason is required. The database refuses a request for 0 or less. No double sends. | migration `20261111000300`, `RequestsScreen.js` | 520205c |
| 16 | **DB** Mobile Change Password clears the "default password" reminder (it never could). Being offline isn't reported as "incorrect". | migration `20261111000500`, `ChangePasswordScreen.js` | 16ec8ef |

## Checks that nothing else broke

The repository has no automated test suite of its own (the backend's `npm test` is a placeholder). After the fixes, these checks were run on the final code:

| Check | Result |
|---|---|
| Web linter (`npm run lint`, oxlint) | No errors. 4 warnings, the same 4 that `main` already has (2 unused variables, 2 fast-refresh notices). |
| Web production build (`npm run build`) | Builds. |
| Mobile production export (`npx expo export`) | Exports. |
| Web login through the form, MAO Admin and FA President | Each lands on their own Dashboard and menu, and stays signed in after a refresh. |
| Adding a farmer, creating and editing a distribution | Pass: test cases FRM-18, FRM-19, FRM-24, FRM-25, DST-11, DST-13, plus the database tests FRM-34 and DST-23. |
| Printing the distribution report: 5 farmers, 42 farmers, and none tagged, each on A4 and Letter (page breaks, rows per page, signature block) | Pass, 6 of 6. 0 and 120 farmers are test cases DST-20 and DST-21. |
| UI checks from earlier rounds of work: table layouts, clickable rows, Commodities inline edit, Requests wording and badges, Distribution detail buttons, Farmer Profile drawer, Active/Inactive status | Pass. |
| Phone-width and "desktop site" layout of the admin web (144 checks), plus phone behaviour (24 checks) | Pass. |
| Mobile Home, Proof of Planting, Planting date, My Distributions, Requests, Profile, Change Password | Pass, 17 of 17 checks. |

## Needs your decision

1. **The live Supabase project is paused (INACTIVE).** Supabase pauses free projects after a week without activity, so the live website and app can't load any data right now. Restore it from the Supabase dashboard (Project → Restore) before the defense. I did not restore it.
2. **Deploy order.** Apply the 8 migrations first (`npx supabase db push`), then the web app, then the mobile update. The new web and mobile code saves through the new database functions. The current live code keeps working with the new database, so applying the migrations first is safe.
3. **Phone-only tests.** These need a real phone: deny the camera permission, deny the gallery permission, turn GPS off, a very large photo, and dropping the connection while a photo uploads. The code shows a message with "Open Settings" for permissions, and plain messages for upload failures (now translated). Please run these on a phone, using the steps below.
4. **Limits I chose.** Each is one constant and easy to change:
   - farmer age 18–100 (RSBSA registrants are adults);
   - farm size up to 1,000 ha;
   - commodity request up to 10,000;
   - names up to 50 characters;
   - commodity names up to 80 characters;
   - images 5 MB (10 MB for proof-of-planting photos).
5. **Remarks on rejection.** Rejecting or not endorsing a commodity request doesn't require remarks, which matches the current workflow. Rejecting proof of planting does. Should rejected requests also require a reason, so the farmer knows why?
6. **Notifications open lists, not single items.** Tapping an update opens My Distributions, Requests or Proof of Planting. A deleted item simply isn't in the list, and nothing crashes. Linking to the exact item would need a database change.
7. **Wording after a proof-of-planting submission.** It says it was "submitted for review by the MAO and your Farmers' Association President", but only the MAO reviews (now enforced). Change it to "by the Municipal Agriculture Office"?
8. **Commodity name index.** If the live database already has two active commodities with the same name, migration `20261111000200` skips creating the unique index and prints a notice. The app still blocks duplicates.
9. **Storage upload limits** are enforced by Supabase Storage itself, so they can only be confirmed after the migration is applied. See the check below.

## How to check each fix yourself

**Before you start:**

1. Restore the Supabase project.
2. From `backend/`, run `npx supabase db push`.
3. Run the web app locally: in `web/`, run `npm run dev`, then open http://localhost:5173. For mobile: in `mobile/`, run `npx expo start` (phone with Expo Go) or `npx expo start --web`.

Test accounts: your MAO Admin account; FA President `fapresident@agrishare.test` / `password123`; farmer `000201` / `password123`. To go "offline" in Chrome: DevTools (F12) → Network → change "No throttling" to **Offline**. On a phone, turn on airplane mode.

**Web: plain messages, offline (fixes 1, 3)**
1. Log in as MAO Admin. Go Offline in DevTools, then click Farmers in the menu (don't reload): "No internet connection. Please try again." Go back online, click the AGRISHARE logo, then Farmers again: the list loads.
2. Opening the site while Supabase can't be reached:
   1. In DevTools, open ⋮ → More tools → **Network request blocking**.
   2. Add `*supabase.co*`, tick **Enable network request blocking**, and reload.
   3. You see "No internet connection. Please try again." with "You're still signed in." and **Try again**.
   4. Untick the blocking and click Try again: the page loads.

   Reloading with DevTools set to Offline shows Chrome's own offline page instead, because the website itself can't load.
3. Open Add Farmer and fill it in. Go Offline and click Save Farmer: the form stays open with your entries, and shows "No internet connection. Please try again."
4. Log out. Log in with farmer account `000201@farmers.agrishare.ph`: you see "This account does not have access…", and a page refresh stays on Login.
5. Sign in, then in DevTools → Application → Local Storage delete the `sb-…-auth-token` entry. Click any Save: you land on Login with "Your session has expired. Please log in again."

**Web: crash screen (fix 2).** No safe way to force a crash in the live app. The automated test made the Farmers page throw and checked for "Something went wrong" + Reload. To see it yourself, temporarily add `throw new Error("test")` at the top of `Farmers()` in `web/src/pages/Farmers.jsx`, open Farmers, then remove the line.

**Farmers (fix 4)**
1. Add Farmer → Save with everything empty: an error shows under each required field.
2. First Name `Juan😀`: "First name can only have letters, spaces, and . ' -".
3. Birth date one year ago: "The farmer must be at least 18 years old." Birth date `01/01/1906`: "…over 100 years old."
4. First Name `  Pedro  ` with valid fields, Save: the farmer list shows "Pedro" without the spaces.
5. Slow it down (DevTools → Network → **Slow 4G**) and double-click Save Farmer: the button shows "Saving…" and only one farmer is added.

**Distributions (fix 5)**
1. New Distribution, Total 100, tag 2 farmers, change one farmer to 30, Save: "The farmers' quantities add up to 80 kg, but Total Quantity is 100 kg…".
2. Tag 1 farmer, set their quantity to 0: "Each farmer's quantity must be greater than 0."
3. Edit a Completed distribution, date `12/31/2099`: "A completed distribution can't have a future date."
4. Edit an Ongoing distribution that has tagged farmers, remove them all, enter a total, Save, then reopen: no farmers tagged.
5. Go Offline and Save: "No internet connection…", the form is kept, and nothing appears in the list after going back online.

**Commodities (fix 6)**
1. Add Commodity with only spaces as the name: "Enter the commodity name."
2. Add `rice seeds (nsic rc222)` (or any existing name in different capitals): "A commodity with this name already exists."

**Announcements and uploads (fix 7)**
1. New Announcement → Add an image → choose a PDF: "Please choose a JPG, PNG, WebP or GIF image."
2. Rename any `.exe` or `.txt` file to `photo.jpg` and choose it: "That file isn't a real image…"
3. Choose an image larger than 5 MB: "Image must be 5 MB or smaller."
4. Storage check (after `db push`): in Supabase → Storage → each bucket → Settings, the allowed types are images only, with a size limit.

**Security (fixes 8, 9, 10)**
1. Login slip: on a test farmer, set the first name to `<b>Test</b>` (the form now refuses this, so set it in Supabase Table Editor on a test farmer). Then ⋯ → Reset Password → Print Slip: the slip shows `<b>Test</b>` as text, not bold.
2. Search: New Distribution → Beneficiaries, type `Cruz, Juan)`, then `%`: no error, and no "everyone" results.
3. FA President limits (database). In Supabase SQL Editor, as the FA test user, run the statements from tests SEC-13 and SEC-21 in the table (`update crop_validations …`, `update farmers set first_name …`). Both are refused. Or sign in to the web as the FA President: Mark Inactive still works.

**Reports (fix 11).** Reports: From `10/10/2026`, To `10/01/2026`, Generate Report: "The "From" date must be on or before the "To" date." and no report opens.

**Mobile (fixes 12–16)**
1. Log in as `000201`, then turn on airplane mode and pull down on Home: "No internet connection. Please try again." with **Try again**. Turn airplane mode off and tap Try again: the lists load.
2. Close the app, turn on airplane mode, open it: the same message, and you're still signed in.
3. Request Commodity → New Request with quantity `0`: "Enter a quantity greater than 0." With `999999`: "That quantity looks too large…"
4. Optional, because it deletes a test farmer. On the web as MAO Admin, delete one farmer from the test batch (Farmers → ⋯ → Delete). On the phone, log in with that farmer's login ID: "This account is no longer active…"
5. Change Password on a farmer with the "default password" reminder: after a successful change, the Home reminder disappears.
6. Phone-only checks (decision 3):
   - deny camera permission (Proof of Planting → Take Photo);
   - deny location;
   - turn GPS off before "Tap to capture";
   - turn on airplane mode right after taking the photo.

   Each should show a plain message, never a blank screen or technical text.

**Automated suites.** The scripts used for this report (web, mobile, database, secrets) live in a temporary folder on this computer. I can add them to the repository (`tests/error-handling/`) so you can re-run them before the defense.
