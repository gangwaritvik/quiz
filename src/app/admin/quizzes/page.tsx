import type { Metadata } from 'next';

import { AdminQuizList } from '@/components/admin/admin-quiz-list';

export const metadata: Metadata = {
  title: 'Quizzes',
  description: 'Create, publish and manage examinations.',
};

export default function AdminQuizzesPage() {
  return <AdminQuizList />;
}
