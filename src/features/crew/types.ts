/** Sesi AE-235 — crew attribution on POS actions. */

export interface PosCrew {
  id: string;
  name: string;
  /** Clocked in (attendance open) right now. */
  onDuty: boolean;
}

/** What gets stored in audit metadata. */
export type CrewRef = PosCrew;
