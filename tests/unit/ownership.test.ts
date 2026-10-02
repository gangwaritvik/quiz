import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ownAttemptWhere, ownQuizWhere } from '@/lib/ownership';

// The DB-asserting helpers (assertQuizOwner / assertAttemptOwner / assertAnswerOwner)
// need Prisma and are covered by the e2e suite, not here.

describe('ownership where-fragments', () => {
  test('quiz fragment scopes to the author', () => {
    assert.deepEqual(ownQuizWhere('admin_1'), { authorId: 'admin_1' });
  });
  test('attempt fragment scopes through the quiz author', () => {
    assert.deepEqual(ownAttemptWhere('admin_1'), { quiz: { authorId: 'admin_1' } });
  });
  test('fragments carry the exact id given and are fresh objects', () => {
    assert.notEqual(ownQuizWhere('a'), ownQuizWhere('a'));
    assert.equal(ownQuizWhere('b').authorId, 'b');
    assert.equal(ownAttemptWhere('b').quiz.authorId, 'b');
  });
});
