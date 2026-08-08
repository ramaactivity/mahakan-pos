export type Role = "owner" | "manager" | "supervisor" | "staff";

/**
 * Permission matrix — single source of truth.
 *
 * Mirror of `docs/05-ROLES-RBAC.md §4`. Server-side enforced via
 * `hasPermission()` and `requirePermission()`. Mutations to this object
 * MUST be reflected in the docs.
 *
 * Phase 8.1 Option B (sesi AC-4): "supervisor" role added between manager
 * and staff. Default scope = "Manager-lite shift lead": semua manager
 * permissions kecuali yang irreversible (delete/cancel/finalize),
 * financial commitment (mark_paid, cash_deposit.verify), atau admin master
 * (menu/inventory/supplier CRUD, settings, payroll, accounting). Owner
 * dapat tweak per-permission kalau scope tidak pas saat field test.
 */
export const permissions = {
  // Auth
  "auth.password_login": ["owner", "manager", "supervisor"],
  "auth.pin_login": ["owner", "manager", "supervisor", "staff"],

  // POS — Transactions
  "pos.transaction.create": ["owner", "manager", "supervisor", "staff"],
  "pos.transaction.view": ["owner", "manager", "supervisor", "staff"],
  "pos.transaction.void": ["owner", "manager", "supervisor"],
  "pos.transaction.refund": ["owner", "manager", "supervisor"],
  /** Apply a pre-configured promo at checkout. Staff allowed to PICK
   * promos (Owner standard sesi K — no manual %/nominal entry). Promos
   * with requires_approval=true also need separate Owner/Manager PIN. */
  "pos.promo.apply": ["owner", "manager", "supervisor", "staff"],
  /** Legacy manual discount apply — kept for back-compat audit. NOT used
   * in new POS flow (Owner standard: only pre-configured promos). */
  "pos.discount.apply": ["owner", "manager", "supervisor"],
  "pos.receipt.print": ["owner", "manager", "supervisor", "staff"],
  "pos.receipt.reprint": ["owner", "manager", "supervisor", "staff"],

  // POS — Menu
  // Sesi AE-170 — staff request: semua role bisa nyalakan/matikan menu
  // (sold-out + tersedia). Dulu staff cuma bisa matikan → operasional
  // ke-block nunggu manager/owner nyalain lagi.
  "pos.menu.mark_sold_out": ["owner", "manager", "supervisor", "staff"],
  "pos.menu.mark_available": ["owner", "manager", "supervisor", "staff"],

  // Shift
  "shift.open_own": ["owner", "manager", "supervisor", "staff"],
  "shift.close_own": ["owner", "manager", "supervisor", "staff"],
  /* Sesi AE-63 phase10 — owner/manager bisa close shift staff (supervise).
   * Schema 1-shift-per-outlet sekarang multi-user share — handover edge
   * cases (staff lupa close, urgensi tutup) butuh supervisor close. */
  "shift.close_any": ["owner", "manager"],
  "shift.view_own": ["owner", "manager", "supervisor", "staff"],
  "shift.view_all": ["owner", "manager", "supervisor"],
  "shift.force_close": ["owner"],
  /* Sesi AE-167 — koreksi kas awal shift (perlu izin owner/manager via PIN
   * approver kalau diminta staff; owner/manager bisa langsung). */
  "shift.opening_cash.correct": ["owner", "manager"],
  /* Sesi AE-62o — shift rebalancing dengan owner approval.
   * .request: kasir/manager submit correction request (email ke owner)
   * .approve: owner verify code → apply correction
   * .reject: owner/manager reject pending
   * .cancel: requester withdraw before approve
   * .view: list pending + history */
  /* Sesi AE-150 — Owner clarification on approval flow:
   * Code 6-digit emailed ke owner (out-of-band approval channel). Owner
   * baca email, decide, lalu share code ke MANAGER via WA/SMS. Manager
   * (or whoever ada di kedai dengan akses sistem) input code di system
   * untuk APPLY rebalancing. Owner tidak perlu login → "Input Kode"
   * tidak ditampilkan di owner page.
   *
   * Permission `approve` = "punya hak apply code yang dishare owner".
   * Manager + supervisor punya hak ini. Code = bearer token; security
   * via email channel + 6-digit hash + 5-attempt lockout. */
  "shift.rebalance.request": ["owner", "manager", "supervisor", "staff"],
  "shift.rebalance.approve": ["owner", "manager", "supervisor"],
  "shift.rebalance.reject": ["owner", "manager"],
  "shift.rebalance.cancel": ["owner", "manager", "supervisor", "staff"],
  "shift.rebalance.view": ["owner", "manager", "supervisor"],

  /* Sesi AE-62r — per-transaction correction dari Riwayat POS.
   * .request: kasir/manager submit koreksi (email ke owner)
   * .approve: owner verify kode → apply correction + reverse+repost journal
   * .reject: owner/manager reject pending
   * .cancel: requester withdraw before approve
   * .view: list pending + history */
  "pos.transaction.correction.request": [
    "owner",
    "manager",
    "supervisor",
    "staff",
  ],
  "pos.transaction.correction.approve": ["owner"],
  "pos.transaction.correction.reject": ["owner", "manager"],
  "pos.transaction.correction.cancel": [
    "owner",
    "manager",
    "supervisor",
    "staff",
  ],
  "pos.transaction.correction.view": ["owner", "manager", "supervisor"],

  // Menu CRUD — supervisor TIDAK bisa edit master menu (master data scope).
  "menu.item.create": ["owner", "manager"],
  "menu.item.update": ["owner", "manager"],
  "menu.item.delete": ["owner", "manager"],
  "menu.item.bulk_update": ["owner", "manager"],
  "menu.export_csv": ["owner"],
  "menu.category.crud": ["owner", "manager"],
  "menu.modifier.update": ["owner", "manager"],
  "menu.modifier.create": ["owner", "manager"],
  "menu.modifier.delete": ["owner"],

  // Cash & Expenses
  "expense.create": ["owner", "manager", "supervisor", "staff"],
  "expense.update_within_24h": ["owner", "manager", "supervisor"],
  "expense.update_anytime": ["owner"],
  "expense.delete": ["owner"],
  "expense.category.create": ["owner", "manager"],
  "expense.category.update": ["owner"],
  "expense.category.delete": ["owner"],
  "income.create": ["owner", "manager", "supervisor", "staff"],
  "income.update_within_24h": ["owner", "manager", "supervisor"],
  "income.update_anytime": ["owner"],
  "income.delete": ["owner"],
  "cash.daily_summary.view": ["owner", "manager", "supervisor", "staff"],
  /* Sesi AE-67 — Entry change suggest workflow. Semua role bisa propose
   * (staff yang sadar duluan kalau salah input), code 6-digit emailed
   * ke owner. Manager/supervisor input code di system untuk apply
   * (mirror shift.rebalance pattern sesi AE-150). */
  "entry_change.propose": ["owner", "manager", "supervisor", "staff"],
  "entry_change.approve": ["owner", "manager", "supervisor"],

  // Reports — supervisor lihat operational, NOT P&L / cost / financial export.
  "report.sales.view": ["owner", "manager", "supervisor"],
  "report.items.view": ["owner", "manager", "supervisor"],
  "report.shift.view_all": ["owner", "manager", "supervisor"],
  "report.pnl.view": ["owner"],
  "report.cost_visibility": ["owner"],
  "report.export.operational": ["owner", "manager", "supervisor"],
  "report.export.financial": ["owner"],

  // User Management — supervisor TIDAK bisa CRUD user; HANYA reset PIN
  // staff (helpful saat kasir lupa PIN mid-shift).
  "user.list.all": ["owner"],
  "user.list.staff": ["owner", "manager", "supervisor"],
  "user.create.staff": ["owner", "manager"],
  "user.create.manager": ["owner"],
  "user.create.owner": ["owner"],
  "user.update.staff": ["owner", "manager"],
  "user.update.manager": ["owner"],
  "user.update.owner": ["owner"],
  "user.deactivate.staff": ["owner", "manager"],
  "user.deactivate.manager": ["owner"],
  "user.reset_pin.staff": ["owner", "manager", "supervisor"],
  /** Reset PIN untuk manager+owner — owner-only. Bug fix sesi AC-5b
   * (ramaactivity/code-review): sebelumnya kedua branch di resetPin action
   * salah-map ke user.reset_pin.staff, akibatnya manager bisa reset PIN
   * owner = privilege escalation. canActOnRole hierarchy gate juga added
   * sebagai defense in depth. */
  "user.reset_pin.manager": ["owner"],
  "user.reset_password.manager": ["owner"],
  "audit.view.all": ["owner"],
  "audit.view.staff_actions": ["owner", "manager", "supervisor"],

  /* Sesi AE-131 — Operasional checklist module.
   * Owner+Manager mengelola template tugas dari back office.
   * Staff & Supervisor melakukan ceklist + late-mark + WA export. */
  "operasional.task.template.manage": ["owner", "manager"],
  "operasional.task.checklist.do": [
    "owner",
    "manager",
    "supervisor",
    "staff",
  ],
  "operasional.task.checklist.view": [
    "owner",
    "manager",
    "supervisor",
    "staff",
  ],

  /* Sesi AE-132 — Arsip Nota (dokumentasi).
   * Semua role bisa upload (terutama staff saat manager/owner tidak di
   * lapangan). Review/flag/delete khusus Owner+Manager. */
  "nota_archive.create": ["owner", "manager", "supervisor", "staff"],
  "nota_archive.view.all": ["owner", "manager", "supervisor"],
  "nota_archive.view.own": ["owner", "manager", "supervisor", "staff"],
  "nota_archive.review": ["owner", "manager"],
  "nota_archive.delete": ["owner", "manager"],

  // HR — Employee management (Sesi C-6). Supervisor view-only.
  "employee.view": ["owner", "manager", "supervisor"],
  "employee.create": ["owner", "manager"],
  "employee.update": ["owner", "manager"],
  "employee.delete": ["owner"],

  // HR — Attendance (Sesi C-7). `record` = clock in/out (the kiosk
  // operator). `view` = list/admin reports. Staff can record their own
  // attendance via the kiosk; the device's logged-in user is the actor.
  "attendance.view": ["owner", "manager", "supervisor"],
  "attendance.record": ["owner", "manager", "supervisor", "staff"],
  /* Sesi AE-63 phase8 — HR Bayu request: edit status/lateMinutes per
   * record untuk handle special cases (konfirmasi karyawan, izin, dll).
   * Owner + Manager (HR-level) only. */
  "attendance.manual_edit": ["owner", "manager"],
  /** Phase 4 (sesi AB) — set/reset attendance PIN per karyawan via
   * Admin → Karyawan. Owner+Manager. */
  "employee.attendance_pin.manage": ["owner", "manager"],
  /** Phase 4 — set GPS center coords for mobile absensi via Settings. */
  "outlet.attendance_gps.manage": ["owner", "manager"],

  // HR — Schedule + Payroll (Sesi C-8). Supervisor view schedule only;
  // payroll TIDAK terlihat (sensitive — gaji teman tim).
  "schedule.view": ["owner", "manager", "supervisor"],
  "schedule.update": ["owner", "manager"],
  "payroll.view": ["owner", "manager"],
  "payroll.manage": ["owner"],

  /* Sesi AE-63 — Investor & Pengelola module.
   * Owner kontrol penuh — manager bisa view + compute draft tapi cuma owner
   * yang bisa approve+post jurnal (mirror payroll.markPaid pattern). */
  "investor.view": ["owner", "manager"],
  "investor.manage": ["owner"],
  "investor.import": ["owner"],
  "pengelola.view": ["owner", "manager"],
  "pengelola.manage": ["owner"],
  "distribution.view": ["owner", "manager"],
  "distribution.compute": ["owner", "manager"],
  "distribution.approve": ["owner"],
  /* Sesi AE-80 — reverse distribusi yang sudah posted. Owner-only karena
   * impact ke saldo investor + journal. */
  "distribution.reverse": ["owner"],
  "investor_statement.resend": ["owner"],

  // Promos / Campaigns (Sesi K). View read-only at backoffice; manage =
  // create/update/archive. Apply lives under pos.promo.apply. Supervisor
  // view only — manage promo bisa abuse jadi diskon liar.
  "promo.view": ["owner", "manager", "supervisor"],
  "promo.manage": ["owner", "manager"],

  // Settings — Supervisor cuma device-level (printer pair/test).
  "settings.business.update": ["owner"],
  "settings.printer.pair": ["owner", "manager", "supervisor", "staff"],
  "settings.printer.test": ["owner", "manager", "supervisor", "staff"],
  "settings.hours.update": ["owner"],
  "settings.receipt.update": ["owner", "manager"],
  "settings.thresholds.update": ["owner"],
  "settings.features.update": ["owner"],
  "settings.approval.update": ["owner"],
  "settings.targets.update": ["owner"],

  /* Sesi AE-62 — Historical reconciliation (Majoo/Kasir Pintar CSV import).
   * Owner-only mutate (sensitive: bisa shift laporan akuntansi),
   * manager bisa view untuk verifikasi. */
  "historical.view": ["owner", "manager"],
  "historical.import": ["owner"],
  "historical.update": ["owner"],

  // Inventory — Supervisor view + receive + waste (operational), TIDAK
  // CRUD master ingredient/recipe (master data) atau adjust (sensitive).
  "inventory.ingredient.view": ["owner", "manager", "supervisor"],
  "inventory.ingredient.create": ["owner", "manager"],
  "inventory.ingredient.update": ["owner", "manager"],
  "inventory.ingredient.delete": ["owner"],
  "inventory.recipe.view": ["owner", "manager", "supervisor"],
  "inventory.recipe.create": ["owner", "manager"],
  "inventory.recipe.update": ["owner", "manager"],
  "inventory.recipe.delete": ["owner"],
  "inventory.receive": ["owner", "manager", "supervisor"],
  "inventory.adjust": ["owner"],
  "inventory.waste": ["owner", "manager", "supervisor"],
  "inventory.movement.view": ["owner", "manager", "supervisor"],
  "inventory.cost.view": ["owner"],

  // Phase 2 Tier 1.2 (M23) — Preparations.
  "inventory.preparation.view": ["owner", "manager", "supervisor"],
  "inventory.preparation.create": ["owner", "manager"],
  "inventory.preparation.update": ["owner", "manager"],
  "inventory.preparation.delete": ["owner"],

  // Stock Opname (Sesi N). Owner standard — opname wajib bulanan oleh
  // staff & karyawan. Staff CAN start/count/submit (so they can run
  // the count themselves); finalize + cancel manager+ only (commits
  // adjust movements; fraud-prevention boundary). Supervisor TIDAK
  // finalize (finalize = commit, sensitive boundary).
  "inventory.opname.view": ["owner", "manager", "supervisor", "staff"],
  "inventory.opname.start": ["owner", "manager", "supervisor", "staff"],
  "inventory.opname.count": ["owner", "manager", "supervisor", "staff"],
  /** Sesi AE-22 — staff add item baru on-the-fly saat opname (mis. bahan
   *  baru yang lupa di-master). Auto-create ingredient + line. Same scope
   *  dengan `count` karena kalau staff bisa count, dia juga harus bisa
   *  catat bahan yang lupa ditambah. Owner/manager review saat finalize. */
  "inventory.opname.add_item": ["owner", "manager", "supervisor", "staff"],
  "inventory.opname.finalize": ["owner", "manager"],
  "inventory.opname.cancel": ["owner", "manager"],

  // Suppliers master — Supervisor view-only (master data).
  "supplier.view": ["owner", "manager", "supervisor"],
  "supplier.create": ["owner", "manager"],
  "supplier.update": ["owner", "manager"],
  "supplier.delete": ["owner"],

  // Market List (Sesi AE-21) — supplier price catalog. Owner/manager
  // edit; supervisor view (untuk reference saat catat pembelian).
  // Update is_primary triggers ingredients.cost_per_unit cascade —
  // sensitive, owner+manager only (sama dgn ingredient.update).
  "market_list.view": ["owner", "manager", "supervisor"],
  "market_list.create": ["owner", "manager"],
  "market_list.update": ["owner", "manager"],
  "market_list.delete": ["owner"],

  // Sesi AE-32 — system reset: nuclear wipe semua data operasional
  // (transaksi/absensi/shift/dll) untuk transition mockup → real trial.
  // Owner-only — destructive, tidak bisa di-undo.
  "system.reset_mockup_data": ["owner"],

  // Purchases (Sesi O). Replaces Form Cash + Form TOP spreadsheets.
  // Staff bisa input pembelian harian (mereka tim purchasing); finalize
  // payment & cancel manager+ only. Supervisor view + create (operational
  // belanja), TIDAK update / cancel / mark_paid (financial commitment).
  "purchase.view": ["owner", "manager", "supervisor"],
  "purchase.create": ["owner", "manager", "supervisor", "staff"],
  "purchase.update": ["owner", "manager"],
  "purchase.cancel": ["owner", "manager"],
  "purchase.mark_paid": ["owner", "manager"],
  /* Sesi AE-173 — Goods Receive (terima barang dari PO). Owner/Manager di
   * Back Office + Staff dari aplikasi POS (mereka yang sering nerima kiriman). */
  "purchase.goods_receive": ["owner", "manager", "supervisor", "staff"],
  /* Sesi AE-188 — hapus GR (permintaan owner: bersihkan GR percobaan).
   * OWNER SAJA. Menghapus GR membalik stok, pengeluaran kas, receivedQty PR,
   * status PO, dan jurnalnya sekaligus — terlalu berat untuk didelegasikan,
   * dan sengaja tidak diberikan ke manager. */
  "purchase.goods_receipt_delete": ["owner"],

  // Purchase Requests (Phase 6.5+6.6, sesi AC-3) — list belanja dari kasir
  // saat tutup shift; admin receive di "Permintaan Belanja" section.
  // Supervisor receive (relevant to shift lead) tapi NOT cancel.
  "purchase_request.view": ["owner", "manager", "supervisor"],
  "purchase_request.create": ["owner", "manager", "supervisor", "staff"],
  "purchase_request.receive": ["owner", "manager", "supervisor"],
  "purchase_request.cancel": ["owner", "manager"],

  // Reports HPP + Purchase rollup (Sesi O). HPP = COGS by ingredient,
  // owner-only karena cost-sensitive. Purchase rollup OK for manager.
  "report.hpp.view": ["owner"],
  "report.purchase_rollup.view": ["owner", "manager", "supervisor"],

  // Bulk-assign section to ingredients (Sesi O). Manager+ untuk avoid
  // accidental staff misclassify.
  "inventory.section.bulk_assign": ["owner", "manager"],

  // Phase 2 Tier 1.3 (M29) — Customers / Loyalty.
  "customer.lookup": ["owner", "manager", "supervisor", "staff"],
  "customer.view": ["owner", "manager", "supervisor"],
  "customer.create": ["owner", "manager", "supervisor", "staff"],
  "customer.update": ["owner", "manager"],

  // Sesi B-2 — Owner-only approval code mechanism for void/refund.
  // *.request perms let any role INITIATE the request. Code-mode authz
  // tetap owner-only (Supervisor tidak otomatis qualify untuk be code
  // approver — owner can extend later kalau perlu).
  "pos.transaction.void.request": ["owner", "manager", "supervisor", "staff"],
  "pos.transaction.refund.request": ["owner", "manager", "supervisor", "staff"],
  /** Code-mode void authorization. Owner-only when flag is "code". */
  "pos.transaction.void.code": ["owner"],
  /** Code-mode refund authorization. Owner-only when flag is "code". */
  "pos.transaction.refund.code": ["owner"],
  /* Sesi AE-195 — compliment (transaksi 100% gratis) wajib kode approval
   * owner. Semua role kasir boleh MEMINTA; yang menyetujui tetap owner
   * karena hanya owner yang menerima kodenya (email + push). */
  "pos.compliment.request": ["owner", "manager", "supervisor", "staff"],
  /** View + revoke active approval codes (admin panel). */
  "approval_code.view": ["owner"],
  "approval_code.revoke": ["owner"],
  /** Sesi AE-160 — view Pusat Persetujuan (unified queue 5 flow approval).
   * Manager + supervisor butuh ini supaya bisa tracking progress + lihat
   * history; mereka tidak bisa direct-approve (owner-only) tapi bisa input
   * kode 6-digit untuk approve sesuai flow per-kind. */
  "approval_queue.view": ["owner", "manager", "supervisor"],

  // Finance / Keuangan (Sesi Q). Verify is owner-only by design.
  // Supervisor view + create deposit/aggregator (operational data entry),
  // TIDAK verify deposit atau cash flow report (sensitive).
  "finance.dashboard.view": ["owner", "manager", "supervisor"],
  "report.daily_settlement.view": ["owner", "manager", "supervisor"],
  "cash_deposit.view": ["owner", "manager", "supervisor"],
  "cash_deposit.create": ["owner", "manager", "supervisor"],
  "cash_deposit.verify": ["owner"],
  "report.cash_flow.view": ["owner"],
  "aggregator_settlement.view": ["owner", "manager", "supervisor"],
  "aggregator_settlement.create": ["owner", "manager", "supervisor"],
  /* Sesi AE-56 — set status/note untuk rekonsiliasi audit workflow.
   * Owner + manager bisa mark Open/Investigating/Resolved/Disputed. */
  "reconciliation.update": ["owner", "manager"],
  "settings.cash_threshold.update": ["owner"],

  // Bank accounts master (sesi AE-13). Owner manage, manager+supervisor
  // view-only (untuk pakai dropdown saat catat setoran).
  "bank_account.view": ["owner", "manager", "supervisor"],
  "bank_account.manage": ["owner"],

  // Settlement Log per channel per hari (Phase 6.1, sesi AC-5).
  // Owner input mutasi bank actual + variance log. Supervisor view-only
  // (compare expected vs actual saat shift), tidak input atau hapus
  // (financial entry — owner+manager only).
  "settlement_log.view": ["owner", "manager", "supervisor"],
  "settlement_log.create": ["owner", "manager"],
  "settlement_log.update": ["owner", "manager"],
  "settlement_log.delete": ["owner"],

  // Accounting / Buku Besar — Supervisor TIDAK terlibat akuntansi
  // (sensitif, post/close period commits financial state).
  "accounting.coa.view": ["owner", "manager"],
  "accounting.coa.manage": ["owner"],
  "accounting.journal.view": ["owner", "manager"],
  "accounting.journal.draft": ["owner", "manager"],
  "accounting.journal.post": ["owner"],
  "accounting.journal.reverse": ["owner"],
  "accounting.period.view": ["owner", "manager"],
  "accounting.period.close": ["owner"],
  "accounting.period.reopen": ["owner"],
  "accounting.period.lock": ["owner"],
  "accounting.report.view": ["owner", "manager"],
  "accounting.report.export": ["owner"],
  "accounting.opening_balance.input": ["owner"],

  /* Sesi AE-62w — journal retry queue (owner-only sensitive — re-trigger
   * GL post). Manager + supervisor view-only via audit log (read scope
   * sudah dikasih AE-62u). Future bisa kasih manager retry kalau perlu. */
  "journal_retry.view": ["owner", "manager"],
  "journal_retry.retry": ["owner"],
  "journal_retry.abandon": ["owner"],
} as const satisfies Record<string, ReadonlyArray<Role>>;

export type Permission = keyof typeof permissions;

export function hasPermission(role: Role, permission: Permission): boolean {
  return (permissions[permission] as ReadonlyArray<Role>).includes(role);
}

export function requirePermission(role: Role, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new Error(
      `Forbidden: role "${role}" cannot "${permission}"`,
    );
  }
}

/**
 * Role hierarchy for actions like "can create user with role X" — owner can
 * affect manager + supervisor + staff; manager can affect supervisor + staff;
 * supervisor cannot create/manage other users (just reset PIN, gated by
 * permission). Phase 8.1 Option B (sesi AC-4).
 */
export function canActOnRole(actor: Role, target: Role): boolean {
  if (actor === "owner") return true;
  if (actor === "manager") return target === "supervisor" || target === "staff";
  return false;
}

/**
 * Session duration per role (C2 = A).
 * Staff + Supervisor: 12h shift-long (frontline); Owner/Manager: 2h tighter
 * for back office. Returned in seconds — used by middleware to enforce
 * stale-session redirect.
 */
export function sessionMaxAgeSeconds(role: Role): number {
  return role === "staff" || role === "supervisor"
    ? 12 * 60 * 60
    : 2 * 60 * 60;
}
