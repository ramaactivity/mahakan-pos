import "server-only";
import { Readable } from "node:stream";
import { drive, type drive_v3 } from "@googleapis/drive";
import { OAuth2Client } from "google-auth-library";

/**
 * Google Drive uploader — module-aware (sesi AA #2).
 *
 * Drops files into auto-organized subfolder structure under a single
 * MAHAKAN COFFEE root folder, keeping Owner's existing nota archive
 * convention + extending to HR + expense modules. All modules share the
 * same OAuth client + folder-ID cache, so first upload after cold start
 * pays one traversal and subsequent uploads of the same module/period
 * are single-file-create round-trips.
 *
 *   {GOOGLE_DRIVE_ROOT_PARENT_ID}/                    ← MAHAKAN COFFEE
 *     NOTA MAHAKAN/{YYYY}/{NN. MONTH}/                ← purchase receipts
 *     DOKUMEN HR/{Nama Karyawan}/                     ← HR documents
 *     STRUK PENGELUARAN/{YYYY}/{NN. MONTH}/           ← expense receipts
 *
 * Why OAuth refresh token (bukan Service Account):
 *   Service accounts tidak punya Drive storage quota di personal Gmail
 *   accounts (Google policy). OAuth user delegation: Owner authorize 1×
 *   via `npm run drive:auth`, app act atas nama Owner. File count
 *   terhadap Owner's 15GB Gmail quota.
 *
 * Required env vars (Vercel project settings):
 *   GOOGLE_OAUTH_CLIENT_ID
 *   GOOGLE_OAUTH_CLIENT_SECRET
 *   GOOGLE_OAUTH_REFRESH_TOKEN
 *   GOOGLE_DRIVE_ROOT_PARENT_ID
 *     → folder ID dari URL Google Drive folder MAHAKAN COFFEE.
 *       Modul subfolder (NOTA MAHAKAN, DOKUMEN HR, STRUK PENGELUARAN)
 *       auto-create di first upload.
 *
 * Backward-compat: kalau ROOT_PARENT_ID belum di-set tapi
 * NOTA_PARENT_ID (legacy, sebelum sesi AA refactor) ada, kita pakai
 * untuk purchase saja — HR + expense return DRIVE_NOT_CONFIGURED sampai
 * Owner upgrade ke ROOT_PARENT_ID.
 */

const MONTH_LABELS_ID = [
  "01. JANUARI",
  "02. FEBRUARI",
  "03. MARET",
  "04. APRIL",
  "05. MEI",
  "06. JUNI",
  "07. JULI",
  "08. AGUSTUS",
  "09. SEPTEMBER",
  "10. OKTOBER",
  "11. NOVEMBER",
  "12. DESEMBER",
] as const;

const MODULE_ROOT_FOLDER: Record<UploadModule, string> = {
  purchase: "NOTA MAHAKAN",
  hr: "DOKUMEN HR",
  expense: "STRUK PENGELUARAN",
  attendance: "ABSENSI",
  setoran: "BUKTI SETORAN",
  /* Sesi AE-132 — Arsip dokumentasi nota staff. */
  nota_archive: "ARSIP NOTA",
};

export type UploadModule =
  | "purchase"
  | "hr"
  | "expense"
  | "attendance"
  | "setoran"
  | "nota_archive";

let _drive: drive_v3.Drive | null = null;

function getDrive(): drive_v3.Drive {
  if (_drive) return _drive;
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "OAuth env vars belum lengkap (CLIENT_ID + CLIENT_SECRET + REFRESH_TOKEN). Lihat docs/12-DRIVE-INTEGRATION.md.",
    );
  }
  const auth = new OAuth2Client({ clientId, clientSecret });
  auth.setCredentials({ refresh_token: refreshToken });
  _drive = drive({ version: "v3", auth });
  return _drive;
}

/** Resolve the parent under which module subfolders are created. */
function getModuleParent(module: UploadModule): string {
  const root = process.env.GOOGLE_DRIVE_ROOT_PARENT_ID;
  if (root) return root;
  // Backward-compat: legacy single-purpose env var works only for purchase.
  if (module === "purchase") {
    const legacy = process.env.GOOGLE_DRIVE_NOTA_PARENT_ID;
    if (legacy) return legacy;
  }
  throw new Error(
    "GOOGLE_DRIVE_ROOT_PARENT_ID env var belum di-set (folder ID MAHAKAN COFFEE). Lihat docs/12-DRIVE-INTEGRATION.md.",
  );
}

// Folder ID cache — survives within a warm serverless container so we don't
// re-query Drive for parent/year/month/employee folder IDs on every upload.
// Key format: `${parentId}/${name}`. Cleared only on container restart.
const folderIdCache = new Map<string, string>();

