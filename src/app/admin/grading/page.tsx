import type { Metadata } from 'next';

import { GradingQueue } from '@/components/admin/grading-queue';

export const metadata: Metadata = {
  title: 'Marking',
  description: 'Mark descriptive and uploaded answers that the server cannot grade.',
};

export default function GradingPage() {
  return <GradingQueue />;
}
