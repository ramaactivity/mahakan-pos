# 🤝 HANDOVER SESI 14 — Mahakan POS

**Untuk:** Claude AI agent (sesi 15)
**Dari:** Sesi 14 (close 2026-04-29)
**Sesi 15 fokus:** **FIELD VALIDATE** — sesi 12-14 features (compliment, open bill, receipt editor, PIN guards, menu sort/layout, customer name, history split print, reprint audit) + Galih continued asks lainnya kalau Owner mau lanjut direction C.

---

## ⚡ TL;DR

Sesi 14 = M28 Galih quick-wins bundle (4 items, 1 commit `a170b56`):
1. **M28.1+M28.2** Customer name field di transaction (unified dengan bill_label open bill — single column)
2. **M28.3** HistoryDetailModal split print buttons (replace single Cetak Ulang dengan PrintStationButtons)
3. **M28.4** Audit reprint events (`transaction.reprint` event, emit only dari HistoryDetailModal)

Owner pilih direction C (continued Galih asks) over A (field-validate) at sesi 14 boot. Field-validate tetap pending — sesi 15 default = field test (sama recommendation seperti sesi 13 boot prompt).

Migration applied to Neon prod sebelum code deploy (D55: migrate-first untuk additive col + new TS schema reference). Single commit pushed + deployed via `npx vercel --prod --yes`.

---

## 1. Production State (akhir sesi 14)

| URL | Purpose |
|---|---|
| https://mahakan-pos.vercel.app | Production alias (stable) |
| Latest deploy | Vercel `mahakan-g8tysjnk6-ramaactivity98-5695s-projects.vercel.app` (2026-04-29) |

- `release/phase-1` HEAD `a170b56` — local + remote synced
- DB Neon: `transactions.customer_name TEXT NULL` column live (NULL untuk all existing transactions). 140 atomic + 20 preparations + 71 active recipes + 321 lines unchanged dari sesi 11.
- typecheck + lint clean; **328/328 tests** (was 323; +5 customer name unit tests across printer + ticket-builder)
- 11 routes build via webpack + Serwist

---

## 2. Galih Quick-Wins Bundle (narrative)

Sesi 14 boot: Owner picked direction C dari sesi 13 boot prompt (continued Galih asks). 9 candidate items dari "Items NOT YET BUILT" disampaikan sebagai 4 bundles:

- **Quick-wins (4 items)** — RECOMMENDED, dipilih Owner. Small, similar pattern, 1 sesi feasible.
- Open bill polish (3 items) — dipending
- POS UX speed (3 items) — dipending
- Big infra (2 items: receipt logo + multi-printer) — dipending, 2-sesi minimum

Quick-wins terpilih:
1. **#1 Customer name** — kasir input di NewOrderModal, displayed everywhere, printed di customer struk + prep tickets
2. **#4 Bill label open bill** — Owner asked "tolong agar Galih bisa tag open bill biar ngga bingung" → unified dengan #1 (D51)
3. **#7 HistoryDetailModal split print** — Galih request: post-paid reprint juga should split kitchen/bar/customer
4. **#9 Audit reprint events** — Galih request: track who reprints what, abuse detection

---

## 3. What Changed Sesi 14 (file-level summary)

Single commit `a170b56`: 21 files changed, 3290 insertions(+), 44 deletions(-). 3065 lines = drizzle snapshot JSON (auto-generated). Code delta ~225 LOC.

### Schema + DB

- **NEW** [drizzle/migrations/0004_demonic_wasp.sql](drizzle/migrations/0004_demonic_wasp.sql) — `ALTER TABLE transactions ADD COLUMN customer_name text;` (additive, applied 2026-04-29 via `npm run db:migrate` BEFORE deploy per D55)
- [src/db/schema/transactions.ts](src/db/schema/transactions.ts) — `customerName: text("customer_name")` di transactions table

### Transactions feature

- [src/features/transactions/types.ts](src/features/transactions/types.ts) — `customerName?: string | null` ditambah ke `CreateTransactionInput` + `SaveOpenBillInput` (optional supaya backwards-compat dengan offline queue payloads)
- [src/features/transactions/schemas.ts](src/features/transactions/schemas.ts) — zod `customerName: z.string().trim().max(60).nullish().transform(...)` — accepts undefined/null/empty + transforms to null
- [src/features/transactions/actions.ts](src/features/transactions/actions.ts):
  - `createTransaction` — pass `customerName: v.customerName ?? null` ke insert values
  - `saveAsOpenBill` — thread `customerName` ke placeholder `CreateTransactionInput`
  - **NEW action** `logTransactionReprint(trxId, sections)` — calls `logAudit` dengan eventType `transaction.reprint`. Validates session + transaction exists. No permission gate (D54). Returns `ApiResult<void>`
