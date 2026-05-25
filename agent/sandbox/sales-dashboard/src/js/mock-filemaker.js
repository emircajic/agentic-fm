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
  { kolicina: 1, description: 'Disk pločice prednje', rate: 145.00, serviceOrderNumber: '2026/0312', jobDate: '06.05.2026', serviceOrderId: 'so-uuid-0312' },
  { kolicina: 1, description: 'Filter ulja A1',       rate: 22.00,  serviceOrderNumber: '2026/0318', jobDate: '08.05.2026', serviceOrderId: 'so-uuid-0318' },
];

const GOODS_ROWS = [
  { jobDate: '10.05.2026', serviceOrderNumber: '2026/0324', serviceOrderId: 'so-uuid-0324', sifraArtikla: 'ULJE-5W30',   description: 'Motorno ulje 5W30 5L',     qty: 1, rate: 89.00, nabavna: 62.00, jm: 'kom' },
  { jobDate: '10.05.2026', serviceOrderNumber: '2026/0324', serviceOrderId: 'so-uuid-0324', sifraArtikla: 'FILT-OIL-A1', description: 'Filter ulja A1',           qty: 1, rate: 22.00, nabavna: 14.00, jm: 'kom' },
  { jobDate: '09.05.2026', serviceOrderNumber: '2026/0322', serviceOrderId: 'so-uuid-0322', sifraArtikla: 'PLOC-FRONT',  description: 'Disk pločice prednje',     qty: 1, rate: 145.00, nabavna: 92.00, jm: 'set' },
  { jobDate: '08.05.2026', serviceOrderNumber: '2026/0318', serviceOrderId: 'so-uuid-0318', sifraArtikla: 'FILT-AIR-X2', description: 'Filter zraka X2',          qty: 1, rate: 40.00, nabavna: 0, jm: 'kom' },
  { jobDate: '07.05.2026', serviceOrderNumber: '2026/0315', serviceOrderId: 'so-uuid-0315', sifraArtikla: 'WIPER-22',    description: 'Brisači 22"',              qty: 2, rate: 18.00, nabavna: 9.00, jm: 'kom' },
  { jobDate: '06.05.2026', serviceOrderNumber: '2026/0312', serviceOrderId: 'so-uuid-0312', sifraArtikla: 'PLOC-FRONT',  description: 'Disk pločice prednje',     qty: 1, rate: 145.00, nabavna: 92.00, jm: 'set' },
  { jobDate: '05.05.2026', serviceOrderNumber: '2026/0309', serviceOrderId: 'so-uuid-0309', sifraArtikla: 'ULJE-5W30',   description: 'Motorno ulje 5W30 5L',     qty: 2, rate: 89.00, nabavna: 62.00, jm: 'kom' },
  { jobDate: '03.05.2026', serviceOrderNumber: '2026/0304', serviceOrderId: 'so-uuid-0304', sifraArtikla: 'AKU-60AH',    description: 'Akumulator 60Ah',          qty: 1, rate: 195.00, nabavna: 0, jm: 'kom' },
  { jobDate: '02.05.2026', serviceOrderNumber: '2026/0301', serviceOrderId: 'so-uuid-0301', sifraArtikla: 'SIJAL-H7',    description: 'Sijalica H7',              qty: 2, rate: 12.00, nabavna: 5.00, jm: 'kom' },
];

