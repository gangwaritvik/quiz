import type { Metadata } from 'next';

import { StudentResultDetail } from '@/components/student/student-result-detail';

export const metadata: Metadata = {
  title: 'Result',
};

export default async function ResultDetailPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  return <StudentResultDetail attemptId={attemptId} />;
}
