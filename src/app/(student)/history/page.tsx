import type { Metadata } from 'next';

import { StudentHistory } from '@/components/student/student-history';

export const metadata: Metadata = {
  title: 'Exam History',
  description: 'Every attempt you have made, with its integrity status.',
};

export default function HistoryPage() {
  return <StudentHistory />;
}
