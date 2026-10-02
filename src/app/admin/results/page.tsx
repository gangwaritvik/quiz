import type { Metadata } from 'next';

import { AdminResults } from '@/components/admin/admin-results';

export const metadata: Metadata = {
  title: 'Results',
  description: 'Graded attempts and per-quiz performance.',
};

export default function AdminResultsPage() {
  return <AdminResults />;
}
