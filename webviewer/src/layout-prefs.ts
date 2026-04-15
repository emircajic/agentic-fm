/**
 * Layout preference persistence.
 *
 * Primary: localStorage (sync, survives webviewer reloads)
 * Fallback: server-side file via /api/layout-prefs (survives localStorage wipes)
 */

const LS_KEY = 'fm-layout-prefs';
const SERVER_DEBOUNCE_MS = 500;

export interface LayoutPrefs {
  showXmlPreview: boolean;
  showChat: boolean;
  showLibrary: boolean;
  showIconBrowser: boolean;
  editorPct: number;     // editor column vs chat panel horizontal split (%)
  editorXmlPct: number; // editor vs xml preview vertical split (%)
  libraryWidth: number;  // library panel width (px)
}

export const DEFAULT_PREFS: LayoutPrefs = {
  showXmlPreview: false,
  showChat: false,
  showLibrary: false,
  showIconBrowser: false,
  editorPct: 50,
  editorXmlPct: 60,
  libraryWidth: 224, // equivalent to Tailwind w-56
};

let debounceTimer: ReturnType<typeof setTimeout> | undefined;

/** Load from localStorage synchronously — safe to call during component init */
export function loadLayoutPrefsSync(): LayoutPrefs {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch { /* corrupted */ }
  return { ...DEFAULT_PREFS };
}

/** Save to localStorage immediately; persist to server with debounce */
export function saveLayoutPrefs(prefs: LayoutPrefs): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(prefs));
  } catch (e) {
    console.warn('[layout-prefs] localStorage write failed:', e);
  }

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    fetch('/api/layout-prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prefs),
    }).catch((e) => console.warn('[layout-prefs] server save failed:', e));
  }, SERVER_DEBOUNCE_MS);
}

/** Load from server — async fallback used when localStorage has no saved prefs */
export async function loadLayoutPrefsFromServer(): Promise<LayoutPrefs | null> {
  try {
    const res = await fetch('/api/layout-prefs');
    if (!res.ok) return null;
    const parsed = await res.json();
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return null;
  }
}

/** True if localStorage currently holds saved prefs */
export function hasLocalPrefs(): boolean {
  try {
    return !!localStorage.getItem(LS_KEY);
  } catch {
    return false;
  }
}