- [src/features/transactions/index.ts](src/features/transactions/index.ts) — barrel export `logTransactionReprint`

### Audit

- [src/lib/audit/types.ts](src/lib/audit/types.ts) — `"transaction.reprint"` ditambah ke `AUDIT_EVENT_TYPES`. Auto-appears di [AuditLogSection](src/features/admin/sections/AuditLogSection.tsx) "Transaksi" filter group via existing `startsWith("transaction.")` derivation (no UI code change needed)

### Printer + receipt

- [src/lib/printer/receipt-builder.ts](src/lib/printer/receipt-builder.ts):
  - `ReceiptData.customerName?: string | null` ditambah
  - `buildReceipt` render `Nama : <customerName>\n` after kasir line, only if non-empty. Truncate 25 chars dengan `..` ellipsis (existing `truncate` helper)
- [src/lib/printer/ticket-builder.ts](src/lib/printer/ticket-builder.ts):
  - `PrepTicketData.customerName?: string | null` ditambah
  - `buildPrepTicket` render customerName beneath pager block, size(1,2) emphasis (sama seperti pager line). Truncate hard 16 chars (no ellipsis — emphasis size already large)
- [src/lib/printer/print-transaction.ts](src/lib/printer/print-transaction.ts) — `buildCustomerBytes` + `buildPrepBytes` thread `customerName: trx.customerName`

### POS UI

- [src/features/pos/types.ts](src/features/pos/types.ts) — `Draft.customerName: string | null` ditambah
- [src/features/pos/cartStore.ts](src/features/pos/cartStore.ts):
  - `startDraft(pager, type, customerName?)` — accepts optional customerName, trims to null on empty
  - **NEW mutator** `setCustomerName(draftId, customerName)` — for future edit support (not yet wired)
- [src/features/pos/components/NewOrderModal.tsx](src/features/pos/components/NewOrderModal.tsx) — extra `<Input label="Nama Customer (opsional)" maxLength=60 hint="..."/>` after pager input. Auto-cleared on modal open
- [src/features/pos/components/OpenBillPanel.tsx](src/features/pos/components/OpenBillPanel.tsx) — BillCard time-line appends `· <customerName>` styling neutral-800 font-medium
- [src/features/pos/components/HistoryDetailModal.tsx](src/features/pos/components/HistoryDetailModal.tsx):
  - Replace single "Cetak Ulang" button dengan `<PrintStationButtons trx={trx} cashierName={...} receiptConfig={receiptConfig} layout="row" size="sm" onAfterPrint={handleReprintLogged}/>` di section "Cetak Ulang"
  - Drop legacy `handleReprint` + `reprinting` state + `printTransactionReceipt` import
  - **NEW prop** `receiptConfig: ReceiptConfig | null` — threaded from PosShell
  - `handleReprintLogged(_key, sections)` — fire-and-forget `logTransactionReprint(trxId, sections)` call
  - Modal description appends `· <customerName>` kalau ada
- [src/features/pos/components/PrintStationButtons.tsx](src/features/pos/components/PrintStationButtons.tsx) — **NEW optional prop** `onAfterPrint?: (key: SectionKey, sections: TicketSection[]) => void`. Called after successful print, before toast.success
- [src/features/pos/PosShell.tsx](src/features/pos/PosShell.tsx):
  - Thread `customerName: activeDraft.customerName` ke createTransaction + saveAsOpenBill payloads
  - Pass `receiptConfig={receiptConfig}` ke `<HistoryDetailModal>`
  - PaidPanel summary tambah "Nama" row kalau `trx.customerName`
  - CartPanel header: replaced `<span>Order Aktif</span>` dengan div containing h2 + customerName subline (text-xs font-medium)

### Tests

- [tests/unit/printer.test.ts](tests/unit/printer.test.ts) — 3 new test cases: render with customerName, omit when null/undefined/empty (3 sub-cases), truncate ≤25 chars dengan `..`
- [tests/unit/ticket-builder.test.ts](tests/unit/ticket-builder.test.ts) — 2 new test cases: render below pager when provided, omit when missing
- 323 → **328** total tests passing

---

## 4. Decisions Locked (D51-D55)

Lihat [docs/99-PHASE-2-ROADMAP.md §10](99-PHASE-2-ROADMAP.md). Recap singkat:

| ID | Decision | Why |
|---|---|---|
| **D51** | Single `customer_name` column subsumes #1 + #4. Bukan 2 column terpisah | Galih's intent overlap — flexible label apapun (nama, meja, layanan) |
| **D52** | Customer name printed on customer struk + prep tickets (size 1,2 emphasis) | Dapur bisa call out by name kalau pager hilang |
| **D53** | Audit `transaction.reprint` emit ONLY dari HistoryDetailModal split print | Signal-to-noise — abuse detection scenario adalah historical reprints |
| **D54** | No PIN gate on reprint | Read-only ops; PIN adds friction tanpa security value |
| **D55** | Migrate FIRST, deploy SECOND (untuk additive col + new TS schema) | Pure additive nullable; old code pre-deploy ignores new col, new code requires col exists |

