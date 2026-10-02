import type { Metadata } from 'next';

import { GradingDetail } from '@/components/admin/grading-detail';

export const metadata: Metadata = {
  title: 'Mark attempt',
};

export default async function GradingDetailPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  return <GradingDetail attemptId={attemptId} />;
}
