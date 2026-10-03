import type { Metadata } from 'next';

import { AiDraftReview } from '@/components/admin/ai-draft-review';

export const metadata: Metadata = {
  title: 'AI drafts',
  description: 'Review questions the AI drafted from your study material.',
};

export default async function AiDraftsPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return <AiDraftReview jobId={jobId} />;
}
