import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    /* Attendance pada 19-20 Mei: cek siapa yang clock-in (clockedInBy) */
    const r = await c.query(`
      SELECT a.id, a.shift_date, e.full_name AS employee,
             a.clock_in_at, a.clock_out_at,
             a.is_late, a.late_minutes, a.overtime_minutes,
             u_in.name AS clocked_in_by_name,
             u_in.email AS clocked_in_by_email,
             u_in.role AS clocked_in_by_role,
             u_out.name AS clocked_out_by_name,
             a.client_ref_id IS NOT NULL AS via_mobile,
             a.selfie_drive_url IS NOT NULL AS has_selfie,
             a.created_at
      FROM attendance_records a
      LEFT JOIN employees e ON e.id = a.employee_id
      LEFT JOIN users u_in ON u_in.id = a.clocked_in_by
      LEFT JOIN users u_out ON u_out.id = a.clocked_out_by
      WHERE a.created_at >= '2026-05-19 00:00:00+07'
        AND a.created_at <= '2026-05-20 23:59:59+07'
      ORDER BY a.shift_date, a.clock_in_at
    `);
    console.log(`\nAttendance 19-20 Mei (${r.rows.length} records):\n`);
    for (const row of r.rows) {
      const flag = row.via_mobile ? "📱 MOBILE" : "🖥 KIOSK";
      const selfie = row.has_selfie ? "📸" : " ";
      console.log(
        `${String(row.shift_date).slice(0,10)} | ${row.employee?.padEnd(35) || "?"} | ${flag} ${selfie} | in=${row.clock_in_at?.toISOString().slice(11,16)} out=${row.clock_out_at?.toISOString().slice(11,16) || "-"} | clocked_in_by=${row.clocked_in_by_name} (${row.clocked_in_by_role})`,
      );
    }
    /* Also check: is staff users clocking in themselves? */
    console.log("\n=== Distinct clocked_in_by users (19-20 May) ===");
    const r2 = await c.query(`
      SELECT u.name, u.email, u.role, COUNT(*) AS n
      FROM attendance_records a
      JOIN users u ON u.id = a.clocked_in_by
      WHERE a.created_at >= '2026-05-19 00:00:00+07'
        AND a.created_at <= '2026-05-20 23:59:59+07'
      GROUP BY u.name, u.email, u.role
    `);
    for (const row of r2.rows) {
      console.log(`  ${row.name} (${row.email}) | ${row.role} | n=${row.n}`);
    }
    /* Also: attendance pada 18 Mei dan sebelumnya — clocked_in_by siapa? */
    console.log("\n=== Attendance 11-18 May for comparison ===");
    const r3 = await c.query(`
      SELECT a.shift_date, e.full_name AS employee,
             u_in.name AS clocked_in_by, a.client_ref_id IS NOT NULL AS via_mobile,
             a.created_at::date AS created_date
      FROM attendance_records a
      LEFT JOIN employees e ON e.id = a.employee_id
      LEFT JOIN users u_in ON u_in.id = a.clocked_in_by
      WHERE a.shift_date >= '2026-05-11' AND a.shift_date <= '2026-05-18'
      ORDER BY a.shift_date, a.clock_in_at
      LIMIT 12
    `);
    for (const row of r3.rows) {
      console.log(`  ${row.shift_date} (created ${row.created_date}) | ${row.employee} | by ${row.clocked_in_by} | mobile=${row.via_mobile}`);
    }
  } finally {
    c.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
