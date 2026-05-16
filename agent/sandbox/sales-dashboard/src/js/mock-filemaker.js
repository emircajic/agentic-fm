/**
 * Mock FileMaker environment for dev. Stands in for the FileMaker JS bridge
 * (window.FileMaker.PerformScript) so the dashboard and its modals are
 * fully testable in the browser without FileMaker.
 */

const MOCK_DELAY_MS = 350;

// Mutable cost data, so the missingCost modal can be exercised end-to-end.
let _missingCostRows = [
  { id: 'sp-001', datumPrimitka: '03.05.2026', brojFakture: 'F-2026/41', sifraArtikla: 'ULJE-5W30', nazivArtikla: 'Motorno ulje 5W30 5L', kolicina: 4, jm: 'kom', prodajnaCijena: 89.00 },
  { id: 'sp-002', datumPrimitka: '03.05.2026', brojFakture: 'F-2026/41', sifraArtikla: 'FILT-OIL-A1', nazivArtikla: 'Filter ulja A1', kolicina: 6, jm: 'kom', prodajnaCijena: 22.00 },
  { id: 'sp-003', datumPrimitka: '05.05.2026', brojFakture: 'F-2026/42', sifraArtikla: 'PLOC-FRONT', nazivArtikla: 'Disk pločice prednje', kolicina: 2, jm: 'set', prodajnaCijena: 145.00 },
];

const RETURNS_ROWS = [
  { kolicina: 1, description: 'Disk pločice prednje', rate: 145.00, serviceOrderNumber: '2026/0312', jobDate: '06.05.2026' },
  { kolicina: 1, description: 'Filter ulja A1',       rate: 22.00,  serviceOrderNumber: '2026/0318', jobDate: '08.05.2026' },
];

const SERVICES_ROWS = [
  {
    key: 'svc-mali', description: 'Mali servis', qty: 8, lineCount: 8, revenue: 1840.00,
    lines: [
      { serviceOrderNumber: '2026/0301', jobDate: '02.05.2026', description: 'Mali servis', qty: 1, rate: 230.00 },
      { serviceOrderNumber: '2026/0304', jobDate: '03.05.2026', description: 'Mali servis', qty: 1, rate: 230.00 },
      { serviceOrderNumber: '2026/0309', jobDate: '05.05.2026', description: 'Mali servis', qty: 1, rate: 230.00 },
      { serviceOrderNumber: '2026/0312', jobDate: '06.05.2026', description: 'Mali servis', qty: 1, rate: 230.00 },
      { serviceOrderNumber: '2026/0315', jobDate: '07.05.2026', description: 'Mali servis', qty: 1, rate: 230.00 },
      { serviceOrderNumber: '2026/0318', jobDate: '08.05.2026', description: 'Mali servis', qty: 1, rate: 230.00 },
      { serviceOrderNumber: '2026/0322', jobDate: '09.05.2026', description: 'Mali servis', qty: 1, rate: 230.00 },
      { serviceOrderNumber: '2026/0324', jobDate: '10.05.2026', description: 'Mali servis', qty: 1, rate: 230.00 },
    ],
  },
  {
    key: 'svc-veliki', description: 'Veliki servis', qty: 3, lineCount: 3, revenue: 1290.00,
    lines: [
      { serviceOrderNumber: '2026/0303', jobDate: '02.05.2026', description: 'Veliki servis', qty: 1, rate: 430.00 },
      { serviceOrderNumber: '2026/0311', jobDate: '06.05.2026', description: 'Veliki servis', qty: 1, rate: 430.00 },
      { serviceOrderNumber: '2026/0320', jobDate: '09.05.2026', description: 'Veliki servis', qty: 1, rate: 430.00 },
    ],
  },
  {
    key: 'svc-ulje', description: 'Zamjena ulja', qty: 12, lineCount: 12, revenue: 720.00,
    lines: Array.from({ length: 12 }, (_, i) => ({
      serviceOrderNumber: '2026/0' + (330 + i), jobDate: '0' + ((i % 9) + 1) + '.05.2026',
      description: 'Zamjena ulja', qty: 1, rate: 60.00,
    })),
  },
  {
    key: 'svc-ploc', description: 'Zamjena disk pločica', qty: 4, lineCount: 4, revenue: 560.00,
    lines: [
      { serviceOrderNumber: '2026/0345', jobDate: '04.05.2026', description: 'Zamjena disk pločica - prednje', qty: 1, rate: 140.00 },
      { serviceOrderNumber: '2026/0350', jobDate: '05.05.2026', description: 'Zamjena disk pločica - zadnje',  qty: 1, rate: 140.00 },
      { serviceOrderNumber: '2026/0353', jobDate: '07.05.2026', description: 'Zamjena disk pločica - prednje', qty: 1, rate: 140.00 },
      { serviceOrderNumber: '2026/0360', jobDate: '10.05.2026', description: 'Zamjena disk pločica - prednje', qty: 1, rate: 140.00 },
    ],
  },
  {
    key: 'svc-pranje', description: 'Pranje motora', qty: 6, lineCount: 6, revenue: 180.00,
    lines: Array.from({ length: 6 }, (_, i) => ({
      serviceOrderNumber: '2026/0' + (370 + i), jobDate: '0' + ((i % 9) + 1) + '.05.2026',
      description: 'Pranje motora', qty: 1, rate: 30.00,
    })),
  },
  {
    key: 'svc-dijag', description: 'Dijagnostika', qty: 2, lineCount: 2, revenue: 120.00,
    lines: [
      { serviceOrderNumber: '2026/0381', jobDate: '06.05.2026', description: 'Dijagnostika OBD', qty: 1, rate: 60.00 },
      { serviceOrderNumber: '2026/0388', jobDate: '08.05.2026', description: 'Dijagnostika OBD', qty: 1, rate: 60.00 },
    ],
  },
];

export class MockFileMaker {
  PerformScript(scriptName, parameter) {
    let p = {};
    try { p = parameter ? JSON.parse(parameter) : {}; } catch { /* non-JSON */ }
    console.log(`[Mock FM] PerformScript(${scriptName})`, p);

    if (scriptName === 'WV__SalesDashboardModal') {
      this._pushModal(p.modal);
      return;
    }
    if (scriptName === 'WV__UpdateStavkaPrimkeNabavna') {
      _missingCostRows = _missingCostRows.filter(r => r.id !== p.id);
      // After update, FM re-pushes the missingCost list
      setTimeout(() => this._pushModal('missingCost'), MOCK_DELAY_MS);
      return;
    }
    console.warn('[Mock FM] Unknown script:', scriptName);
  }

  _pushModal(kind) {
    setTimeout(() => {
      if (!window.receiveModalData) return;
      let rows = [];
      if (kind === 'returns')     rows = RETURNS_ROWS;
      if (kind === 'missingCost') rows = _missingCostRows;
      if (kind === 'services')    rows = SERVICES_ROWS;
      window.receiveModalData({ modal: kind, rows });
    }, MOCK_DELAY_MS);
  }
}

export function initMockFileMaker() {
  window.FileMaker = new MockFileMaker();
  console.log('[Mock FM] FileMaker bridge mocked. Scripts: WV__SalesDashboardModal, WV__UpdateStavkaPrimkeNabavna');
}
