import type { Plugin, ViteDevServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { spawnPython } from './python';
import { setupFileWatcher } from './file-watcher';
import { setupWebSocket } from './ws';
import { getSettings, updateSettings } from './settings';
import { streamChat } from './ai-proxy';

/** Resolve the agent directory (sibling to webviewer/) */
function agentDir(): string {
  // process.cwd() = webviewer/, agent/ is sibling
  return path.resolve(process.cwd(), '..', 'agent');
}

/**
 * Resolve the main repo's agent directory.
 * In a git worktree, gitignored dirs (context/, xml_parsed/) only exist
 * at the main repo root, not in the worktree. This follows the .git
 * worktree link to find the original repo.
 */
function mainAgentDir(): string {
  const repoRoot = path.resolve(process.cwd(), '..');
  const dotGit = path.join(repoRoot, '.git');
  try {
    const stat = fs.statSync(dotGit);
    if (stat.isFile()) {
      // Worktree: .git is a file containing "gitdir: <path>"
      const content = fs.readFileSync(dotGit, 'utf-8').trim();
      const match = content.match(/^gitdir:\s*(.+)$/);
      if (match) {
        // gitdir points to e.g. /repo/.git/worktrees/<name>
        // Main repo .git is two levels up from that
        const mainGitDir = path.resolve(match[1], '..', '..');
        const mainRoot = path.dirname(mainGitDir);
        const mainAgent = path.join(mainRoot, 'agent');
        if (fs.existsSync(mainAgent)) return mainAgent;
      }
    }
  } catch { /* not a worktree or .git missing */ }
  // Fallback to local agent dir
  return path.resolve(repoRoot, 'agent');
}

/**
 * Resolve the context directory for a given solution.
 * Accepts an optional solution name; when omitted, auto-detects if only one
 * solution subfolder exists under agent/context/.
 */
function resolveContextDir(agentDir: string, solution?: string): string {
  const contextBase = path.join(agentDir, 'context');
  if (solution) {
    return path.join(contextBase, solution);
  }
  // Auto-detect: if only one solution subfolder, use it
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(contextBase, { withFileTypes: true })
      .filter(e => e.isDirectory());
  } catch { /* context dir doesn't exist yet */ }
  if (entries.length === 1) return path.join(contextBase, entries[0].name);
  if (entries.length === 0) throw new Error('agent/context/ is empty — run fmcontext.sh first');
  throw new Error('Multiple solutions in agent/context/ — specify ?solution= query param');
}

