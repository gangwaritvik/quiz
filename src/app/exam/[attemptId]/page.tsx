import type { Metadata } from 'next';

import { ExamClient } from '@/components/exam/exam-client';

export const metadata: Metadata = {
  title: 'Examination in progress',
  robots: { index: false, follow: false },
};

export default async function ExamPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  return <ExamClient attemptId={attemptId} />;
}
