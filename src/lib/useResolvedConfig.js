import { useMemo } from 'react'
import { normalizePublicConfig } from './publicConfigSchema'

export function useResolvedConfig(config) {
  return useMemo(() => {
    const input = config && typeof config === 'object' ? config : {}
    return normalizePublicConfig(input)
  }, [config])
}
