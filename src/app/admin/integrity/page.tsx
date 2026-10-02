import type { Metadata } from 'next';

import { IntegrityReports } from '@/components/admin/integrity-reports';

export const metadata: Metadata = {
  title: 'Integrity Reports',
  description: 'Attempts ranked by how much they warrant a human look.',
};

export default function IntegrityReportsPage() {
  return <IntegrityReports />;
}