export function apiMiddleware(): Plugin {
  return {
    name: 'fm-api-middleware',
    configureServer(server: ViteDevServer) {
      const agent = agentDir();

      // WebSocket for file watcher
      setupWebSocket(server);
      setupFileWatcher(server, path.join(agent, 'CONTEXT.json'));

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const pathname = url.pathname;

        // --- GET /api/context ---
        if (req.method === 'GET' && pathname === '/api/context') {
          const contextPath = path.join(agent, 'CONTEXT.json');
          try {
            const data = fs.readFileSync(contextPath, 'utf-8');
            res.setHeader('Content-Type', 'application/json');
            res.end(data);
          } catch {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'CONTEXT.json not found' }));
          }
          return;
        }

        // --- GET /api/settings ---
        if (req.method === 'GET' && pathname === '/api/settings') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(getSettings()));
          return;
        }

        // --- POST /api/settings ---
        if (req.method === 'POST' && pathname === '/api/settings') {
          const body = JSON.parse(await readBody(req));
          const updated = updateSettings(body);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(updated));
          return;
        }

        // --- POST /api/chat ---
        if (req.method === 'POST' && pathname === '/api/chat') {
          const raw = await readBody(req);
          const body = JSON.parse(raw);
          const roles = (body.messages ?? []).map((m: { role: string }) => m.role);
          console.log(`[ai-chat] POST /api/chat — ${roles.length} messages [${roles.join(', ')}]`);
          await streamChat(body, res);
          return;
        }

        // --- GET /api/docs ---
        if (req.method === 'GET' && pathname === '/api/docs') {
          const conventionsPath = path.join(agent, 'docs', 'CODING_CONVENTIONS.md');
          const knowledgeDir = path.join(agent, 'docs', 'knowledge');
          let conventions = '';
          let knowledge = '';
          try {
            conventions = fs.readFileSync(conventionsPath, 'utf-8');
          } catch { /* not found */ }
          try {
            const files = fs.readdirSync(knowledgeDir)
              .filter(f => f.endsWith('.md') && f !== 'MANIFEST.md')
              .sort();
            knowledge = files
              .map(f => {
                const content = fs.readFileSync(path.join(knowledgeDir, f), 'utf-8');
                return `## ${f.replace('.md', '')}\n\n${content}`;
              })
              .join('\n\n---\n\n');
          } catch { /* not found */ }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ conventions, knowledge }));
          return;
        }

        // --- GET /api/index/:name ---
        const indexMatch = pathname.match(/^\/api\/index\/(.+)$/);
        if (req.method === 'GET' && indexMatch) {
          const name = decodeURIComponent(indexMatch[1]);
          const solution = url.searchParams.get('solution') ?? undefined;
          try {
            const main = mainAgentDir();
            const contextDir = resolveContextDir(main, solution);
            const indexPath = path.join(contextDir, `${name}.index`);
            const data = fs.readFileSync(indexPath, 'utf-8');
            const rows = parseIndex(data);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(rows));
          } catch {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: `Index ${name} not found` }));
          }
          return;
        }

        // --- GET /api/step-catalog ---
        if (req.method === 'GET' && pathname === '/api/step-catalog') {
          const catalogPath = path.join(agent, 'catalogs', 'step-catalog-en.json');
          try {
            const data = fs.readFileSync(catalogPath, 'utf-8');
            res.setHeader('Content-Type', 'application/json');
            res.end(data);
          } catch {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'step-catalog-en.json not found' }));
          }
          return;
        }

        // --- GET /api/steps ---
        if (req.method === 'GET' && pathname === '/api/steps') {
          const stepsDir = path.join(agent, 'snippet_examples', 'steps');
          try {
            const steps = enumerateSteps(stepsDir);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(steps));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(err) }));
          }
          return;
        }

        // --- GET /api/snippet/:category/:step ---
        const snippetMatch = pathname.match(/^\/api\/snippet\/(.+?)\/(.+)$/);
        if (req.method === 'GET' && snippetMatch) {
          const category = decodeURIComponent(snippetMatch[1]);
          const step = decodeURIComponent(snippetMatch[2]);
          const snippetPath = path.join(agent, 'snippet_examples', 'steps', category, `${step}.xml`);
          try {
            const data = fs.readFileSync(snippetPath, 'utf-8');
            res.setHeader('Content-Type', 'application/xml');
            res.end(data);
          } catch {
            res.statusCode = 404;
            res.end(`Snippet not found: ${category}/${step}`);
          }
          return;
        }

        // --- POST /api/validate ---
        if (req.method === 'POST' && pathname === '/api/validate') {
          const body = await readBody(req);
          try {
            const result = await validateSnippet(agent, body);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(result));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ valid: false, errors: [String(err)], warnings: [] }));
          }
          return;
        }

        // --- POST /api/clipboard/write ---
        if (req.method === 'POST' && pathname === '/api/clipboard/write') {
          const body = await readBody(req);
          try {
            await clipboardWrite(agent, body);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: String(err) }));
          }
          return;
        }

        // --- POST /api/clipboard/read ---
        if (req.method === 'POST' && pathname === '/api/clipboard/read') {
          try {
            const xml = await clipboardRead(agent);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ xml }));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(err) }));
          }
          return;
        }

        // --- POST /api/convert/hr-to-xml ---
        // Note: Conversion is done client-side in the browser.
        // This endpoint exists for headless/API usage.
        if (req.method === 'POST' && pathname === '/api/convert/hr-to-xml') {
          const body = await readBody(req);
          // Return the body as-is — actual conversion happens client-side
          // Server-side conversion would require bundling the converter
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ info: 'Use client-side converter', input: body }));
          return;
        }

        // --- POST /api/convert/xml-to-hr ---
        if (req.method === 'POST' && pathname === '/api/convert/xml-to-hr') {
          const body = await readBody(req);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ info: 'Use client-side converter', input: body }));
          return;
        }

        // --- GET /api/scripts/search?q=<query> ---
        if (req.method === 'GET' && pathname === '/api/scripts/search') {
          const query = (url.searchParams.get('q') ?? '').trim();
          if (!query) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify([]));
            return;
          }
          try {
            const results = searchScripts(agent, query);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(results));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(err) }));
          }
          return;
        }

        // --- GET /api/scripts/load?id=<id>&name=<name> ---
        if (req.method === 'GET' && pathname === '/api/scripts/load') {
          const id = url.searchParams.get('id') ?? '';
          const name = url.searchParams.get('name') ?? '';
          if (!id) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'id parameter required' }));
            return;
          }
          try {
            const result = await loadScript(agent, id, name);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(result));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(err) }));
          }
          return;
        }

        // --- GET/POST/DELETE /api/autosave ---
        if (pathname === '/api/autosave') {
          const autosavePath = path.join(agent, 'sandbox', '.autosave.json');

          if (req.method === 'GET') {
            try {
              const data = fs.readFileSync(autosavePath, 'utf-8');
              res.setHeader('Content-Type', 'application/json');
              res.end(data);
            } catch {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: 'No autosave found' }));
            }
            return;
          }

          if (req.method === 'POST') {
            const body = await readBody(req);
            fs.mkdirSync(path.dirname(autosavePath), { recursive: true });
            fs.writeFileSync(autosavePath, body, 'utf-8');
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          if (req.method === 'DELETE') {
            try { fs.unlinkSync(autosavePath); } catch { /* ignore */ }
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
            return;
          }
        }

        // --- GET /api/sandbox ---
        if (req.method === 'GET' && pathname === '/api/sandbox') {
          const sandboxDir = path.join(agent, 'sandbox');
          try {
            const files = fs.readdirSync(sandboxDir).filter(f => f.endsWith('.xml'));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(files));
          } catch {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify([]));
          }
          return;
        }

        // --- GET/POST /api/sandbox/:filename ---
        const sandboxMatch = pathname.match(/^\/api\/sandbox\/(.+)$/);
        if (sandboxMatch) {
          const filename = decodeURIComponent(sandboxMatch[1]);
          // Prevent path traversal
          if (filename.includes('..') || filename.includes('/')) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Invalid filename' }));
            return;
          }
          const filePath = path.join(agent, 'sandbox', filename);

          if (req.method === 'GET') {
            try {
              const data = fs.readFileSync(filePath, 'utf-8');
              res.setHeader('Content-Type', 'application/xml');
              res.end(data);
            } catch {
              res.statusCode = 404;
              res.end('File not found');
            }
            return;
          }

          if (req.method === 'POST') {
            const body = await readBody(req);
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, body, 'utf-8');
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
            return;
          }
        }

        next();
      });
    },
  };
}

