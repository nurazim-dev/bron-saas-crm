import '../src/config/utc.js';
import argon2 from 'argon2';
import { DateTime } from 'luxon';
import {
  AppointmentSource,
  AppointmentStatus,
  BusinessType,
  Prisma,
  Role,
} from '../src/generated/prisma/client.js';
import { disconnectPrisma, prisma, prismaUnfiltered } from '../src/lib/prisma.js';
import { createTrialSubscriptionForCompany } from '../src/modules/billing/billing.service.js';

const DEMO_PASSWORD = 'Demo12345!';
const BISHKEK_TZ = 'Asia/Bishkek';

function nextWorkingLocalDate(daysAhead: number): DateTime {
  let candidate = DateTime.now().setZone(BISHKEK_TZ).startOf('day').plus({ days: daysAhead });
  while (candidate.weekday === 7) {
    candidate = candidate.plus({ days: 1 });
  }
  return candidate;
}

function localSlotToUtc(localDate: DateTime, hour: number, minute: number): Date {
  const dt = localDate.set({ hour, minute, second: 0, millisecond: 0 });
  return dt.toUTC().toJSDate();
}

async function runSeed(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    process.stderr.write('Refusing to run seed: NODE_ENV is production.\n');
    process.exit(1);
  }

  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });

  await prismaUnfiltered.$transaction([
    prismaUnfiltered.subscriptionPayment.deleteMany(),
    prismaUnfiltered.subscription.deleteMany(),
    prismaUnfiltered.appointment.deleteMany(),
    prismaUnfiltered.workingHours.deleteMany(),
    prismaUnfiltered.masterService.deleteMany(),
    prismaUnfiltered.service.deleteMany(),
    prismaUnfiltered.user.deleteMany(),
    prismaUnfiltered.company.deleteMany(),
  ]);

  const company = await prismaUnfiltered.company.create({
    data: {
      name: 'Demo Barbershop',
      slug: 'demo-barbershop',
      businessType: BusinessType.BARBERSHOP,
      phone: '+996555000100',
      address: 'г. Бишкек, пр. Чуй 150',
      timezone: BISHKEK_TZ,
      currency: 'KGS',
      slotIntervalMin: 30,
      minLeadTimeMin: 60,
      maxAdvanceDays: 60,
      publicBookingEnabled: true,
    },
  });

  await createTrialSubscriptionForCompany(prisma, company.id);

  const owner = await prismaUnfiltered.user.create({
    data: {
      companyId: company.id,
      role: Role.OWNER,
      name: 'Азамат Токтогулов',
      email: 'owner@demo.zapis.kg',
      passwordHash,
      phone: '+996555000101',
      isActive: true,
      isBookable: true,
    },
  });

  const masterWithLogin = await prismaUnfiltered.user.create({
    data: {
      companyId: company.id,
      role: Role.MASTER,
      name: 'Бекзат Исаков',
      email: 'master@demo.zapis.kg',
      passwordHash,
      phone: '+996555000102',
      isActive: true,
      isBookable: true,
    },
  });

  const masterWithoutLogin = await prismaUnfiltered.user.create({
    data: {
      companyId: company.id,
      role: Role.MASTER,
      name: 'Нурлан Осмонов',
      email: null,
      passwordHash: null,
      phone: '+996555000103',
      isActive: true,
      isBookable: true,
    },
  });

  const servicesData = [
    {
      name: 'Мужская стрижка',
      description: 'Классическая или современная стрижка с мытьём головы и укладкой',
      durationMin: 60,
      price: new Prisma.Decimal('500.00'),
    },
    {
      name: 'Моделирование бороды',
      description: 'Оформление бороды и усов опасной бритвой и триммером',
      durationMin: 30,
      price: new Prisma.Decimal('300.00'),
    },
    {
      name: 'Стрижка + Борода (Комплекс)',
      description: 'Мужская стрижка и моделирование бороды в один визит',
      durationMin: 90,
      price: new Prisma.Decimal('700.00'),
    },
    {
      name: 'Детская стрижка (до 12 лет)',
      description: 'Аккуратная стрижка для мальчиков до 12 лет',
      durationMin: 45,
      price: new Prisma.Decimal('400.00'),
    },
    {
      name: 'Королевское бритьё',
      description: 'Традиционное влажное бритьё с распариванием горячим полотенцем',
      durationMin: 45,
      price: new Prisma.Decimal('450.00'),
    },
  ] as const;

  const createdServices = [];
  for (const s of servicesData) {
    const created = await prismaUnfiltered.service.create({
      data: {
        companyId: company.id,
        name: s.name,
        description: s.description,
        durationMin: s.durationMin,
        price: s.price,
        isActive: true,
      },
    });
    createdServices.push(created);
  }

  const [haircut, beard, combo, kids, royalShave] = createdServices;
  if (!haircut || !beard || !combo || !kids || !royalShave) {
    throw new Error('Failed to create seed services');
  }

  const staffMembers = [owner, masterWithLogin, masterWithoutLogin];
  for (const staff of staffMembers) {
    for (const srv of createdServices) {
      await prismaUnfiltered.masterService.create({
        data: {
          userId: staff.id,
          serviceId: srv.id,
        },
      });
    }

    for (let dayOfWeek = 1; dayOfWeek <= 6; dayOfWeek++) {
      await prismaUnfiltered.workingHours.create({
        data: {
          userId: staff.id,
          dayOfWeek,
          startTime: '10:00',
          endTime: '20:00',
        },
      });
    }
  }

  const day1 = nextWorkingLocalDate(1);
  const day2 = nextWorkingLocalDate(2);
  const day3 = nextWorkingLocalDate(3);

  const sampleAppointments = [
    {
      masterId: masterWithLogin.id,
      service: haircut,
      startAt: localSlotToUtc(day1, 11, 0),
      clientName: 'Тимур Асанов',
      clientPhone: '+996700112233',
      clientNote: 'Фейд с переходом',
      source: AppointmentSource.ONLINE,
    },
    {
      masterId: masterWithLogin.id,
      service: beard,
      startAt: localSlotToUtc(day1, 13, 0),
      clientName: 'Эркин Жумабаев',
      clientPhone: '+996700223344',
      clientNote: null,
      source: AppointmentSource.ONLINE,
    },
    {
      masterId: owner.id,
      service: combo,
      startAt: localSlotToUtc(day1, 14, 0),
      clientName: 'Марат Сыдыков',
      clientPhone: '+996555334455',
      clientNote: 'Постоянный клиент',
      source: AppointmentSource.STAFF,
    },
    {
      masterId: masterWithoutLogin.id,
      service: kids,
      startAt: localSlotToUtc(day2, 10, 30),
      clientName: 'Данияр Кадыров',
      clientPhone: '+996772445566',
      clientNote: 'Сын Алихан, 8 лет',
      source: AppointmentSource.ONLINE,
    },
    {
      masterId: masterWithLogin.id,
      service: royalShave,
      startAt: localSlotToUtc(day2, 16, 0),
      clientName: 'Руслан Беков',
      clientPhone: '+996500556677',
      clientNote: null,
      source: AppointmentSource.STAFF,
    },
    {
      masterId: owner.id,
      service: haircut,
      startAt: localSlotToUtc(day3, 12, 0),
      clientName: 'Канат Усенов',
      clientPhone: '+996550667788',
      clientNote: null,
      source: AppointmentSource.ONLINE,
    },
  ];

  for (const appt of sampleAppointments) {
    const endAt = new Date(appt.startAt.getTime() + appt.service.durationMin * 60_000);
    await prismaUnfiltered.appointment.create({
      data: {
        companyId: company.id,
        masterId: appt.masterId,
        serviceId: appt.service.id,
        clientName: appt.clientName,
        clientPhone: appt.clientPhone,
        clientNote: appt.clientNote,
        startAt: appt.startAt,
        endAt,
        price: appt.service.price,
        status: AppointmentStatus.SCHEDULED,
        source: appt.source,
      },
    });
  }

  process.stdout.write(
    `Seeded company "${company.name}" (${company.slug}) with 3 staff, ${createdServices.length} services, and ${sampleAppointments.length} future appointments.\n`,
  );
}

runSeed()
  .catch((err: unknown) => {
    process.stderr.write(`Seed failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  })
  .finally(async () => {
    await disconnectPrisma();
  });