async function findOrCreateFolder(
  d: drive_v3.Drive,
  name: string,
  parentId: string,
): Promise<string> {
  const cacheKey = `${parentId}/${name}`;
  const cached = folderIdCache.get(cacheKey);
  if (cached) return cached;

  const safeName = name.replace(/'/g, "\\'");
  const list = await d.files.list({
    q: `name='${safeName}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
    fields: "files(id, name)",
    pageSize: 1,
    spaces: "drive",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  if (list.data.files && list.data.files.length > 0) {
    const id = list.data.files[0].id!;
    folderIdCache.set(cacheKey, id);
    return id;
  }
  const created = await d.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
    supportsAllDrives: true,
  });
  const id = created.data.id!;
  folderIdCache.set(cacheKey, id);
  return id;
}

/**
 * Resolve the full subfolder hierarchy for a module. Returns the deepest
 * folder ID + a human-readable label of the path traversed.
 */
async function resolveTargetFolder(
  d: drive_v3.Drive,
  module: UploadModule,
  ctx: UploadContext,
): Promise<{ folderId: string; pathLabel: string }> {
  const moduleParent = getModuleParent(module);
  const moduleRootName = MODULE_ROOT_FOLDER[module];
  const moduleRoot = await findOrCreateFolder(d, moduleRootName, moduleParent);

  if (module === "hr") {
    if (!ctx.employeeName) throw new Error("employeeName wajib untuk HR");
    // Folder per karyawan — semua dokumen 1 orang ngumpul di satu folder.
    // Sertakan ID short suffix biar handle dua karyawan dengan nama sama.
    const safeName = ctx.employeeName
      .replace(/[\\/?*<>:|"]/g, "_")
      .slice(0, 80);
    const idHint = ctx.employeeId
      ? ` (${ctx.employeeId.slice(0, 8)})`
      : "";
    const empFolderName = `${safeName}${idHint}`;
    const empFolder = await findOrCreateFolder(d, empFolderName, moduleRoot);
    return {
      folderId: empFolder,
      pathLabel: `${moduleRootName}/${empFolderName}`,
    };
  }

  if (module === "attendance") {
    // Phase 4 (sesi AB) — selfie absensi: ABSENSI/{Nama}/{YYYY-MM-DD}/
    if (!ctx.employeeName)
      throw new Error("employeeName wajib untuk attendance");
    if (!ctx.date) throw new Error("date wajib untuk attendance");
    const safeName = ctx.employeeName
      .replace(/[\\/?*<>:|"]/g, "_")
      .slice(0, 80);
    const idHint = ctx.employeeId ? ` (${ctx.employeeId.slice(0, 8)})` : "";
    const empFolderName = `${safeName}${idHint}`;
    const empFolder = await findOrCreateFolder(d, empFolderName, moduleRoot);
    const dateFolder = await findOrCreateFolder(d, ctx.date, empFolder);
    return {
      folderId: dateFolder,
      pathLabel: `${moduleRootName}/${empFolderName}/${ctx.date}`,
    };
  }

  // purchase + expense + setoran + nota_archive: year/month structure
  if (!ctx.date)
    throw new Error("date wajib untuk purchase/expense/setoran/nota_archive");
  const m = ctx.date.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!m) throw new Error("date harus YYYY-MM-DD");
  const yyyy = m[1];
  const monthIdx = parseInt(m[2], 10) - 1;
  const yearFolderName =
    module === "purchase"
      ? `NOTA MAHAKAN ${yyyy}`
      : module === "setoran"
        ? `BUKTI SETORAN ${yyyy}`
        : module === "nota_archive"
          ? `ARSIP NOTA ${yyyy}`
          : yyyy;
  const monthFolderName = MONTH_LABELS_ID[monthIdx];

  const yearFolder = await findOrCreateFolder(d, yearFolderName, moduleRoot);
  const monthFolder = await findOrCreateFolder(
    d,
    monthFolderName,
    yearFolder,
  );

  /* Sesi AE-132 — nota_archive subfolder per kategori biar Owner gampang
   * navigate ke jenis nota tertentu (mis. ARSIP NOTA/2026/05. MEI/
   * OPERASIONAL/). */
  if (module === "nota_archive") {
    if (!ctx.category)
      throw new Error("category wajib untuk nota_archive");
    const catFolderName = formatNotaArchiveCategoryFolder(ctx.category);
    const catFolder = await findOrCreateFolder(d, catFolderName, monthFolder);
    return {
      folderId: catFolder,
      pathLabel: `${moduleRootName}/${yearFolderName}/${monthFolderName}/${catFolderName}`,
    };
  }

  return {
    folderId: monthFolder,
    pathLabel: `${moduleRootName}/${yearFolderName}/${monthFolderName}`,
  };
}

/** Pretty folder names per kategori (uppercase, no underscore). */
function formatNotaArchiveCategoryFolder(category: string): string {
  switch (category) {
    case "pembelian_cash":
      return "PEMBELIAN CASH";
    case "pembayaran_top":
      return "PEMBAYARAN TOP";
    case "operasional":
      return "OPERASIONAL";
    case "maintenance":
      return "MAINTENANCE";
    case "marketing":
      return "MARKETING";
    case "pajak_admin":
      return "PAJAK & ADMIN";
    case "gaji_thr":
      return "GAJI & THR";
    case "aset":
      return "ASET & EQUIPMENT";
    case "lainnya":
      return "LAINNYA";
    default:
      return "LAINNYA";
  }
}

interface UploadContext {
  /** YYYY-MM-DD — required for purchase/expense (drives year+month folder). */
  date?: string;
  /** Required for HR — drives the per-employee folder name. */
  employeeId?: string;
  /** Required for HR — folder labelled with this. */
  employeeName?: string;
  /** Required for nota_archive — drives kategori subfolder name. */
  category?: string;
}

export interface UploadOpts {
  module: UploadModule;
  context: UploadContext;
  originalName: string;
  contentType: string;
  data: Buffer;
  /** Optional fully-formed filename (with extension). If set, uploader
   * uses it as-is instead of the legacy `{date}_{ts}_{originalName}`
   * convention. Use buildFriendlyFilename() helper untuk consistent
   * naming convention across modules. */
  customFilename?: string;
}

export interface DriveUploadResult {
  /** Public webViewLink (anyone-with-link reader). Stored di
   * receiver kolom URL (mis. purchases.receipt_image_url). */
  url: string;
  /** Drive file ID — for future ops (rename, delete). */
  fileId: string;
  /** Path label like "NOTA MAHAKAN/2026/05. MEI" — surface ke toast
   * supaya user tahu file masuk folder mana. */
  folderPath: string;
  /** Sesi AE-50 — parent folder Drive ID. Untuk attendance, ini folder
   * `ABSENSI/{Nama}/{date}/` yang berisi semua selfie hari itu. Caller
   * bisa simpan ke DB supaya UI bisa render "Buka folder hari ini" link
   * tanpa hit Drive API saat display. */
  folderId: string;
  /** Folder URL (drive.google.com/drive/folders/{id}) — pre-built untuk
   * convenience, anyone-with-link reader sudah di-set di parent. */
  folderUrl: string;
}

/**
 * Upload a file to Google Drive under the module's auto-organized
 * subfolder. Returns webViewLink + folder path label.
 *
 * Performance: folder lookups cached at module level, so subsequent
 * uploads to the same date (purchase/expense) or same employee (HR) are
 * a single API call. Anyone-with-link reader set in parallel with
 * metadata fetch.
 */
export async function uploadToDrive(
  opts: UploadOpts,
): Promise<DriveUploadResult> {
  const d = getDrive();
  const { folderId, pathLabel } = await resolveTargetFolder(
    d,
    opts.module,
    opts.context,
  );

  // Sanitize filename — strip path separators, collapse weird chars.
  // If caller supplied customFilename (recommended via buildFriendlyFilename
  // helper), use that. Else fallback to legacy `{date}_{ts}_{originalName}`.
  let finalName: string;
  if (opts.customFilename && opts.customFilename.trim().length > 0) {
    finalName = opts.customFilename.replace(/[^\w.\-]/g, "_").slice(0, 200);
  } else {
    const safeName = opts.originalName
      .replace(/[^\w.\-]/g, "_")
      .slice(0, 100);
    const ts = Date.now();
    const datePrefix = opts.context.date ? `${opts.context.date}_` : "";
    finalName = `${datePrefix}${ts}_${safeName}`;
  }

  const created = await d.files.create({
    requestBody: {
      name: finalName,
      parents: [folderId],
    },
    media: {
      mimeType: opts.contentType,
      body: Readable.from(opts.data),
    },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });
  const fileId = created.data.id;
  if (!fileId) throw new Error("Drive tidak return file ID");

  // Set anyone-with-link reader + fetch webViewLink in parallel — webViewLink
  // returned by create() is sometimes the un-shared variant which 404s for
  // non-owner readers. Re-fetch after permission grant guarantees the
  // shareable URL is propagated.
  const [, meta] = await Promise.all([
    d.permissions.create({
      fileId,
      requestBody: { role: "reader", type: "anyone" },
      supportsAllDrives: true,
    }),
    d.files.get({
      fileId,
      fields: "webViewLink",
      supportsAllDrives: true,
    }),
  ]);
  const url = meta.data.webViewLink ?? created.data.webViewLink;
  if (!url) throw new Error("Drive tidak return webViewLink");

  /* Sesi AE-50 — set folder permission anyone-with-link reader supaya
   * kalau HR klik tombol "Buka folder hari ini" di Back Office, langsung
   * bisa view tanpa request access. Best-effort: kalau gagal (e.g. owner
   * sudah set folder permission manual), tidak block upload result. */
  try {
    await d.permissions.create({
      fileId: folderId,
      requestBody: { role: "reader", type: "anyone" },
      supportsAllDrives: true,
    });
  } catch (permErr) {
    console.warn("[drive] folder permission set failed (non-fatal):", permErr);
  }

  const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
  return { url, fileId, folderPath: pathLabel, folderId, folderUrl };
}

export { buildFriendlyFilename } from "./filename";

export function isDriveConfigured(): boolean {
  const hasOAuth = Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
      process.env.GOOGLE_OAUTH_REFRESH_TOKEN,
  );
  const hasParent = Boolean(
    process.env.GOOGLE_DRIVE_ROOT_PARENT_ID ||
      process.env.GOOGLE_DRIVE_NOTA_PARENT_ID,
  );
  return hasOAuth && hasParent;
}
