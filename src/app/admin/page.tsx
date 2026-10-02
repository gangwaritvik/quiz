import type { Metadata } from 'next';

import { AdminOverview } from '@/components/admin/admin-overview';

export const metadata: Metadata = {
  title: 'Faculty Dashboard',
  description: 'Live examination activity, results and integrity at a glance.',
};

export default function AdminDashboardPage() {
  return <AdminOverview />;
}
