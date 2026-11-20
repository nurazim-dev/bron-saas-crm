import { Role } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import type { AuthenticatedActor } from '../../types/express.js';
import type { GlobalSearchQuery } from './search.schemas.js';

export async function runGlobalSearch(actor: AuthenticatedActor, query: GlobalSearchQuery) {
  const { q, limit } = query;
  const companyId = actor.companyId;
  const isMaster = actor.role === Role.MASTER;

  const staffWhere =
    actor.role === Role.OWNER
      ? {
          companyId,
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { email: { contains: q, mode: 'insensitive' as const } },
            { phone: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : actor.role === Role.MANAGER
        ? {
            companyId,
            isBookable: true,
            name: { contains: q, mode: 'insensitive' as const },
          }
        : {
            companyId,
            id: actor.userId,
            name: { contains: q, mode: 'insensitive' as const },
          };

  const [clients, appointments, services, packages, staff] = await Promise.all([
    prisma.client.findMany({
      where: {
        companyId,
        mergedAt: null,
        ...(isMaster
          ? {
              appointments: {
                some: { companyId, masterId: actor.userId, deletedAt: null },
              },
            }
          : {}),
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q, mode: 'insensitive' } },
          {
            tags: {
              some: {
                companyId,
                tag: { name: { contains: q, mode: 'insensitive' } },
              },
            },
          },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        name: true,
        phone: true,
        isBlocked: true,
        tags: {
          orderBy: { tag: { name: 'asc' } },
          select: { tag: { select: { id: true, name: true, color: true } } },
        },
      },
    }),
    prisma.appointment.findMany({
      where: {
        companyId,
        ...(isMaster ? { masterId: actor.userId } : {}),
        OR: [
          { clientName: { contains: q, mode: 'insensitive' } },
          { clientPhone: { contains: q, mode: 'insensitive' } },
          { clientNote: { contains: q, mode: 'insensitive' } },
          { packageName: { contains: q, mode: 'insensitive' } },
          { service: { name: { contains: q, mode: 'insensitive' } } },
        ],
      },
      orderBy: { startAt: 'desc' },
      take: limit,
      select: {
        id: true,
        clientId: true,
        clientName: true,
        clientPhone: true,
        startAt: true,
        status: true,
        price: true,
        packageName: true,
        master: { select: { id: true, name: true } },
        service: { select: { name: true } },
        items: { orderBy: { position: 'asc' }, select: { name: true } },
      },
    }),
    prisma.service.findMany({
      where: {
        companyId,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: { name: 'asc' },
      take: limit,
      select: { id: true, name: true, price: true, durationMin: true, isActive: true },
    }),
    prisma.servicePackage.findMany({
      where: {
        companyId,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: { name: 'asc' },
      take: limit,
      select: { id: true, name: true, price: true, isActive: true },
    }),
    prisma.user.findMany({
      where: staffWhere,
      orderBy: { name: 'asc' },
      take: limit,
      select: {
        id: true,
        name: true,
        role: true,
        email: true,
        phone: true,
        isBookable: true,
      },
    }),
  ]);

  return {
    query: q,
    clients: clients.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      isBlocked: c.isBlocked,
      tags: c.tags.map((item) => item.tag),
    })),
    appointments: appointments.map((a) => ({
      id: a.id,
      clientId: a.clientId,
      clientName: a.clientName,
      clientPhone: a.clientPhone,
      startAt: a.startAt.toISOString(),
      status: a.status,
      price: a.price.toFixed(2),
      masterName: a.master.name,
      serviceName:
        a.packageName ??
        (a.items.length ? a.items.map((item) => item.name).join(' + ') : a.service.name),
    })),
    services: services.map((s) => ({
      id: s.id,
      name: s.name,
      price: s.price.toFixed(2),
      durationMin: s.durationMin,
      isActive: s.isActive,
    })),
    packages: packages.map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price.toFixed(2),
      isActive: p.isActive,
    })),
    staff: staff.map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      email: actor.role === Role.OWNER ? u.email : null,
      phone: actor.role === Role.OWNER ? u.phone : null,
      isBookable: u.isBookable,
    })),
  };
}
