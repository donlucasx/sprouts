import { api, type ActivityResponse } from './api'

/**
 * Activity's query, shared by the tab and Home's prefetch (perf 10-08: the list is warm before the tab opens). Within a minute of the
 * last read a tab switch shows the cached list without a new read; after that it still shows the cached list at once and refreshes.
 */
export const ACTIVITY_STALE_MS = 60_000
export const activityQuery = {
  queryKey: ['activity'] as const,
  queryFn: () => api<ActivityResponse>('/api/activity'),
  staleTime: ACTIVITY_STALE_MS,
}
