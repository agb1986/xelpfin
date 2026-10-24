/**
 * Whether a paged list should fetch its next page now: once the furthest visible item is past
 * the middle of the last loaded page, and there is more on the server. Starting at the halfway
 * mark leaves time to fetch the page and prefetch its images before the user scrolls there.
 */
export function nextPageDue(
  lastVisibleIndex: number,
  loaded: number,
  total: number,
  pageSize: number,
): boolean {
  if (loaded >= total || loaded === 0) {
    return false;
  }
  const lastPageStart = Math.max(0, loaded - pageSize);
  const halfway = lastPageStart + Math.floor((loaded - lastPageStart) / 2);
  return lastVisibleIndex >= halfway;
}
