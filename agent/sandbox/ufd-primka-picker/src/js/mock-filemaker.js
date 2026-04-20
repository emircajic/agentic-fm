import mockData from './mock-data.json';

export function initMockFileMaker() {
  window.FileMaker = {
    PerformScript(scriptName, paramStr) {
      console.log(`[FM] PerformScript: ${scriptName}`, paramStr);

      // Simulate PICKER__Callback: run domain script, close on success or push error on failure
      if (scriptName === 'PICKER__Callback') {
        const param    = typeof paramStr === 'string' ? JSON.parse(paramStr) : paramStr;
        const attached = new Set(param.stavkePKs || []);

        // Toggle: hold Shift when clicking Priloži in browser to simulate an error response
        const simulateError = window._mockPickerError;
        setTimeout(() => {
          if (simulateError) {
            window.receiveError('Simulirana greška: stavka je zaključana od drugog korisnika.');
          } else {
            const updated = {
              ...mockData,
              groups: mockData.groups
                .map(g => ({
                  ...g,
                  stavke: g.stavke.filter(s => !attached.has(s.stavkaPK))
                }))
                .filter(g => g.stavke.length > 0)
            };
            updated.stavkeCount = updated.groups.reduce((n, g) => n + g.stavke.length, 0);
            updated.groupCount  = updated.groups.length;
            window.receiveFromFileMaker(updated);
          }
        }, 500);
      }
    }
  };

  // Auto-load mock data after a short delay to simulate FM calling the script
  setTimeout(() => window.receiveFromFileMaker(mockData), 300);

  console.log('[FM] Mock FileMaker initialised — auto-loading test data in 300 ms');
}
