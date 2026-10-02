import type { Metadata } from 'next';

import { AdminQuizDetail } from '@/components/admin/admin-quiz-detail';

export const metadata: Metadata = {
  title: 'Quiz detail',
};

export default async function AdminQuizDetailPage({
  params,
}: {
  params: Promise<{ quizId: string }>;
}) {
  const { quizId } = await params;
  return <AdminQuizDetail quizId={quizId} />;
}
