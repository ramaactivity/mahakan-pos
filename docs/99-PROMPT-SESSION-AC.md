# Prompt Kickoff — Sesi AC

Copy-paste prompt berikut ke conversation baru:

---

Halo, saya melanjutkan project POS-ERP-MAHAKAN di sesi AC.

**Konteks singkat:**
- Sesi AB (24) closed dengan 29 staged deploys (AB-1 → AB-29). HEAD `1b097b9` live di https://mahakan-pos.vercel.app, 580/580 tests pass, migrations 0001 → 0027 applied.
- Phase 1 + 2 + 3 + 4 + 6.2/6.3/6.4 + 7 + 9.1/9.2 sudah ship & deployed.
- **Phase 4 absensi mobile (trio AB-27/28/29)** sedang **field-test in progress** oleh Owner + Staff: PIN setup → /absenkaryawan → GPS + camera selfie → Drive upload + attendance_record. Bug reports / UX feedback dari field test akan masuk ke sesi AD.

**Baca dulu (urutan ini):**
1. `docs/99-HANDOVER-SESSION-AC.md` — full handover sesi AC dengan status sesi AB, pending phases, OQ, constraints
2. Memory `project_sesiAB_close.md` (auto-loaded via MEMORY.md) — checkpoint 29 deploys
3. `docs/99-HANDOVER-SESSION-AB.md` jika perlu konteks Phase 1-10 plan original

**Scope sesi AC** (sambil tunggu field-test feedback):

| # | Phase | Risk | Status |
|---|---|---|---|
| 5.2 | Payroll detail per komponen + new COA accounts | medium | Ready, additive |
| 5.3 | Merge Absensi + Laporan HR jadi HR Operations dashboard | low | Ready, UI refactor |
| 6.1 | Settlement harian CRUD per channel | medium-high | Need OQ#1 (schema) |
| 6.5 | Request belanja form di tutup shift | low | Need OQ#2 (WhatsApp) |
| 6.6 | Goods Receive feature (pair dengan 6.5) | low-medium | Depends 6.5 |
| 8.1 | Role CRUD + permissions matrix | A=high B=low | Need OQ#3 (scope) |
| 10.1 | Riset ESB POS gap analysis | zero | Need OQ#4 (akses) |

**Saran urutan ship:**
1. **Phase 5.3 dulu** (low risk, momentum) — merge HR tabs jadi 1 dashboard
2. **Phase 5.2** — extend mapPayrollPaid breakdown per komponen + new COA seed
3. **Phase 6.5 + 6.6 pair** — purchase_requests table + receive flow
4. **Phase 6.1, 8.1, 10.1** — pause sampai OQ jawab

**Open Questions yang perlu Owner jawab dulu** (lihat handover §Open Questions):
1. Phase 6.1 settlement schema — extend `cash_deposits` atau tabel baru `settlement_logs`? Variance threshold default 1%?
2. Phase 6.5 WhatsApp — Business API ($) atau wa.me link manual (free)?
3. Phase 8.1 role scope — full custom (3 hari) atau 1-2 role tambahan fixed (1 hari)?
4. Phase 10.1 ESB akses — owner punya demo / login / screenshot?
5. Migration order untuk new COA / new tables — confirm code-first deploy strategy?
6. Field-test bug intake mid-sesi — interrupt untuk hotfix atau queue ke akhir?

**Pre-flight wajib per deploy** (sama seperti sesi AB):
```
npx tsc --noEmit && \
npx eslint <changed files> && \
npx vitest run && \
NODE_OPTIONS="--max-old-space-size=8192" npx next build --webpack
```
Lalu commit + push + `npx vercel --prod --yes` (release/phase-1 push tidak auto-deploy production).

**Constraints permanent** (jangan langgar):
- NO native pickers — selalu custom Radix popover
- Client components import direct dari `actions.ts` + `types.ts`, JANGAN via barrel
- `hasPermission` import dari `@/lib/auth/rbac` direct, JANGAN via `@/lib/auth`
- JSX children eval eagerly — Modal early-return TIDAK guard parent's children expressions
- Migration additive only, no DROP/ALTER
- Non-additive changes: code FIRST, migration SECOND
- Pause sebelum destructive (force-push, reset --hard, drop col)

**Mulai dari mana:** rekomendasi saya start dengan **Phase 5.3** (HR Operations dashboard merge) — low risk, contained UI refactor, bisa langsung ship tanpa nunggu OQ. Setelah itu plan matang Phase 5.2 + 6.5/6.6.

Tapi terserah owner mau pilih mana dulu — bisa juga jawab OQ dulu lalu kita ship Phase 6.1 atau 8.1.

Lanjutkan.

---

**Notes (untuk diri sendiri di sesi baru):**
- Reminder agent `trig_01QG2yjEfcxjVs1z4x4LqZYE` fires 2026-05-09 09:00 — JANGAN buat baru
- Memory file `project_sesiAB_close.md` adalah checkpoint utama, baca itu dulu
- 29 deploys sudah ship — sesi AC adalah **continuation**, bukan rebuild
- Field-test feedback dari sesi AB **mungkin masuk mid-sesi AC** sebagai bug report — siapkan interrupt strategy
