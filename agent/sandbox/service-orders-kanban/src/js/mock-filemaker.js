import mockData from './mock-data.json';

export class MockFileMaker {
  constructor() {
    this.scriptLog = [];
  }

  // Simulate WV__UpdateSOStatus: move a card and re-push the board
  PerformScript(scriptName, parameter) {
    console.log(`[Mock FM] ${scriptName}`, parameter);
    this.scriptLog.push({ timestamp: new Date().toISOString(), scriptName, parameter });

    if (scriptName === 'WV__UpdateSOStatus') {
      const p = typeof parameter === 'string' ? JSON.parse(parameter) : parameter;
      const order = mockData.orders.find(o => o.id === p.id);
      if (order) order.status = p.status;
      // Simulate FM re-pushing the updated board after the script runs
      setTimeout(() => {
        if (window.receiveFromFileMaker) {
          window.receiveFromFileMaker(JSON.parse(JSON.stringify(mockData)));
        }
      }, 300);
    }
  }

  getScriptLog() { return this.scriptLog; }
  clearLog()      { this.scriptLog = []; }
}

export function initMockFileMaker() {
  const mock = new MockFileMaker();
  window.FileMaker = mock;

  window.mockFileMaker = {
    sendData: (data) => window.receiveFromFileMaker && window.receiveFromFileMaker(data),
    getLog:   () => mock.getScriptLog(),
    clearLog: () => mock.clearLog(),
    getData:  () => mockData,
  };

  // Auto-push initial data so the board renders immediately in dev
  setTimeout(() => {
    if (window.receiveFromFileMaker) {
      window.receiveFromFileMaker(JSON.parse(JSON.stringify(mockData)));
    }
  }, 100);

  return mock;
}
