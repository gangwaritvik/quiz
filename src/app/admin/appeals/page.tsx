import type { Metadata } from 'next';

import { AdminAppeals } from '@/components/admin/admin-appeals';

export const metadata: Metadata = {
  title: 'Appeals',
  description: 'Answer students who ask for a released result to be re-checked.',
};

export default function AppealsPage() {
  return <AdminAppeals />;
}
