export interface Clock {
  now(): Date;
}

class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class FakeClock implements Clock {
  private currentMs: number;

  constructor(initial: Date | string | number = '2026-11-15T06:00:00.000Z') {
    this.currentMs = FakeClock.toEpochMs(initial);
  }

  private static toEpochMs(value: Date | string | number): number {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new Error('Invalid timestamp number for FakeClock');
      }
      return value;
    }
    const parsed = typeof value === 'string' ? Date.parse(value) : value.getTime();
    if (Number.isNaN(parsed)) {
      throw new Error(`Invalid date value for FakeClock: ${String(value)}`);
    }
    return parsed;
  }

  now(): Date {
    return new Date(this.currentMs);
  }

  set(instant: Date | string | number): void {
    this.currentMs = FakeClock.toEpochMs(instant);
  }

  advanceMs(ms: number): void {
    this.currentMs += ms;
  }

  advanceSeconds(seconds: number): void {
    this.currentMs += seconds * 1_000;
  }

  advanceMinutes(minutes: number): void {
    this.currentMs += minutes * 60_000;
  }

  advanceHours(hours: number): void {
    this.currentMs += hours * 3_600_000;
  }

  advanceDays(days: number): void {
    this.currentMs += days * 86_400_000;
  }
}

const systemClock = new SystemClock();
let activeClock: Clock = systemClock;

export function now(): Date {
  return activeClock.now();
}

export function setClock(clock: Clock): void {
  activeClock = clock;
}

export function resetClock(): void {
  activeClock = systemClock;
}

export function useFakeClock(initial?: Date | string | number): FakeClock {
  const fake = new FakeClock(initial);
  setClock(fake);
  return fake;
}
