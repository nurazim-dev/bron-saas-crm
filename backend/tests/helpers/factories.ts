import { randomUUID } from 'node:crypto';
import {
  AppointmentSource,
  AppointmentStatus,
  BusinessType,
  Prisma,
  Role,
  type Appointment,
  type Company,
  type Service,
  type User,
} from '../../src/generated/prisma/client.js';
import { prisma } from '../../src/lib/prisma.js';

let sequence = 0;
function nextSeq(): number {
  sequence += 1;
  return sequence;
}

export async function createCompanyFactory(
  overrides: Partial<Prisma.CompanyUncheckedCreateInput> = {},
): Promise<Company> {
  const n = nextSeq();
  return prisma.company.create({
    data: {
      name: `Test Company ${n}`,
      slug: `test-company-${n}-${randomUUID().slice(0, 6)}`,
      businessType: BusinessType.BARBERSHOP,
      timezone: 'Asia/Bishkek',
      currency: 'KGS',
      slotIntervalMin: 30,
      minLeadTimeMin: 60,
      maxAdvanceDays: 60,
      publicBookingEnabled: true,
      ...overrides,
    },
  });
}

export async function createUserFactory(
  companyId: string,
  overrides: Partial<Prisma.UserUncheckedCreateInput> = {},
): Promise<User> {
  const n = nextSeq();
  return prisma.user.create({
    data: {
      companyId,
      role: Role.MASTER,
      name: `Staff Member ${n}`,
      email: `staff-${n}-${randomUUID().slice(0, 6)}@test.zapis.kg`,
      passwordHash: 'hashed-password-placeholder',
      phone: '+996555100200',
      isActive: true,
      isBookable: true,
      ...overrides,
    },
  });
}

export async function createServiceFactory(
  companyId: string,
  overrides: Partial<Prisma.ServiceUncheckedCreateInput> = {},
): Promise<Service> {
  const n = nextSeq();
  return prisma.service.create({
    data: {
      companyId,
      name: `Service ${n}`,
      description: 'Test service description',
      durationMin: 60,
      price: new Prisma.Decimal('500.00'),
      isActive: true,
      ...overrides,
    },
  });
}

export interface CreateAppointmentOverrides {
  companyId: string;
  masterId: string;
  serviceId: string;
  startAt?: Date;
  endAt?: Date;
  price?: Prisma.Decimal | string;
  status?: AppointmentStatus;
  source?: AppointmentSource;
  clientName?: string;
  clientPhone?: string;
  clientNote?: string | null;
  internalNote?: string | null;
  deletedAt?: Date | null;
}

export async function createAppointmentFactory(
  input: CreateAppointmentOverrides,
): Promise<Appointment> {
  const startAt = input.startAt ?? new Date('2026-11-20T04:00:00.000Z');
  const endAt = input.endAt ?? new Date(startAt.getTime() + 60 * 60_000);
  return prisma.appointment.create({
    data: {
      companyId: input.companyId,
      masterId: input.masterId,
      serviceId: input.serviceId,
      clientName: input.clientName ?? 'Test Client',
      clientPhone: input.clientPhone ?? '+996555999888',
      clientNote: input.clientNote ?? null,
      internalNote: input.internalNote ?? null,
      startAt,
      endAt,
      price:
        input.price !== undefined ? new Prisma.Decimal(input.price) : new Prisma.Decimal('500.00'),
      status: input.status ?? AppointmentStatus.SCHEDULED,
      source: input.source ?? AppointmentSource.ONLINE,
      deletedAt: input.deletedAt ?? null,
    },
  });
}
