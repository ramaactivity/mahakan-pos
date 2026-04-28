# 🤝 HANDOVER SESI 12 — Mahakan POS

**Untuk:** Claude AI agent (sesi 12)
**Dari:** Sesi 11 (close 2026-04-28)
**Sesi 12 fokus:** **Kitchen + Bar Print Routing (M24)** — deploy + hardware-verify di RPP02 thermal printer + iterate berdasarkan real-printer behavior. Plus optional enhancement list kalau hardware test mulus.

---

## ⚡ TL;DR

M24 (kitchen + bar print routing) **sudah CODE-COMPLETE sesi 11** (commit `eabe648`):
- `src/lib/printer/station-mapping.ts` — hardcoded category → station map (kitchen/bar)
- `src/lib/printer/ticket-builder.ts` — pure `buildPrepTicket(d, station)` no-prices
- `src/lib/printer/print-transaction.ts` — concat 3 ticket bytes (kitchen + bar + customer) dalam 1 Bluetooth send call
- 17 unit tests, 308/308 → 323/323 (post-M25-S) all green

**TAPI BELUM:**
- ❌ Pushed to remote
- ❌ Deployed ke Vercel production
- ❌ Hardware-verified di RPP02 (real-world cut behavior, paper width, encoding)

**Sesi 12 inti:**
1. Push 10 commits + deploy ke prod
2. Hardware test M24 di Mahakan RPP02 dengan transaksi real
3. Capture issues yang muncul cuma di physical printer
4. Iterate fix
5. (Optional) Pilih enhancement E1-E5 dari list di §5

