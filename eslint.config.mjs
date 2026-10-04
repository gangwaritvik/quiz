import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  { ignores: ['.next/**', 'node_modules/**', 'var/**', 'next-env.d.ts', 'public/sw.js'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
];

export default config;
