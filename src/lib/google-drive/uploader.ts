import "server-only";
import { Readable } from "node:stream";
import { drive, type drive_v3 } from "@googleapis/drive";
import { GoogleAuth } from "google-auth-library";

/**
 * Google Drive uploader for purchase receipts (sesi AA #2 — Opsi B).
 *
 * Drops files into a year/month subfolder structure matching Owner's
 * existing workflow:
 *
 *   {GOOGLE_DRIVE_NOTA_PARENT_ID}/
 *     NOTA MAHAKAN 2026/
 *       01. JANUARI/
 *       02. FEBRUARI/
 *       ...
 *
 * Folders auto-created on first upload of that month. Files made
 * shareable (anyone-with-link reader) so Owner can copy URL + share
 * dengan akuntan eksternal tanpa Mahakan POS login.
 *
 * Required env vars (set di Vercel project settings):
 *   GOOGLE_SERVICE_ACCOUNT_JSON
 *     → entire JSON key file content of a Google Cloud service account
 *       with Drive API enabled. Owner downloads dari Google Cloud Console.
 *   GOOGLE_DRIVE_NOTA_PARENT_ID
 *     → ID of the parent "NOTA MAHAKAN" folder (extracted from URL).
 *       Owner must share this folder with the service account email
 *       (Editor permission) before first upload works.
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

let _drive: drive_v3.Drive | null = null;

function getDrive(): drive_v3.Drive {
  if (_drive) return _drive;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON env var belum di-set. Lihat panduan setup di docs/12-DRIVE-INTEGRATION.md.",
    );
  }
  let credentials: Record<string, unknown>;
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON bukan JSON valid. Pastikan paste seluruh konten file kunci tanpa edit.",
    );
  }
  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });
  _drive = drive({ version: "v3", auth });
  return _drive;
}

function getParentId(): string {
  const id = process.env.GOOGLE_DRIVE_NOTA_PARENT_ID;
  if (!id) {
    throw new Error(
      "GOOGLE_DRIVE_NOTA_PARENT_ID env var belum di-set. Copy folder ID dari URL Drive 'NOTA MAHAKAN'.",
    );
  }
  return id;
}

// Folder ID cache — survives within a warm serverless container so we don't
// re-query Drive for parent/year/month folder IDs on every upload.
const folderIdCache = new Map<string, string>();

async function findOrCreateFolder(
  drive: drive_v3.Drive,
  name: string,
  parentId: string,
): Promise<string> {
  const cacheKey = `${parentId}/${name}`;
  const cached = folderIdCache.get(cacheKey);
  if (cached) return cached;

  // Escape single quotes in name for the q parameter (Drive API quirk).
  const safeName = name.replace(/'/g, "\\'");
  const list = await drive.files.list({
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
  const created = await drive.files.create({
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

export interface DriveUploadResult {
  /** Public webViewLink (anyone with link can view). Stored di
   * purchases.receipt_image_url. */
  url: string;
  /** Drive file ID — kept for future ops (rename, delete). */
  fileId: string;
  /** Year/month folder labels (untuk audit log + UI hint). */
  folderPath: string;
}

/**
 * Upload a purchase receipt to Google Drive. Auto-creates year + month
 * subfolders matching Owner's existing structure (NOTA MAHAKAN {YYYY} /
 * {NN. MONTH_ID}). File renamed to {purchaseDate}-{ts}-{originalName} to
 * match the auto-rename convention of the deprecated Vercel Blob path.
 *
 * @param purchaseDate ISO date string (YYYY-MM-DD) — drives year+month folder
 * @param originalName user-supplied filename (sanitized server-side)
 * @param contentType MIME type
 * @param data file bytes
 */
export async function uploadPurchaseReceiptToDrive(opts: {
  purchaseDate: string;
  originalName: string;
  contentType: string;
  data: Buffer;
}): Promise<DriveUploadResult> {
  const drive = getDrive();
  const parentId = getParentId();

  // Year + month from purchaseDate (Asia/Jakarta calendar already implied
  // by purchase_date being a date-only string with no TZ).
  const m = opts.purchaseDate.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!m) {
    throw new Error("purchaseDate harus YYYY-MM-DD");
  }
  const yyyy = m[1];
  const monthIdx = parseInt(m[2], 10) - 1;
  const yearFolderName = `NOTA MAHAKAN ${yyyy}`;
  const monthFolderName = MONTH_LABELS_ID[monthIdx];

  const yearFolderId = await findOrCreateFolder(drive, yearFolderName, parentId);
  const monthFolderId = await findOrCreateFolder(
    drive,
    monthFolderName,
    yearFolderId,
  );

  // Sanitize filename — strip path separators, collapse weird chars.
  const safeName = opts.originalName
    .replace(/[^\w.\-]/g, "_")
    .slice(0, 100);
  const ts = Date.now();
  const finalName = `${opts.purchaseDate}_${ts}_${safeName}`;

  const created = await drive.files.create({
    requestBody: {
      name: finalName,
      parents: [monthFolderId],
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

  // Make shareable — anyone with link can view (read-only). Owner can
  // copy URL ke akuntan tanpa share folder access individually.
  await drive.permissions.create({
    fileId,
    requestBody: { role: "reader", type: "anyone" },
    supportsAllDrives: true,
  });

  // webViewLink populated only after permissions set, fetch it now.
  const meta = await drive.files.get({
    fileId,
    fields: "webViewLink",
    supportsAllDrives: true,
  });
  const url = meta.data.webViewLink;
  if (!url) throw new Error("Drive tidak return webViewLink");

  return {
    url,
    fileId,
    folderPath: `${yearFolderName}/${monthFolderName}`,
  };
}

export function isDriveConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON &&
      process.env.GOOGLE_DRIVE_NOTA_PARENT_ID,
  );
}
