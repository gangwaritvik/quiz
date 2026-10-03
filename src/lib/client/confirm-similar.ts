import { ApiClientError } from '@/lib/client/api';

/**
 * Runs a save that the server refuses when the bank already has a question of
 * the same meaning. The refusal names that question; the teacher decides
 * whether to go ahead. Resolves false when they decline.
 */
export async function sendUnlessRepeat(send: (allowSimilar: boolean) => Promise<unknown>): Promise<boolean> {
  try {
    await send(false);
  } catch (caught) {
    if (!(caught instanceof ApiClientError) || !caught.details?.similar) throw caught;
    if (!window.confirm(`${caught.message}\n\nAdd it to the bank anyway?`)) return false;
    await send(true);
  }
  return true;
}
