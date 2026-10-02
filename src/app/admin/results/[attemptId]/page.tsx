import type { Metadata } from 'next';

import { FacultyAttemptReview } from '@/components/admin/faculty-attempt-review';

export const metadata: Metadata = {
  title: 'Student answers',
  description: 'Review a student submission question by question.',
};

export default async function FacultyAttemptReviewPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  return <FacultyAttemptReview attemptId={attemptId} />;
}
