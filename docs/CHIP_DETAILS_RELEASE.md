# Chip details restored - 2026-09-25

## Scope

Double-click (or focus + Enter) on a flow chip opens the restored detail actions.
The parts badge opens details with the parts section expanded.
Restored actions: plate, consultant, technician, service, wash, advance wash,
customer waiting, immobilization, workshop parts request, history, stage correction,
explicit delivery promise, cancellation, road-test form/signature/PDF.
Existing role restrictions also apply in Firestore rules, not just in the UI.
Cancellation preserves records and history; it is not a physical delete.

Other pages remain suspended. Basic preparation is unchanged. Scheduled chips
from dates other than today remain hidden, without deleting their records.

The + Passante button is restored for flow roles, including Consultor. It records
the actual receipt time, requires consultant/technician/promise, and assigns Igo
for Embelezamento. It operates on today's date only. Pending old appointments
can be reused after confirmation, preserving their history and linked parts.

## Database budget

- Board: unchanged two bounded vehicle listeners (301 active / 101 delivered).
- Open details: zero extra document reads, using the current board record.
- Open parts: one direct get, one vehicle-id query limited to 21, and one chassis
  query limited to 21 if the chassis is meaningful. At most 43 returned documents;
  empty queries still have minimum charges. No plate/null matching.
- Parts section reopens within the same modal reuse its loaded result. Explicit
  refresh reloads it; successful edits invalidate it. No parts listener.
- History: one ordered query per explicit request, limit 51, displaying 50 with
  a pagination cursor. Existing delivery promises are merged locally.
- Catalog: one metadata get plus up to 100 chunk gets, only on field interaction,
  shared once per browser session. No catalog collection listener.
- Common save: one transaction document read and two writes (vehicle + event).
- Walk-in: conflict check against the already loaded active chips, then one
  targeted transaction read and two writes. Deterministic day/identity IDs prevent
  retries from replacing an existing walk-in. No appointments/walkInCustomers
  mirror writes and no automatic parts lookup. Different identities arriving
  concurrently through preparation are not protected by a shared global lock.
- Parts save: two transaction reads and three writes (order + vehicle + event).
  Existing order status and financial fields are preserved.
- Normal delivery remains one read / three writes. Advanced wash completion uses
  the existing transaction; it adds no query or write.
- No writes in effects, timers, render paths or snapshot callbacks.
- Rule profile lookups may add dependent reads. Concurrent transaction retries
  and reconnects can add reads. Each changed vehicle is sent to subscribed clients.
- Example: 10 connected clients and 100 common saves imply roughly 200 writes,
  100 transaction reads and up to 1,000 changed-document deliveries, in addition
  to initial loads, rules-dependent reads, retries and requested history/parts.
  These are estimates, not a guarantee of remaining daily quota.

Road-test signatures remain inside the vehicle record, as in the existing data
model. They increase transferred bytes, although not document counts per update.

## Verification

- `node --test tests/basic-flow.test.cjs tests/limited-operation.test.cjs tests/chip-details.test.cjs tests/basic-walk-in.test.cjs`
- `node tests/basic-flow-visual.cjs`
- `node tests/chip-details-browser.cjs`: interactive desktop/mobile React harness;
  database and PDF callbacks mocked, not a real-user production transaction.
- `node tests/chip-rules.cjs`: Rules API evaluation, synthetic resources and mocked
  profile get. Requires FIREBASE_TOOLS_LIB; does not write production documents.
- Build and scoped ESLint must pass before release.

New history index: flowEvents(vehicleFlowId ASC, createdAt DESC).
Deploy only firestore.limited.rules. Do not publish the unrelated default rules.

Before-release monitoring, 2026-09-25 13:01-13:11 UTC: 4 document reads reported,
no write samples available, maximum 6 connections and 12 snapshot listeners.
Monitoring is delayed; missing write samples do not prove zero writes.
