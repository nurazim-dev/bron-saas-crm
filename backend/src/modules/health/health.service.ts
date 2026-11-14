export interface HealthStatus {
  status: 'ok';
  uptimeSec: number;
  timestamp: string;
}

export function getHealth(): HealthStatus {
  return {
    status: 'ok',
    uptimeSec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}
