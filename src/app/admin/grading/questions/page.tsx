import type { Metadata } from 'next';

import { GradingByQuestion } from '@/components/admin/grading-by-question';

export const metadata: Metadata = {
  title: 'Mark by question',
  description: 'Mark one question across every student, one answer at a time.',
};

export default async function GradingByQuestionPage({
  searchParams,
}: {
  searchParams: Promise<{ quizId?: string | string[] }>;
}) {
  const { quizId } = await searchParams;
  return <GradingByQuestion initialQuizId={typeof quizId === 'string' ? quizId : undefined} />;
}
