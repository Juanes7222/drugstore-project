/**
 * Shared helpers for export-definition loaders.
 */

/** Page-based fetch loop — collects every page until the dataset is read. */
export async function collectPages<T>(
  fetchPage: (
    page: number,
    pageSize: number,
  ) => Promise<{ data: T[]; total: number }>,
  pageSize = 500,
): Promise<T[]> {
  const all: T[] = [];
  let page = 1;

  for (;;) {
    const result = await fetchPage(page, pageSize);
    all.push(...result.data);
    if (all.length >= result.total || result.data.length === 0) {
      return all;
    }
    page += 1;
  }
}

/** Offset-based fetch loop — collects every page until the dataset is read. */
export async function collectOffset<T>(
  fetchPage: (
    offset: number,
    limit: number,
  ) => Promise<{ items: T[]; total: number }>,
  limit = 500,
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;

  for (;;) {
    const result = await fetchPage(offset, limit);
    all.push(...result.items);
    if (all.length >= result.total || result.items.length === 0) {
      return all;
    }
    offset += limit;
  }
}