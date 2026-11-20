-- Core Booking Phase 2 (part 2):
-- Extend double-booking EXCLUDE constraint to block CONFIRMED and IN_PROGRESS appointments too.

ALTER TABLE "Appointment"
  DROP CONSTRAINT "Appointment_no_overlapping_active_slots";

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_no_overlapping_active_slots"
  EXCLUDE USING gist (
    "masterId" WITH =,
    tstzrange("startAt", "endAt", '[)') WITH &&
  )
  WHERE ("deletedAt" IS NULL AND "status" IN ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'));
