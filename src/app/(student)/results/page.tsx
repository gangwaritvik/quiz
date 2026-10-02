import type { Metadata } from 'next';

import { StudentResultsList } from '@/components/student/student-results-list';

export const metadata: Metadata = {
  title: 'Results',
  description: 'Results your faculty has released.',
};

export default function ResultsPage() {
  return <StudentResultsList />;
}
