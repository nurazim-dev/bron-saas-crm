import type { ReactNode } from 'react';
import { AuthBootstrap, DashboardGuard } from '@/components/layout/auth-bootstrap';
import { DashboardShell } from '@/components/layout/dashboard-shell';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <AuthBootstrap>
      <DashboardGuard>
        <DashboardShell>{children}</DashboardShell>
      </DashboardGuard>
    </AuthBootstrap>
  );
}
