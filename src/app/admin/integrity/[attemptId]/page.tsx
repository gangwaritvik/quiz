import type { Metadata } from 'next';

import { IntegrityReportDetail } from '@/components/admin/integrity-report-detail';

export const metadata: Metadata = {
  title: 'Integrity report',
};

export default async function IntegrityReportPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  return <IntegrityReportDetail attemptId={attemptId} />;
}
