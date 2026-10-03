// A tiny in-memory Storage for tests: the same API as window.localStorage,
// with nothing shared between instances, so a test can hand a data source
// its own storage and inspect what was written.

export class MemoryStorage implements Storage {
  private map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  /** Every stored key, for assertions. */
  keys(): string[] {
    return [...this.map.keys()];
  }
}

/**
 * A storage whose writes fail the way a full device does: setItem throws the
 * browser's quota error (DOMException "QuotaExceededError", legacy code 22).
 */
export class FullStorage extends MemoryStorage {
  override setItem(_key: string, _value: string): void {
    throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
  }
}
