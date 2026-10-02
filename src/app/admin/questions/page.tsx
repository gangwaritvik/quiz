import type { Metadata } from 'next';

import { QuestionBank } from '@/components/admin/question-bank';

export const metadata: Metadata = {
  title: 'Question Bank',
  description: 'Author, filter and import the questions your quizzes draw from.',
};

export default function QuestionBankPage() {
  return <QuestionBank />;
}
