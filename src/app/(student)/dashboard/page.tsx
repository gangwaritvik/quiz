import type { Metadata } from 'next';

import { StudentDashboard } from '@/components/student/student-dashboard';

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Your upcoming examinations, results and integrity status.',
};

export default function DashboardPage() {
  return <StudentDashboard />;
}
