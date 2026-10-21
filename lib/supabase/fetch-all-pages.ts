/**
 * Page through a PostgREST select so results are not cut at the default
 * 1,000-row cap. Callers must build a fresh query on every page — the
 * Supabase filter builder is single-use.
 */

export const POSTGREST_PAGE_SIZE = 1000;

export type PagedQueryError = {
  message: string;
  code?: string;
};

type PageResponse<T> = {
  data: T[] | null;
  error: PagedQueryError | null;
};

export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResponse<T>>,
  pageSize = POSTGREST_PAGE_SIZE,
): Promise<{ data: T[]; error: PagedQueryError | null }> {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    return { data: [], error: { message: "pageSize ต้องมากกว่า 0" } };
  }

  const rows: T[] = [];
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) {
      return {
        data: [],
        error: { message: error.message, code: error.code },
      };
    }

    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) {
      return { data: rows, error: null };
    }
    from += pageSize;
  }
}
