import type { Metadata } from 'next';

import { QuizInstructions } from '@/components/student/quiz-instructions';

export const metadata: Metadata = {
  title: 'Before you begin',
  description: 'Examination rules and security checks.',
};

export default async function QuizInstructionsPage({
  params,
}: {
  params: Promise<{ quizId: string }>;
}) {
  const { quizId } = await params;
  return <QuizInstructions quizId={quizId} />;
}
