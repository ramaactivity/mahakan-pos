#!/usr/bin/env tsx
/**
 * One-time OAuth setup for Google Drive uploader (sesi AA #2 Opsi B,
 * OAuth refresh-token variant).
 *
 * Pre-req: set GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET di
 * .env.local (atau export sebagai env var) sebelum jalankan script ini.
 *
 * Usage:
 *   npm run drive:auth
 *
 * What happens:
 *   1. Script start local HTTP server on port 8765 (callback receiver).
 *   2. Cetak Google consent URL di terminal.
 *   3. Owner buka URL di browser → login Gmail → authorize Drive access.
 *   4. Google redirect ke localhost:8765 dengan auth code.
 *   5. Script tukar code → refresh token + access token.
 *   6. Cetak refresh token + instruksi paste ke Vercel env var.
 */

import http from "node:http";
import { URL } from "node:url";
import { OAuth2Client } from "google-auth-library";

const PORT = 8765;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPES = ["https://www.googleapis.com/auth/drive.file"];

async function main() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error(
      "❌ Set GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET di .env.local dulu.\n",
    );
    console.error("Steps:");
    console.error("  1. Buka https://console.cloud.google.com → project Mahakan POS Drive");
    console.error("  2. APIs & Services → Credentials → Create Credentials → OAuth client ID");
    console.error("  3. Application type: Web application");
    console.error(`  4. Authorized redirect URIs: tambahkan ${REDIRECT_URI}`);
    console.error("  5. Click Create → copy Client ID + Client Secret");
    console.error("  6. Tambahkan ke .env.local sebelum jalankan script ini lagi");
    process.exit(1);
  }

  const oauth2 = new OAuth2Client({
    clientId,
    clientSecret,
    redirectUri: REDIRECT_URI,
  });

  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    // 'consent' force refresh_token issued ulang even kalau Owner sebelumnya
    // sudah authorize app ini — tanpa flag ini Google kadang skip refresh
    // token jika dah pernah granted, dan kita ga punya cara dapat ulang.
    prompt: "consent",
    scope: SCOPES,
  });

  console.log("\n🔑 Google Drive OAuth Setup\n");
  console.log("1. Buka URL berikut di browser (login dengan akun Gmail Owner):\n");
  console.log("   " + url + "\n");
  console.log("2. Klik 'Allow' di consent screen (mungkin ada warning 'unverified app' — klik Advanced → Go to ...).");
  console.log("3. Setelah authorize, browser redirect ke localhost — script akan otomatis lanjut.\n");
  console.log(`Listening on ${REDIRECT_URI}...\n`);

  const server = http.createServer(async (req, res) => {
    if (!req.url) {
      res.writeHead(400).end("No URL");
      return;
    }
    const u = new URL(req.url, `http://localhost:${PORT}`);
    if (u.pathname !== "/callback") {
      res.writeHead(404).end("Not found");
      return;
    }
    const code = u.searchParams.get("code");
    const error = u.searchParams.get("error");
    if (error) {
      res
        .writeHead(400, { "Content-Type": "text/plain; charset=utf-8" })
        .end(`OAuth error: ${error}\nLihat terminal untuk detail.`);
      console.error(`\n❌ OAuth error: ${error}`);
      server.close();
      process.exit(1);
    }
    if (!code) {
      res.writeHead(400).end("No code parameter");
      return;
    }
    try {
      const { tokens } = await oauth2.getToken(code);
      const refreshToken = tokens.refresh_token;
      if (!refreshToken) {
        res
          .writeHead(500, { "Content-Type": "text/plain; charset=utf-8" })
          .end(
            "Tidak dapat refresh_token. Coba revoke access di https://myaccount.google.com/permissions, lalu jalankan script ulang.",
          );
        console.error(
          "\n❌ Tidak dapat refresh_token. Owner mungkin sebelumnya sudah authorize app ini.",
        );
        console.error(
          "   Revoke dulu di https://myaccount.google.com/permissions (cari nama OAuth client),",
        );
        console.error("   lalu re-run script ini.");
        server.close();
        process.exit(1);
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(`
        <html><body style="font-family:sans-serif;padding:40px;text-align:center">
          <h2 style="color:#16a34a">✅ Authorized!</h2>
          <p>Refresh token berhasil di-capture. Cek terminal untuk langkah selanjutnya.</p>
          <p style="color:#666">Tab ini boleh ditutup.</p>
        </body></html>
      `);
      console.log("\n✅ Refresh token berhasil di-capture!\n");
      console.log("━".repeat(70));
      console.log("PASTE INI KE VERCEL ENV VARS:\n");
      console.log("  GOOGLE_OAUTH_REFRESH_TOKEN=" + refreshToken);
      console.log("━".repeat(70));
      console.log("\nLangkah selanjutnya:");
      console.log("  1. Buka https://vercel.com/ramaactivity98-5695s-projects/mahakan-pos/settings/environment-variables");
      console.log("  2. Add `GOOGLE_OAUTH_REFRESH_TOKEN` dengan value di atas (Production + Preview).");
      console.log("  3. Pastikan juga sudah set GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET di Vercel.");
      console.log("  4. Optional: hapus old env var GOOGLE_SERVICE_ACCOUNT_JSON (sudah tidak dipakai).");
      console.log("  5. Redeploy via 'npx vercel --prod --yes' atau ping saya untuk deploy.\n");
      server.close();
      process.exit(0);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res
        .writeHead(500, { "Content-Type": "text/plain; charset=utf-8" })
        .end(`Failed to exchange code: ${msg}`);
      console.error("\n❌ Gagal tukar code:", msg);
      server.close();
      process.exit(1);
    }
  });

  server.listen(PORT, () => {
    // already printed instructions above
  });
}

void main();
