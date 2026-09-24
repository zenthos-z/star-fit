export function lsGet<T = any>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

export function lsSet(key: string, value: any): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function lsRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {}
}

export function lsKeys(): string[] {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) keys.push(k);
    }
    return keys;
  } catch {
    return [];
  }
}

export function lsClear(): void {
  try {
    localStorage.clear();
  } catch {}
}

