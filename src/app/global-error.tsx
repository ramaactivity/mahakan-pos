"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error]", error);
  }, [error]);

  return (
    <html lang="id">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#fafafa",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          padding: "1rem",
        }}
      >
        <div
          style={{
            maxWidth: "28rem",
            width: "100%",
            backgroundColor: "white",
            border: "1px solid #e5e5e5",
            borderRadius: "0.5rem",
            padding: "1.5rem",
            boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: "1.125rem",
              fontWeight: 600,
              color: "#171717",
            }}
          >
            Aplikasi gagal dimuat
          </h1>
          <p
            style={{
              marginTop: "0.5rem",
              fontSize: "0.875rem",
              color: "#525252",
            }}
          >
            Ada masalah serius. Coba refresh halaman atau hubungi admin jika
            terus terjadi.
          </p>
          {error.digest ? (
            <p
              style={{
                marginTop: "0.5rem",
                fontFamily:
                  'ui-monospace, SFMono-Regular, "JetBrains Mono", monospace',
                fontSize: "0.75rem",
                color: "#a3a3a3",
              }}
            >
              Ref: {error.digest}
            </p>
          ) : null}
          <button
            onClick={reset}
            style={{
              marginTop: "1.25rem",
              height: "2.5rem",
              padding: "0 1rem",
              backgroundColor: "#3D7557",
              color: "white",
              border: "none",
              borderRadius: "0.375rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Coba lagi
          </button>
        </div>
      </body>
    </html>
  );
}
