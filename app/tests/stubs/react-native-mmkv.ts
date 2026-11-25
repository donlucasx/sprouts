// Test stub: an in-memory MMKV (tests that mock @/lib/store keep doing so; this only backs modules that reach the real store).
export function createMMKV() {
  const kv = new Map<string, string | number | boolean>()
  return {
    getString: (k: string) => (typeof kv.get(k) === 'string' ? (kv.get(k) as string) : undefined),
    getBoolean: (k: string) => (typeof kv.get(k) === 'boolean' ? (kv.get(k) as boolean) : undefined),
    getNumber: (k: string) => (typeof kv.get(k) === 'number' ? (kv.get(k) as number) : undefined),
    set: (k: string, v: string | number | boolean) => void kv.set(k, v),
    remove: (k: string) => kv.delete(k),
    contains: (k: string) => kv.has(k),
    clearAll: () => kv.clear(),
  }
}
