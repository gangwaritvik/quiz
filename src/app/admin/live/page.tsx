import type { Metadata } from 'next';

import { LiveMonitoring } from '@/components/admin/live-monitoring';

export const metadata: Metadata = {
  title: 'Live Exams',
  description: 'Invigilate examinations currently in progress.',
};

export default function LiveExamsPage() {
  return <LiveMonitoring />;
}
