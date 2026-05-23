/**
 * Sesi AE-131 — Default seed tasks per (frequency, section).
 *
 * Diisi otomatis saat outlet pertama kali membuka modul Operasional
 * Checklist (lazy seed di listTemplates). Owner/Manager boleh edit/
 * hapus/tambah lewat back office; is_seed flag dipakai cuma untuk UI
 * label "default" tanpa mempengaruhi behavior.
 *
 * Wording disesuaikan dari draft owner (sesi AE-131): konsisten gaya
 * "Bersihin/Cek/Rapihin", penambahan konteks (mis. "wastafel" pada
 * toilet, "& doormat" pada keset). Boleh diubah owner kapan saja.
 */

import type {
  OperasionalFrequency,
  OperasionalSection,
} from "@/db/schema/operasional_tasks";

export interface SeedTask {
  title: string;
  description?: string;
}

interface SeedGroup {
  frequency: OperasionalFrequency;
  section: OperasionalSection;
  tasks: SeedTask[];
}

export const DEFAULT_SEED_GROUPS: SeedGroup[] = [
  /* ---------------- DAILY ---------------- */
  {
    frequency: "daily",
    section: "general",
    tasks: [
      {
        title: "Bersihin area umum",
        description: "Sweeping + mopping seluruh area customer.",
      },
      {
        title: "Bersihin toilet & wastafel",
        description: "Cek sabun, tisu, dan kondisi keset toilet.",
      },
      {
        title: "Bersihin musholla",
        description: "Rapihin sajadah, mukena, dan kipas.",
      },
      {
        title: "Update stok & preparation menu",
        description: "Cek bahan habis pakai + prep menu shift selanjutnya.",
      },
      {
        title: "Cek pesanan GrabFood, GoFood, ShopeeFood",
        description: "Pastikan device online + status outlet open.",
      },
      {
        title: "Buang sampah & sortir waste",
        description: "Pisahkan organik vs anorganik, kosongkan bin.",
      },
    ],
  },

  /* ---------------- WEEKLY ---------------- */
  {
    frequency: "weekly",
    section: "bar",
    tasks: [
      { title: "Bersihin showcase bar" },
      { title: "Bersihin freezer bar" },
      {
        title: "Cuci aset bar",
        description: "Gelas, shaker, jigger, strainer, dan utensil lain.",
      },
      { title: "Bersihin area bar (lantai + countertop)" },
      { title: "Rapihin storage bar (botol, syrup, dry goods)" },
    ],
  },
  {
    frequency: "weekly",
    section: "kitchen",
    tasks: [
      { title: "Cuci tempat cutleries" },
      { title: "Bersihin storage kitchen" },
      {
        title: "Cuci equipment kitchen",
        description: "Wajan, panci, pan, dan utensil masak.",
      },
      { title: "Bersihin area kitchen (lantai + meja prep)" },
      { title: "Bersihin freezer kitchen" },
      { title: "Bersihin kulkas kitchen" },
    ],
  },
  {
    frequency: "weekly",
    section: "general",
    tasks: [
      { title: "Bersihin kaca jendela & pintu" },
      { title: "Bersihin lukisan & frame" },
      { title: "Bersihin lampu & fitting" },
      { title: "Bersihin langit-langit & sarang laba-laba" },
      { title: "Cuci keset & doormat" },
      { title: "Bersihin kotak tissue" },
      { title: "Bersihin buku & rak display" },
      { title: "Cuci apron staff" },
      { title: "Cuci peralatan shalat (sajadah, mukena)" },
      { title: "Maintenance taman (gardening)" },
      {
        title: "Upload nota payment TOP supplier",
        description: "Foto/scan nota TOP minggu ini, upload ke akuntansi.",
      },
    ],
  },

  /* ---------------- MONTHLY ---------------- */
  {
    frequency: "monthly",
    section: "general",
    tasks: [
      {
        title: "Jemur & bersihin sofa",
        description: "Vacuum debu, jemur cushion, deep clean kalau perlu.",
      },
      {
        title: "Stock Opname inventory full",
        description: "Hitung fisik semua bahan; submit ke Owner.",
      },
      {
        title: "Mini general cleaning",
        description: "Deep clean rotasi (1 zona besar per bulan).",
      },
    ],
  },
];
