/** localStorage-backed settings with graceful fallback (private mode, quota). */
export function persisted<T>(key: string, fallback: T): { load(): T; save(v: T): void } {
  return {
    load() {
      try {
        const raw = localStorage.getItem(key);
        return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
      } catch {
        return fallback;
      }
    },
    save(v: T) {
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        /* storage unavailable (private mode) — non-fatal */
      }
    }
  };
}
