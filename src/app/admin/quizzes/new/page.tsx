import type { Metadata } from 'next';

import { CreateQuizForm } from '@/components/admin/create-quiz-form';

export const metadata: Metadata = {
  title: 'Create quiz',
  description: 'Configure a new examination and its security policy.',
};

export default function CreateQuizPage() {
  return <CreateQuizForm />;
}
