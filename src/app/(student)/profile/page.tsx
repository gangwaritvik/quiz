import type { Metadata } from 'next';

import { StudentProfile } from '@/components/student/student-profile';

export const metadata: Metadata = {
  title: 'Profile',
  description: 'Your account details, signed-in devices and integrity status.',
};

export default function ProfilePage() {
  return <StudentProfile />;
}