---

## 5. Critical Files for Future Edits

**Customer name flow (M28.1-M28.2):**
- [src/db/schema/transactions.ts](src/db/schema/transactions.ts) — `customer_name` column
- [src/features/transactions/types.ts](src/features/transactions/types.ts) — input shapes
- [src/features/transactions/schemas.ts](src/features/transactions/schemas.ts) — zod validation
- [src/features/pos/types.ts](src/features/pos/types.ts) — `Draft.customerName`
- [src/features/pos/cartStore.ts](src/features/pos/cartStore.ts) — `startDraft` + `setCustomerName`
- [src/features/pos/components/NewOrderModal.tsx](src/features/pos/components/NewOrderModal.tsx) — input field
- [src/lib/printer/receipt-builder.ts](src/lib/printer/receipt-builder.ts) — render line
- [src/lib/printer/ticket-builder.ts](src/lib/printer/ticket-builder.ts) — prep ticket render

**Reprint audit (M28.3+M28.4):**
- [src/features/pos/components/HistoryDetailModal.tsx](src/features/pos/components/HistoryDetailModal.tsx) — split print + audit emit
- [src/features/pos/components/PrintStationButtons.tsx](src/features/pos/components/PrintStationButtons.tsx) — `onAfterPrint` callback
- [src/features/transactions/actions.ts](src/features/transactions/actions.ts) — `logTransactionReprint` action
- [src/lib/audit/types.ts](src/lib/audit/types.ts) — `transaction.reprint` event

---

## 6. Pending Field-Validate (sesi 15 priority)

### 6.1 M28.1+M28.2 Customer Name End-to-End 🔴 HIGH
1. Login Owner di POS → tap "Order Baru"
2. Verify modal sekarang ada 2 input fields: Pager + "Nama Customer (opsional)"
3. Input pager `1` + name `"Tester1"`
4. Add item Espresso → tap Bayar → masukin tunai → konfirmasi
5. Verify struk customer auto-print include `Nama : Tester1` line setelah Kasir
6. Verify PaidPanel summary di kanan ada baris `Nama Tester1`
7. Tap "Selesai" → buka tab Riwayat → tap transaksi
8. Verify modal description: `Pager 1 · Takeaway · Tester1 · ...`
9. Tap "Cetak Bar" (kalau drink) → struk bar harus include nama "Tester1" beneath pager block (size 1,2)
10. Bonus: Order Baru lagi dengan name `"Meja 7"` → tap "Simpan sebagai Open Bill"
11. Verify tab "Bill Aktif" — bill card show `· Meja 7` di time-line
12. Tap "Bayar Sekarang" → close → struk auto-print include `Nama : Meja 7`

### 6.2 M28.3 HistoryDetailModal Split Print
1. Buka tab Riwayat → tap transaksi paid sebelumnya
2. Verify section "Cetak Ulang" sekarang ada 4 button row: Customer / Dapur / Bar / Semua
3. Verify Dapur disabled kalau transaksi gak ada item food
4. Verify Bar disabled kalau gak ada drink
5. Tap each button → verify printer cetak section yang sesuai
6. Layout = "row" (4 button in a row, bukan 2x2)

### 6.3 M28.4 Audit Reprint Events
1. Setelah test 6.2 (tap Customer / Dapur / Bar / Semua dari HistoryDetailModal)
2. Login Owner di Admin → tap sidebar "Audit Log"
3. Filter Event = `transaction.reprint`
4. Verify entries baru per tap dengan format summary `Cetak ulang TRX <number> (<sections>)`
5. Verify NO entries dari PaidPanel reprint (post-payment in-flow) atau OrderQueuePanel prep ticket prints

### 6.4 Carry-over dari sesi 13 (belum field-tested)
Lihat [docs/99-HANDOVER-SESSION-13.md §6](99-HANDOVER-SESSION-13.md) — 9 sub-cases:
- M27.5 Receipt editor, M27.6 PIN void/refund, M27.7 Compliment, M27.8 Open Bill, M24 hardware re-test, M27.4 Order Queue, M27.1 Owner CRUD, M27.2+M27.3 Fullscreen+Workspace, M27.5+M27.6 Layout+Sort

---

## 7. Items NOT YET BUILT (sesi 15+ candidates)

Galih asks yang masih belum di-build (5 items):
- Sort/filter di Reports views
- Quick-favorites bar di POS (pin frequent items)
- Receipt logo print (currently text-only header)
- Edit open bill items (currently locked once saved)
- Multi-printer routing (separate physical printers untuk dapur vs bar)

