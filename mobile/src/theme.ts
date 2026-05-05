import { useColorScheme } from 'react-native'

export const dark = {
  bg: '#0f172a',
  surface: '#1e293b',
  surface2: '#334155',
  text: '#f1f5f9',
  textMuted: '#94a3b8',
  border: '#334155',
  accent: '#6366f1',
  green: '#22c55e',
  red: '#ef4444',
}

export const light = {
  bg: '#f8fafc',
  surface: '#ffffff',
  surface2: '#f1f5f9',
  text: '#0f172a',
  textMuted: '#64748b',
  border: '#e2e8f0',
  accent: '#6366f1',
  green: '#16a34a',
  red: '#dc2626',
}

export type Theme = typeof dark

export function useTheme(): Theme {
  const scheme = useColorScheme()
  return scheme === 'dark' ? dark : light
}
