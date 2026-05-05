import AsyncStorage from '@react-native-async-storage/async-storage'

const ADJECTIVES = [
  'Cool', 'Happy', 'Swift', 'Brave', 'Bright', 'Calm', 'Clever', 'Cozy',
  'Daring', 'Eager', 'Fancy', 'Gentle', 'Jolly', 'Lucky', 'Mighty', 'Noble',
  'Quick', 'Shiny', 'Silly', 'Tidy', 'Witty', 'Zesty'
]

const NOUNS = [
  'Apple', 'Bear', 'Cloud', 'Dove', 'Eagle', 'Fox', 'Gecko', 'Hawk',
  'Ibis', 'Jade', 'Koala', 'Lynx', 'Mango', 'Orca', 'Panda', 'Quail',
  'Raven', 'Seal', 'Tiger', 'Udon', 'Viper', 'Wolf'
]

function generateAlias(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  return `${adj} ${noun}`
}

const STORAGE_KEY = '@localsend/alias'

export async function getOrCreateAlias(): Promise<string> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY)
  if (stored) return stored
  const alias = generateAlias()
  await AsyncStorage.setItem(STORAGE_KEY, alias)
  return alias
}

export async function setAlias(alias: string): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, alias)
}