/** Parse pipe-delimited index file into arrays, skipping comment/empty lines */
function parseIndex(data: string): string[][] {
  return data
    .split('\n')
    .filter(line => line.trim() && !line.startsWith('#'))
    .map(line => line.split('|').map(col => col.trim()));
}

/** Enumerate all step XML files from snippet_examples/steps/ */
function enumerateSteps(stepsDir: string): { name: string; category: string; file: string }[] {
  const steps: { name: string; category: string; file: string }[] = [];
  if (!fs.existsSync(stepsDir)) return steps;

  for (const category of fs.readdirSync(stepsDir)) {
    const catPath = path.join(stepsDir, category);
    if (!fs.statSync(catPath).isDirectory()) continue;

    for (const file of fs.readdirSync(catPath)) {
      if (!file.endsWith('.xml')) continue;
      steps.push({
        name: file.replace('.xml', ''),
        category,
        file: `${category}/${file}`,
      });
    }
  }

  return steps.sort((a, b) => a.name.localeCompare(b.name));
}

/** Read request body as string */
function readBody(req: import('http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

/** Write XML to a temp file, run validate_snippet.py, parse results */
async function validateSnippet(
  agent: string,
  xml: string,
): Promise<{ valid: boolean; errors: string[]; warnings: string[] }> {
  const tmpFile = path.join(agent, 'sandbox', '.validate_tmp.xml');
  fs.writeFileSync(tmpFile, xml, 'utf-8');
  try {
    const { stdout, stderr, exitCode } = await spawnPython(agent, [
      path.join(agent, 'scripts', 'validate_snippet.py'),
      tmpFile,
    ]);

    if (exitCode === 0) {
      return { valid: true, errors: [], warnings: parseValidationOutput(stdout) };
    }
    const output = (stdout + '\n' + stderr).trim();
    return {
      valid: false,
      errors: output ? output.split('\n') : ['Validation failed'],
      warnings: [],
    };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

function parseValidationOutput(output: string): string[] {
  return output
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && l.toLowerCase().includes('warning'));
}

/** Write XML to temp file, call clipboard.py write */
async function clipboardWrite(agent: string, xml: string): Promise<void> {
  const tmpFile = path.join(agent, 'sandbox', '.clipboard_tmp.xml');
  fs.writeFileSync(tmpFile, xml, 'utf-8');
  try {
    const { exitCode, stderr } = await spawnPython(agent, [
      path.join(agent, 'scripts', 'clipboard.py'),
      'write',
      tmpFile,
    ]);
    if (exitCode !== 0) {
      throw new Error(stderr || 'clipboard.py write failed');
    }
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

/** Search scripts.index for matching scripts */
function searchScripts(
  _agent: string,
  query: string,
): { name: string; id: number; folder: string }[] {
  const main = mainAgentDir();
  const indexPath = path.join(resolveContextDir(main), 'scripts.index');
  const data = fs.readFileSync(indexPath, 'utf-8');
  const rows = parseIndex(data); // each row: [ScriptName, ScriptID, FolderPath]

  const isNumeric = /^\d+$/.test(query);

  if (isNumeric) {
    // Exact ID match
    const matches = rows.filter(r => r[1] === query);
    return matches.map(r => ({ name: r[0], id: Number(r[1]), folder: r[2] ?? '' }));
  }

  const qLower = query.toLowerCase();
  const tokens = qLower.split(/\s+/);

  // Exact name match (case-insensitive)
  const exact = rows.filter(r => r[0].toLowerCase() === qLower);
  if (exact.length > 0) {
    return exact.slice(0, 20).map(r => ({ name: r[0], id: Number(r[1]), folder: r[2] ?? '' }));
  }

  // Contains match: all query tokens present in name
  const contains = rows.filter(r => {
    const nameLower = r[0].toLowerCase();
    return tokens.every(t => nameLower.includes(t));
  });

  return contains.slice(0, 20).map(r => ({ name: r[0], id: Number(r[1]), folder: r[2] ?? '' }));
}

/** Discover the solution name (first directory under xml_parsed/scripts/) */
function discoverSolution(): string | null {
  const main = mainAgentDir();
  const scriptsDir = path.join(main, 'xml_parsed', 'scripts');
  if (!fs.existsSync(scriptsDir)) return null;
  const entries = fs.readdirSync(scriptsDir, { withFileTypes: true });
  const dir = entries.find(e => e.isDirectory());
  return dir?.name ?? null;
}

/**
 * Find a script file by ID using filesystem search.
 * Folder paths in scripts.index don't include the ` - ID <n>` suffixes
 * that appear in actual directory names, so we search by filename pattern.
 */
function findScriptFile(baseDir: string, scriptId: string, ext: string): string | null {
  const suffix = `- ID ${scriptId}${ext}`;

  function search(dir: string): string | null {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = search(full);
        if (found) return found;
      } else if (entry.name.endsWith(suffix)) {
        return full;
      }
    }
    return null;
  }

  return search(baseDir);
}

/** Load a script's HR text and convert SaXML to fmxmlsnippet */
async function loadScript(
  agent: string,
  scriptId: string,
  _scriptName: string,
): Promise<{ hr?: string; xml?: string; name?: string }> {
  const main = mainAgentDir();
  const solution = discoverSolution();
  if (!solution) throw new Error('No solution found in xml_parsed/scripts/');

  const sanitizedDir = path.join(main, 'xml_parsed', 'scripts_sanitized', solution);
  const scriptsDir = path.join(main, 'xml_parsed', 'scripts', solution);

  const hrFile = findScriptFile(sanitizedDir, scriptId, '.txt');
  const xmlFile = findScriptFile(scriptsDir, scriptId, '.xml');

  const result: { hr?: string; xml?: string; name?: string } = {};

  if (hrFile) {
    result.hr = fs.readFileSync(hrFile, 'utf-8');
    // Extract script name from filename: "Name - ID 123.txt"
    const baseName = path.basename(hrFile, '.txt');
    const nameMatch = baseName.match(/^(.+?)\s*-\s*ID\s+\d+$/);
    if (nameMatch) result.name = nameMatch[1].trim();
  }

  if (xmlFile) {
    try {
      const { stdout, exitCode, stderr } = await spawnPython(agent, [
        path.join(agent, 'scripts', 'fm_xml_to_snippet.py'),
        xmlFile,
      ]);
      if (exitCode === 0 && stdout.trim()) {
        result.xml = stdout;
      } else if (stderr) {
        console.warn('fm_xml_to_snippet.py warnings:', stderr);
        if (stdout.trim()) result.xml = stdout;
      }
    } catch {
      // Conversion failed — still return HR if we have it
    }

    if (!result.name) {
      const baseName = path.basename(xmlFile, '.xml');
      const nameMatch = baseName.match(/^(.+?)\s*-\s*ID\s+\d+$/);
      if (nameMatch) result.name = nameMatch[1].trim();
    }
  }

  if (!result.hr && !result.xml) {
    throw new Error(`Script ID ${scriptId} not found in xml_parsed`);
  }

  return result;
}

/** Call clipboard.py read, return XML */
async function clipboardRead(agent: string): Promise<string> {
  const tmpFile = path.join(agent, 'sandbox', '.clipboard_read_tmp.xml');
  try {
    const { exitCode, stderr } = await spawnPython(agent, [
      path.join(agent, 'scripts', 'clipboard.py'),
      'read',
      tmpFile,
    ]);
    if (exitCode !== 0) {
      throw new Error(stderr || 'clipboard.py read failed');
    }
    return fs.readFileSync(tmpFile, 'utf-8');
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}