Plus carry-forward Owner action items (independent dari kerja sesi):
1. **🔴 HIGH** Bakmie "Ayam Sambal Matah" rename via Admin → Menu UI (currently mis-attached recipe; engine bug A2 sudah error-clear kalau re-import tanpa rename, sesi 11 commit `32eb883`)
2. **🟡** First stock-take 140 ingredient (initial_stock=0)
3. **🟡** Reorder threshold per ingredient

---

## 8. Memory Updates

Akan add saat eksekusi handover:
- `session14-closeout` — supersede `session13-closeout`. Resume point post-sesi-14 dengan M28 quick-wins live + field-validate pending.

Memories yang tetap force:
- `migration-ordering-rule` (D55 = exception untuk additive case + new TS reference)
- `vercel-deploy-mode`
- `pause-before-destructive`
- `pat-handling-preference`

---

## 9. Sesi 15 Boot Prompt

**Copy-paste ke Claude di sesi baru:**

```
Halo, gua mau lanjut Mahakan POS sesi 15. Sesi 14 selesai dengan 1 commit
M28 Galih quick-wins bundle pushed + deployed (HEAD `a170b56`). 4 features:
customer name field, bill label (unified), history split-print, audit reprint.
Migration applied to Neon prod sebelum code deploy.

Baca dulu (urutan ini penting):
  1. docs/99-HANDOVER-SESSION-14.md — full handover sesi 14
  2. docs/99-HANDOVER-SESSION-13.md — sesi 12-13 features yang juga belum field-tested
  3. PROGRESS.md — overall milestone state (sekarang sampai M28.4)
  4. docs/99-PHASE-2-ROADMAP.md — §10 decisions D44-D55
  5. MEMORY.md (auto-loaded) — terutama session14-closeout,
     pause-before-destructive, vercel-deploy-mode, migration-ordering-rule

Verify state pertama:
  git log --oneline -5                 # expect HEAD = a170b56
  git status                           # expect clean (.claude/ + note OK)
  npm run typecheck && npm run lint    # expect clean
  npx vitest run                       # expect 328/328
  npm run build                        # expect 11 routes
  curl -sI https://mahakan-pos.vercel.app/   # expect HTTP/2 200

Sesi 15 fokus = FIELD VALIDATE sesi 12-14 features (RECOMMENDED).
Detail test scenarios:
  - sesi 14 features: docs/99-HANDOVER-SESSION-14.md §6 (4 sub-cases)
  - sesi 12-13 features: docs/99-HANDOVER-SESSION-13.md §6 (9 sub-cases)

DIRECTION OPTIONS UNTUK SESI 15 (Owner pilih):

A. Field-validate sesi 12-14 features [RECOMMENDED]
   - Galih + staff test 13 scenarios total
   - Capture bug → patch forward
   - Estimasi: 2-3 sesi tergantung bug count

B. Continue Tier 1.3 Loyalty + Customer DB [original roadmap]
   - 2 minggu, customer phone PK + points + redemption flow
   - Defer setelah field-validate done

C. Galih continued asks (5 items remaining)
   - Sort/filter Reports, Quick-favorites bar, Receipt logo,
     Edit open bill items, Multi-printer routing
   - Some need 2-sesi (logo + multi-printer)

D. Tech debt sweep
   - Receipt config full migration off DEFAULT_RECEIPT_CONFIG fallback
   - middleware → proxy rename (Next 16 deprecation)
   - Integration tests vs live DB (M18 deferred)

Recommended order: A → C → B → D.

Pause-points yang perlu konfirmasi Owner (per pause-before-destructive memory):
- Sebelum push code commit baru
- Sebelum vercel --prod deploy
- Sebelum schema migration apply
- Sebelum git revert atau rollback

Token efficiency mode tetap aktif:
- Pakai Edit tool (diff-only) untuk existing file
- Trust harness — skip post-edit re-read
- Batch parallel tool calls

Carry-forward Owner action items (independent):
- Bakmie "Ayam Sambal Matah" rename via Admin Menu UI (HIGH)
- First stock-take 140 ingredient
- Reorder threshold setup
```

---

## 10. Change Log

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-04-29 | Sesi 14 close. M28 quick-wins bundle delivered: customer name field (M28.1+M28.2 unified), HistoryDetailModal split print (M28.3), audit reprint events (M28.4). 1 commit `a170b56`. Migration `0004_demonic_wasp` applied + deployed. 328/328 tests. Sesi 15 = field validate (RECOMMENDED Option A). |

---

# 🛑 END HANDOVER SESI 14

**Sesi 14 delivered focused 4-item Galih bundle in 1 sesi as planned. Migration-first deploy-second order honored. All 4 features awaiting field-validate. Boot prompt §9 ready dipakai di sesi baru.**
