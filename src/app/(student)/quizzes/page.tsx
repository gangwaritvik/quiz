import type { Metadata } from 'next';

import { StudentQuizList } from '@/components/student/student-quiz-list';

export const metadata: Metadata = {
  title: 'My Quizzes',
  description: 'Every quiz assigned to you, past and present.',
};

export default function QuizzesPage() {
  return <StudentQuizList />;
}
