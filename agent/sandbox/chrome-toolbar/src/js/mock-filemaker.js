/**
 * Mock FileMaker for dev. The toolbar only ever calls FileMaker.PerformScript
 * (navigation / actions) — it never expects data back — so the mock just logs
 * the call (console + the dev panel). It deliberately does NOT push anything to
 * receiveFromFileMaker, which would otherwise clobber the rendered config.
 */
export function initMockFileMaker() {
  window.FileMaker = {
    PerformScript(script, parameter) {
      const entry = { t: new Date().toLocaleTimeString(), script, parameter };
      console.log(`[Mock FM] PerformScript("${script}", ${JSON.stringify(parameter)})`);
      if (typeof window.__devLogFM === 'function') window.__devLogFM(entry);
    },
  };
  return window.FileMaker;
}