**Production state akhir sesi 11:**
- Vercel deploy `dpl_68UGimfxb3rxzANA3LpA1ZTS7c4j` masih di HEAD `88b5f67` (pre-sesi-11)
- DB Neon: inventory data populated (140 ingredients + 20 preps + 71 recipes + 321 lines via M23.5 import)
- Backup pre-M23.5: GHA run [25034423361](https://github.com/ramaactivity/mahakan-pos/actions/runs/25034423361)

**10 commits sesi 11 di local `release/phase-1` (HEAD `de93520`):**
```
de93520 docs: PROGRESS + handover for M25-S POS quick wins
f5b2c9f feat(pos): cashier rush-hour speed wins (S1+S2+S3+S4)
c2ac765 docs: PROGRESS + handover for M24 kitchen+bar print routing
eabe648 feat(printer): kitchen + bar prep ticket routing (M24)   ← target sesi 12
9c6d6d1 docs: PROGRESS + handover for M23.7 (engine bug fixes + CSV export)
d92b94e feat(admin): CSV export untuk Menu Engineering Matrix
32eb883 fix(inventory): cascadeCostUpdate self-include + menuIdByLower duplicate detect
a573b15 docs: PROGRESS + handover addendum for M23.6 menu engineering matrix
b0f5d84 feat(M23.6): menu engineering matrix view (Kasavana-Smith 2x2)
e640f11 feat(M23.5): first --apply ke prod + cost engine verified live
```

---

## 1. Verify state (Step 0 — sebelum mulai sesi 12)

```bash
cd /Users/macbookpro/Desktop/POS-ERP-MAHAKAN
git log --oneline -10                # expect HEAD = de93520, 10 sesi-11 commits
git status                           # expect clean working tree (.claude/ + note untracked OK)
npm run typecheck && npm run lint    # expect clean
npx vitest run                       # expect 323/323 (auth-password parallel may flake; isolate re-run = 4/4)
npm run build                        # expect 11 routes
curl -sI https://mahakan-pos.vercel.app/   # expect HTTP/2 200 (still serving HEAD 88b5f67)
```

Konfirmasi all 5 ✓ sebelum lanjut.

---

## 2. Sesi 12 Step-by-Step

### Step A — Deploy 10 commits ke production (~5 menit)

Per `vercel-deploy-mode` memory: push gak auto-deploy, harus manual.

```bash
git push origin release/phase-1
# Verify push success
git log origin/release/phase-1 --oneline -3   # expect HEAD = de93520

npx --yes vercel --prod --yes
# Wait for "readyState: READY"
curl -sI https://mahakan-pos.vercel.app/      # expect HTTP/2 200
```

Verify M24 + M25-S code now live:
```bash
# Quick sanity — load login page, check no JS errors di browser console
```

### Step B — Hardware verify M24 di RPP02 (~15 menit)

**Pre-req:** RPP02 paired ke tablet via Settings → Thermal Printer (sudah dilakuin saat M16). Pastikan paired di device yang lo akan test.

**Test cases (Owner action):**

| # | Order | Expected output |
|---|---|---|
| 1 | 1× Iced Americano + 1× French Fries (mixed) | **3 cut sequence**: TIKET DAPUR (French Fries) → TIKET BAR (Iced Americano) → struk customer (semua + total + change) |
| 2 | 2× Iced Latte (pure drink) | **2 cut**: TIKET BAR (2× Iced Latte) → struk customer |
| 3 | 1× Ayam Sambal Matah (pure food) | **2 cut**: TIKET DAPUR (1× Ayam Sambal Matah) → struk customer |
| 4 | 1× Croffle Ice Cream | **2 cut**: TIKET DAPUR (Croffle = Sweets cat) → struk customer |
| 5 | Void transaction | **0 prep ticket**, hanya struk customer (status: VOIDED). Verify lewat reprint button di PaidPanel atau History detail. |

**Verify per ticket:**
- TIKET DAPUR / TIKET BAR ada label besar bold di atas
- Pager # + order type (Dine-in / Takeaway) tampil emphasized
- Item lines: `2x Iced Latte (Iced)` + modifier sub-line + note kalau ada
- **NO prices** di prep ticket (no Rp, no Subtotal, no TOTAL)
- Footer "Total N item" centered
- Cut keluar bersih antar ticket (gak nyangkut)
- Karakter Indonesian ("Bayar", "Tunai", "Kembali") render correct (kalau ada bug encoding bakal terlihat)

**Catat di chat sesi 12 kalau ada bug:**
- Paper width issue (item name terpotong)
- Character encoding (mojibake / kotak-kotak)
- Cut tidak rapi / paper jam
- Order salah (ex: customer keluar duluan instead of last)
- Modifier line layout aneh

### Step C — Iterate fix berdasarkan hardware feedback (variable, ~30 menit - 2 jam)

Common issues yang mungkin muncul:
1. **Paper width 32 cols vs 48 cols** — kalau RPP02 sebenarnya support lebih lebar, item name bisa pakai full width. Cek `COLS = 32` di [src/lib/printer/ticket-builder.ts](src/lib/printer/ticket-builder.ts) + [src/lib/printer/receipt-builder.ts](src/lib/printer/receipt-builder.ts).
2. **Cut command tidak fully cut** — esc-pos `cut(false)` = partial cut. Try `cut(true)` (full cut) di ticket-builder kalau partial lebih sering nyangkut.
3. **Karakter Indonesian salah** — kemungkinan codepage. ESC/POS default codepage 0 = PC437 (US ASCII). Indonesian biasanya pakai PC850 atau UTF-8 mode kalau printer support. Edit [src/lib/printer/esc-pos.ts](src/lib/printer/esc-pos.ts) → `init()` to add `ESC t n` codepage select.
4. **Cut antar ticket terlalu rapat** — increase `feed(3)` ke `feed(5)` atau lebih di end-of-ticket.
5. **Time format off** — `formatIndonesianDateTime` di [src/lib/date.ts](src/lib/date.ts).

### Step D — Update handover sesi 13 + commit (~10 menit)

Tergantung apa yang berubah di Step C:
- Kalau no fix needed → cuma close sesi 12 dengan "M24 verified live di RPP02" note
- Kalau ada fix → bundle commit + push + deploy ulang
- Update memory `session11-closeout` → SUPERSEDED, write `session12-closeout`

### Step E (OPTIONAL) — Pick enhancement E1-E5

Kalau Step B-C selesai cepat dan masih ada budget, Owner bisa pilih:
- **E1**: Schema-backed station tag (per category, editable via Admin UI). ~1 hari. Owner edit category → "Station: Kitchen / Bar / None". Useful kalau Owner add new category.
- **E2**: Reprint kitchen/bar ticket from PaidPanel + History detail. Saat ini cuma customer receipt yang reprintable. ~2 jam.
- **E3**: Per-station header customization (DAPUR vs MINUMAN). ~30 menit polish.
- **E4**: Tweak cut/feed/codepage per hardware feedback. ~1 jam.
- **E5**: Track reprint events di audit log. ~1 jam.

---

## 3. Owner Action Checklist (carry-forward dari sesi 11)

Independent dari sesi 12 work tapi Owner perlu lakuin kapan aja:

1. **🔴 Bakmie Ayam Sambal Matah rename** (HIGH priority — currently mis-attached recipe). Login Admin → Menu → cari Bakmie "Ayam Sambal Matah" → rename ke "Bakmie Sambal Matah" (atau nama unik) → re-import file 04+05 jika ingin attach proper Bakmie recipe. Engine bug A2 (sesi 11 commit `32eb883`) sudah ERROR dengan jelas kalau Owner re-import tanpa rename.
2. **🟡 First stock-take** untuk 140 ingredient (initial_stock=0 saat ini). Via Admin → Inventory → Bahan → klik per ingredient → Receive Stock. Atau bulk strategy lo decide.
3. **🟡 Reorder threshold** per ingredient via Admin UI.

---

## 4. Critical Files

**M24 implementation (sesi 12 may iterate):**
- [src/lib/printer/station-mapping.ts](src/lib/printer/station-mapping.ts) — hardcoded category → station; edit kalau Owner add new category
- [src/lib/printer/ticket-builder.ts](src/lib/printer/ticket-builder.ts) — `buildPrepTicket` pure builder; edit kalau layout butuh tweak
- [src/lib/printer/print-transaction.ts](src/lib/printer/print-transaction.ts) — orchestration of 3 ticket types
- [src/lib/printer/esc-pos.ts](src/lib/printer/esc-pos.ts) — low-level ESC/POS commands; edit kalau codepage / cut behavior butuh tweak
- [src/lib/printer/bluetooth.ts](src/lib/printer/bluetooth.ts) — Web Bluetooth transport
- [tests/unit/ticket-builder.test.ts](tests/unit/ticket-builder.test.ts) — 17 tests (extend kalau ada edge case baru)

**Reprint flow (call site for E2 enhancement):**
- [src/features/pos/PosShell.tsx](src/features/pos/PosShell.tsx) line ~1313+ `printReceiptForTransaction` (currently only customer receipt)
- [src/features/pos/components/HistoryDetailModal.tsx](src/features/pos/components/HistoryDetailModal.tsx) — has reprint button

**Schema (call site for E1 enhancement):**
- [src/db/schema/menu.ts](src/db/schema/menu.ts) — `categories` table (no stationTag field yet)
- [src/db/seed-data.ts:120-130](src/db/seed-data.ts#L120-L130) — 11 seed categories

---

## 5. Risk + Known Unknowns

### High-confidence (likely to work first try)
- ESC/POS basic commands (`init`, `cut`, `feed`, `align`, `bold`, `size`) — used in M16 customer receipt sejak sesi 5, proven works on RPP02
- Bluetooth transport — proven works
- Concat multiple Uint8Array via `concat(...stream)` — pure function, tested

### Medium-confidence (mungkin butuh tweak)
- Multiple cuts in single Bluetooth send call. RPP02 mungkin buffer entire payload sebelum print, OR mungkin print as it receives. Sequencing visual mungkin tampak "1 long print with 3 cuts" instead of "3 separate prints with pauses".
- Cut command (`GS V 1` for partial cut, `GS V 0` for full cut) — RPP02 documentation said partial supported, full mungkin tidak.
- Indonesian characters (é, ñ tidak ada, tapi karakter standard a-z + numeric harusnya fine). Kalau ada nama menu pakai diakritik atau symbol, mungkin perlu codepage tweak.

### Low-confidence (need hardware test)
- Cut behavior antar ticket — kemungkinan paper jam atau ticket nyangkut kalau feed terlalu pendek
- Pager # rendering at `size(1, 2)` (2x tall) — visibility in dapur/bar fluorescent lighting
- Total time untuk 3-cut print dari tap "Konfirmasi Bayar" sampai semua keluar — bisa jadi 5-10 detik. Acceptable kalau kasir gak ada antrian.

---

## 6. Boot Prompt untuk Sesi 12 Baru

**Copy-paste ke Claude di sesi baru:**

```
Halo, gua mau lanjut Mahakan POS sesi 12. Sesi 11 selesai dengan 10 commits
di local `release/phase-1` (HEAD `de93520`). M23.5 + M23.6 + M23.7 + M24
+ M25-S semua code-complete tapi BELUM pushed/deployed.

Sesi 12 fokus: deploy 10 commits + hardware-verify M24 (kitchen + bar
print routing) di RPP02 thermal printer + iterate berdasarkan real-printer
behavior.

Baca dulu (urutan ini penting):
  1. docs/99-HANDOVER-SESSION-12.md — full handover sesi 12 + step-by-step
  2. docs/99-HANDOVER-SESSION-11.md — sesi 11 closeout dengan addendum 1-4
  3. PROGRESS.md — overall milestone state
  4. MEMORY.md (auto-loaded) — terutama session11-closeout,
     migration-ordering-rule, vercel-deploy-mode, pause-before-destructive,
     pat-handling-preference

Verify state pertama:
  git log --oneline -10                # expect HEAD = de93520
  git status                           # expect clean (.claude/ + note untracked OK)
  npm run typecheck && npm run lint    # expect clean
  npx vitest run                       # expect 323/323 (auth-password parallel
                                       # may flake → re-run isolated 4/4)
  npm run build                        # expect 11 routes
  curl -sI https://mahakan-pos.vercel.app/   # expect HTTP/2 200 (still HEAD 88b5f67)

Sesi 12 work plan (per HANDOVER-SESSION-12 §2):

Step A — Deploy ~5 menit:
  git push origin release/phase-1
  npx --yes vercel --prod --yes
  curl -sI https://mahakan-pos.vercel.app/   # verify deploy

Step B — Hardware verify M24 ~15 menit (gua butuh Owner Rama lakuin tap
di POS tablet karena Bluetooth ada di local device):
  - Test 5 case di §2 Step B (mixed / pure-drink / pure-food / sweets / void)
  - Capture bugs di chat: paper width, cut behavior, encoding, ordering

Step C — Iterate fix berdasarkan feedback hardware ~30 min - 2 jam:
  - Common areas: COLS (32 vs 48), cut command (partial vs full), codepage
    select untuk Indonesian, feed lines antar ticket
  - Edit src/lib/printer/{esc-pos.ts, ticket-builder.ts, print-transaction.ts}
  - Re-deploy kalau perlu

Step D — Close sesi 12: handover sesi 13, update PROGRESS, memory update
  (session12-closeout supersede session11-closeout)

Optional Step E — pilih enhancement (E1-E5 di handover §5):
  - E1 schema-backed station tag (~1 hari)
  - E2 reprint prep tickets (~2 jam)
  - E3 header label customization (~30 min)
  - E4 hardware-tuned cut/feed/codepage (~1 jam)
  - E5 reprint audit logging (~1 jam)

Pause-points yang perlu konfirmasi Owner:
- Sebelum push (Step A): "Ready push 10 commits + deploy ke prod?"
- Sesudah Step B kalau ada bug critical: "Rollback / patch forward?"
- Sebelum Step E: "Mana enhancement yang lo mau pilih?"

Token efficiency mode masih aktif (per Owner request sesi 11):
- Pakai Edit tool (diff-only) untuk existing file
- Trust harness — skip post-edit re-read
- Batch parallel tool calls
- Plan agent / Explore agent only kalau scope luas

Carry-forward Owner action items (independent dari sesi 12):
- Bakmie "Ayam Sambal Matah" rename (HIGH — currently mis-attached recipe)
- First stock-take 140 ingredient
- Reorder threshold setup
```

---

## 7. Change Log

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-04-28 | Sesi 11 → 12 handover. M24 code-complete + 10 commits NOT pushed. Sesi 12 = deploy + hardware verify + iterate. |

---

# 🛑 END HANDOVER SESI 12

**M24 ready untuk hardware verify. Push, deploy, test 5 cases di RPP02, iterate. Boot prompt §6 ready dipakai di sesi baru.**
