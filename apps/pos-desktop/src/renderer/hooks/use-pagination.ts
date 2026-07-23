/**
 * usePagination — page + total state management for paginated lists.
 *
 * Reduces the pattern:
 *   const [page, setPage] = useState(1);
 *   const [total, setTotal] = useState(0);
 *
 * To one call with shared reset/goToFirst helpers.
 *
 * @category Hook
 */

import { useState, useCallback } from 'react';

export interface UsePaginationReturn {
  page: number;
  total: number;
  setPage: (page: number) => void;
  setTotal: (total: number) => void;
  goToFirst: () => void;
}

export function usePagination(initialPage = 1): UsePaginationReturn {
  const [page, setPage] = useState(initialPage);
  const [total, setTotal] = useState(0);

  const goToFirst = useCallback(() => {
    setPage(1);
  }, []);

  return { page, total, setPage, setTotal, goToFirst };
}