// Mock raw rows (one per ServiceOrderLine) — the mock aggregates them by
// Service Items.Type just like the FM script does.
const SERVICES_RAW = [
  { type: 'Redovno održavanje i servis', soId: 'so-uuid-0301', soNum: '2026/0301', jobDate: '02.05.2026', description: 'Mali servis',                        qty: 1, rate: 230.00 },
  { type: 'Redovno održavanje i servis', soId: 'so-uuid-0304', soNum: '2026/0304', jobDate: '03.05.2026', description: 'Mali servis',                        qty: 1, rate: 230.00 },
  { type: 'Redovno održavanje i servis', soId: 'so-uuid-0309', soNum: '2026/0309', jobDate: '05.05.2026', description: 'Veliki servis',                      qty: 1, rate: 430.00 },
  { type: 'Redovno održavanje i servis', soId: 'so-uuid-0312', soNum: '2026/0312', jobDate: '06.05.2026', description: 'Zamjena ulja i filtera ulja',        qty: 1, rate: 60.00 },
  { type: 'Redovno održavanje i servis', soId: 'so-uuid-0318', soNum: '2026/0318', jobDate: '08.05.2026', description: 'Zamjena filtera zraka',              qty: 1, rate: 40.00 },
  { type: 'Redovno održavanje i servis', soId: 'so-uuid-0322', soNum: '2026/0322', jobDate: '09.05.2026', description: 'Mali servis',                        qty: 1, rate: 230.00 },

  { type: 'Dijagnostika',                soId: 'so-uuid-0381', soNum: '2026/0381', jobDate: '06.05.2026', description: 'Kompjuterska dijagnostika',          qty: 1, rate: 60.00 },
  { type: 'Dijagnostika',                soId: 'so-uuid-0388', soNum: '2026/0388', jobDate: '08.05.2026', description: 'Detaljan pregled vozila',            qty: 1, rate: 80.00 },

  { type: 'Kočioni sistem',              soId: 'so-uuid-0345', soNum: '2026/0345', jobDate: '04.05.2026', description: 'Zamjena prednjih kočionih pločica',  qty: 1, rate: 140.00 },
  { type: 'Kočioni sistem',              soId: 'so-uuid-0353', soNum: '2026/0353', jobDate: '07.05.2026', description: 'Zamjena prednjih diskova i pločica', qty: 1, rate: 220.00 },
  { type: 'Kočioni sistem',              soId: 'so-uuid-0360', soNum: '2026/0360', jobDate: '10.05.2026', description: 'Obrada diska',                       qty: 1, rate: 80.00 },

  { type: 'Vulkanizerske usluge',        soId: 'so-uuid-0370', soNum: '2026/0370', jobDate: '03.05.2026', description: 'Montaža, demontaža i balansiranje',  qty: 4, rate: 30.00 },
  { type: 'Vulkanizerske usluge',        soId: 'so-uuid-0375', soNum: '2026/0375', jobDate: '07.05.2026', description: 'Krpljenje gume',                     qty: 1, rate: 20.00 },

  // Lines without a matching Service Item → bucket to "Ostale usluge"
  { type: '',                            soId: 'so-uuid-0399', soNum: '2026/0399', jobDate: '05.05.2026', description: 'Demontaža branika',                  qty: 1, rate: 45.00 },
  { type: '',                            soId: 'so-uuid-0402', soNum: '2026/0402', jobDate: '09.05.2026', description: 'Sitne korekcije',                    qty: 2, rate: 25.00 },
];

function aggregateByType(raw) {
  const dict = new Map();
  for (const r of raw) {
    const key = r.type && r.type.trim() ? r.type : 'Ostale usluge';
    const line = { serviceOrderNumber: r.soNum, serviceOrderId: r.soId, jobDate: r.jobDate, description: r.description, qty: r.qty, rate: r.rate };
    if (!dict.has(key)) {
      dict.set(key, { key, description: key, qty: 0, lineCount: 0, revenue: 0, lines: [] });
    }
    const e = dict.get(key);
    e.qty       += r.qty;
    e.lineCount += 1;
    e.revenue   += r.qty * r.rate;
    e.lines.push(line);
  }
  return [...dict.values()];
}

const SERVICES_ROWS = aggregateByType(SERVICES_RAW);

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
    if (scriptName === 'WV__OpenServiceOrderCard') {
      // In FM this opens a card window. In dev we just confirm.
      console.log('[Mock FM] Would open ServiceOrderDetails card window for SO id:', parameter);
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
      if (kind === 'goods')       rows = GOODS_ROWS;
      window.receiveModalData({ modal: kind, rows });
    }, MOCK_DELAY_MS);
  }
}

export function initMockFileMaker() {
  window.FileMaker = new MockFileMaker();
  console.log('[Mock FM] FileMaker bridge mocked. Scripts: WV__SalesDashboardModal, WV__UpdateStavkaPrimkeNabavna');
}
