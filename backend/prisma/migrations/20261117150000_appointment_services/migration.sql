CREATE UNIQUE INDEX "Service_id_companyId_key" ON "Service"("id", "companyId");
CREATE UNIQUE INDEX "Appointment_id_companyId_key" ON "Appointment"("id", "companyId");
CREATE TABLE "AppointmentService" (
  "appointmentId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "serviceId" UUID NOT NULL,
  "position" INTEGER NOT NULL CHECK ("position" >= 0 AND "position" < 10),
  "name" TEXT NOT NULL,
  "durationMin" INTEGER NOT NULL CHECK ("durationMin" > 0),
  "price" DECIMAL(10,2) NOT NULL CHECK ("price" >= 0),
  PRIMARY KEY ("appointmentId", "serviceId"),
  UNIQUE ("appointmentId", "position"),
  FOREIGN KEY ("appointmentId", "companyId") REFERENCES "Appointment"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("serviceId", "companyId") REFERENCES "Service"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "AppointmentService_companyId_serviceId_idx" ON "AppointmentService"("companyId", "serviceId");
INSERT INTO "AppointmentService" ("appointmentId", "companyId", "serviceId", "position", "name", "durationMin", "price")
SELECT a."id", a."companyId", a."serviceId", 0, s."name", GREATEST(1, ROUND(EXTRACT(EPOCH FROM (a."endAt" - a."startAt")) / 60)::integer), a."price"
FROM "Appointment" a JOIN "Service" s ON s."id" = a."serviceId" AND s."companyId" = a."companyId";
