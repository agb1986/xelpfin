/** How many requests the app sends to the server at once when it works through a list. */
export const SERVER_CONCURRENCY = 6;

/**
 * Runs `fn` over `items` with at most `limit` calls in flight and resolves to the results in the
 * order of `items`. A rejection rejects the whole call, as with Promise.all.
 */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return out;
}
