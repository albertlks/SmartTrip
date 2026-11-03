// Browser storage can be blocked (private windows, strict settings), so every access is guarded.

export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not saved; the app works the same, it just won't remember.
  }
}

export const HOME_AIRPORT_KEY = "homeAirport";
