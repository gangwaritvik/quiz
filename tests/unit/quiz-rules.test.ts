import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { MAX_HIGHLIGHTS, type RuleSettings, buildExamRules } from '@/lib/quiz-rules';

const off: RuleSettings = {
  requireFullscreen: false,
  detectTabSwitch: false,
  blockCopyPaste: false,
  cameraMonitoring: false,
  microphoneMonitoring: false,
  maxFullscreenExits: 3,
};

const keys = (rules: { key: string }[]) => rules.map((rule) => rule.key);

describe('buildExamRules', () => {
  test('a quiz with nothing switched on has no highlights but keeps every standard rule', () => {
    const { highlights, all } = buildExamRules(off);
    assert.deepEqual(highlights, []);
    assert.deepEqual(keys(all), [
      'window',
      'tabs',
      'clipboard',
      'confidentiality',
      'connection',
      'battery',
    ]);
  });

  test('highlights lead with quiz-specific rules, then tab and clipboard rules', () => {
    const { highlights } = buildExamRules({
      ...off,
      requireFullscreen: true,
      cameraMonitoring: true,
      detectTabSwitch: true,
      blockCopyPaste: true,
    });
    assert.deepEqual(keys(highlights), ['fullscreen', 'camera', 'tabs', 'clipboard']);
  });

  test('tab and clipboard rules are highlighted only when the quiz enforces them', () => {
    assert.deepEqual(keys(buildExamRules({ ...off, detectTabSwitch: true }).highlights), ['tabs']);
    assert.deepEqual(keys(buildExamRules({ ...off, blockCopyPaste: true }).highlights), [
      'clipboard',
    ]);
  });

  test('highlights are capped, keeping the most specific rules', () => {
    const { highlights, all } = buildExamRules({
      requireFullscreen: true,
      detectTabSwitch: true,
      blockCopyPaste: true,
      cameraMonitoring: true,
      microphoneMonitoring: true,
      blockMultipleDisplays: true,
      requireScreenShare: true,
      maxFullscreenExits: 3,
    });
    assert.equal(highlights.length, MAX_HIGHLIGHTS);
    assert.deepEqual(keys(highlights), [
      'fullscreen',
      'camera',
      'microphone',
      'screenShare',
      'singleDisplay',
    ]);
    // Nothing is dropped from the full list.
    assert.equal(all.length, 6 + 5);
  });

  test('the fullscreen rule states the exit allowance only when there is one', () => {
    const withExits = buildExamRules({ ...off, requireFullscreen: true, maxFullscreenExits: 2 });
    assert.match(withExits.highlights[0].text, /2 or more exits/);
    const noExits = buildExamRules({ ...off, requireFullscreen: true, maxFullscreenExits: 0 });
    assert.equal(noExits.highlights[0].text, 'Fullscreen is required for this exam');
  });

  test('the full list is the standard rules followed by the quiz-specific ones, without duplicates', () => {
    const { all } = buildExamRules({
      ...off,
      requireFullscreen: true,
      detectTabSwitch: true,
      blockCopyPaste: true,
    });
    assert.equal(new Set(keys(all)).size, all.length);
    assert.equal(all.at(-1)?.key, 'fullscreen');
  });
});
