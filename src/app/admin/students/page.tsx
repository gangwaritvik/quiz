import type { Metadata } from 'next';

import { StudentManagement } from '@/components/admin/student-management';

export const metadata: Metadata = {
  title: 'Students',
  description: 'Manage the roster, sections and device registrations.',
};

export default function AdminStudentsPage() {
  return <StudentManagement />;
}
