import type { FMContext } from '@/context/types';
import type { StepCatalogEntry } from '@/converter/catalog-types';

const BASE = '';

export async function fetchContext(): Promise<FMContext> {
  const res = await fetch(`${BASE}/api/context`);
  if (!res.ok) throw new Error(`Failed to fetch context: ${res.status}`);
  return res.json();
}

export async function fetchIndex(name: string, solution?: string): Promise<string[][]> {
  const qs = solution ? `?solution=${encodeURIComponent(solution)}` : '';
  const res = await fetch(`${BASE}/api/index/${encodeURIComponent(name)}${qs}`);
  if (!res.ok) throw new Error(`Failed to fetch index: ${name}`);
  return res.json();
}

export async function fetchSteps(): Promise<StepInfo[]> {
  const res = await fetch(`${BASE}/api/steps`);
  if (!res.ok) throw new Error('Failed to fetch steps');
  return res.json();
}

export async function fetchStepCatalog(): Promise<StepCatalogEntry[]> {
  const res = await fetch(`${BASE}/api/step-catalog`);
  if (!res.ok) throw new Error('Failed to fetch step catalog');
  return res.json();
}

export interface DocsResult {
  conventions: string;
  knowledge: string;
}

export async function fetchDocs(): Promise<DocsResult> {
  const res = await fetch(`${BASE}/api/docs`);
  if (!res.ok) throw new Error('Failed to fetch docs');
  return res.json();
}

export async function fetchSnippet(category: string, step: string): Promise<string> {
  const res = await fetch(`${BASE}/api/snippet/${encodeURIComponent(category)}/${encodeURIComponent(step)}`);
  if (!res.ok) throw new Error(`Failed to fetch snippet: ${category}/${step}`);
  return res.text();
}

export async function validateSnippet(xml: string): Promise<ValidationResult> {
  const res = await fetch(`${BASE}/api/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: xml,
  });
  return res.json();
}

export async function clipboardWrite(xml: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${BASE}/api/clipboard/write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: xml,
  });
  return res.json();
}

export async function clipboardRead(): Promise<{ xml: string }> {
  const res = await fetch(`${BASE}/api/clipboard/read`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to read clipboard');
  return res.json();
}

export async function listSandbox(): Promise<string[]> {
  const res = await fetch(`${BASE}/api/sandbox`);
  if (!res.ok) throw new Error('Failed to list sandbox');
  return res.json();
}

export async function readSandbox(filename: string): Promise<string> {
  const res = await fetch(`${BASE}/api/sandbox/${encodeURIComponent(filename)}`);
  if (!res.ok) throw new Error(`Failed to read sandbox file: ${filename}`);
  return res.text();
}

export async function writeSandbox(filename: string, content: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/api/sandbox/${encodeURIComponent(filename)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: content,
  });
  return res.json();
}

// --- Script search & load ---

export interface ScriptSearchResult {
  name: string;
  id: number;
  folder: string;
}

export interface ScriptLoadResult {
  hr?: string;
  xml?: string;
  name?: string;
}

export async function searchScripts(query: string): Promise<ScriptSearchResult[]> {
  const res = await fetch(`${BASE}/api/scripts/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error('Failed to search scripts');
  return res.json();
}

export async function loadScript(id: number, name: string): Promise<ScriptLoadResult> {
  const res = await fetch(
    `${BASE}/api/scripts/load?id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`,
  );
  if (!res.ok) throw new Error('Failed to load script');
  return res.json();
}

// --- AI Settings (server-side .env.local) ---

export interface AISettingsResponse {
  provider: string;
  model: string;
  configuredProviders: string[];
  promptMarker: string;
}

export async function fetchSettings(): Promise<AISettingsResponse> {
  const res = await fetch(`${BASE}/api/settings`);
  if (!res.ok) throw new Error('Failed to fetch settings');
  return res.json();
}

export async function saveSettings(update: {
  provider?: string;
  model?: string;
  apiKey?: string;
  apiKeyProvider?: string;
  promptMarker?: string;
}): Promise<AISettingsResponse> {
  const res = await fetch(`${BASE}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  });
  if (!res.ok) throw new Error('Failed to save settings');
  return res.json();
}

// --- AI Chat (server-side proxy) ---

export interface ChatStreamEvent {
  type: 'text' | 'done' | 'error';
  text?: string;
  error?: string;
}

export async function streamChat(
  messages: { role: string; content: string }[],
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    onEvent({ type: 'error', error: err.error ?? `HTTP ${res.status}` });
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    onEvent({ type: 'error', error: 'No response body' });
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6)) as ChatStreamEvent;
            onEvent(event);
          } catch (e) {
            console.warn('[ai-chat] malformed SSE event:', line.slice(0, 200), e);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export interface StepInfo {
  name: string;
  category: string;
  file: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
