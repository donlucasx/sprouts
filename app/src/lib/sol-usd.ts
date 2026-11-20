import { useQuery } from '@tanstack/react-query'
import { fetchSolUsd } from './sign'

/**
 * Task 17b (user rent, design 6): the phone's own SOL price for the setup line's dollars (Jupiter's public price API, the same source the
 * top-up check bounds against; never the Sprouts API). Read only while a setup line can show; 60 s fresh. null = no usable price (the
 * line then shows the SOL amount).
 */
export function useSolUsd(enabled: boolean): number | null {
  const { data } = useQuery({ queryKey: ['sol-usd'], queryFn: () => fetchSolUsd(), enabled, staleTime: 60_000, retry: false })
  return typeof data === 'number' ? data : null
}
