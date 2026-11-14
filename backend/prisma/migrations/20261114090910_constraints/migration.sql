-- Enable btree_gist so UUID equality can be combined with tstzrange overlap in GiST
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- DB-level guarantee behind BR-1 (No Double-Booking)
ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_no_overlapping_active_slots"
  EXCLUDE USING gist (
    "masterId" WITH =,
    tstzrange("startAt", "endAt", '[)') WITH &&
  )
  WHERE ("deletedAt" IS NULL AND "status" IN ('SCHEDULED', 'COMPLETED'));

-- CHECK constraints (§3.5)
ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_endAt_after_startAt_chk"
  CHECK ("endAt" > "startAt");

ALTER TABLE "Service"
  ADD CONSTRAINT "Service_durationMin_range_chk"
  CHECK ("durationMin" BETWEEN 5 AND 720),
  ADD CONSTRAINT "Service_price_non_negative_chk"
  CHECK ("price" >= 0);

ALTER TABLE "WorkingHours"
  ADD CONSTRAINT "WorkingHours_dayOfWeek_iso_chk"
  CHECK ("dayOfWeek" BETWEEN 1 AND 7);

ALTER TABLE "Company"
  ADD CONSTRAINT "Company_slotIntervalMin_range_chk"
  CHECK ("slotIntervalMin" BETWEEN 5 AND 120),
  ADD CONSTRAINT "Company_minLeadTimeMin_non_negative_chk"
  CHECK ("minLeadTimeMin" >= 0),
  ADD CONSTRAINT "Company_maxAdvanceDays_range_chk"
  CHECK ("maxAdvanceDays" BETWEEN 1 AND 365);
