/**
 * Mock FileMaker environment for local dev/preview.
 * Simulates SearchClients / SearchVehicles / PICKER__* scripts and their callbacks.
 */

let uid = 1000;
const nextId = () => `mock-${++uid}`;

const clients = [
  { PrimaryKey: 'c1', FirstName: 'Adnan', LastName: 'Hodžić', CompanyName: '', Type: 'Fizičko lice', Phone: '061 111 222', Email: 'adnan@example.ba', DisplayName_Display: 'Adnan Hodžić', VehicleCount_Calculation: 2 },
  { PrimaryKey: 'c2', FirstName: '', LastName: '', CompanyName: 'Auto Centar d.o.o.', Type: 'Pravno lice', Phone: '033 555 010', Email: 'info@autocentar.ba', DisplayName_Display: 'Auto Centar d.o.o.', VehicleCount_Calculation: 5 },
  { PrimaryKey: 'c3', FirstName: 'Mirela', LastName: 'Begić', CompanyName: '', Type: 'Fizičko lice', Phone: '062 333 444', Email: 'mirela@example.ba', DisplayName_Display: 'Mirela Begić', VehicleCount_Calculation: 0 },
  { PrimaryKey: 'c4', FirstName: 'Senad', LastName: 'Kovač', CompanyName: '', Type: 'Fizičko lice', Phone: '063 777 888', Email: '', DisplayName_Display: 'Senad Kovač', VehicleCount_Calculation: 1 },
  { PrimaryKey: 'c5', FirstName: '', LastName: '', CompanyName: 'Transport BH', Type: 'Pravno lice', Phone: '051 200 300', Email: 'fleet@transportbh.ba', DisplayName_Display: 'Transport BH', VehicleCount_Calculation: 8 },
];

const vehicles = [
  { PrimaryKey: 'v1', Manufacturer: 'Volkswagen', Model: 'Golf 7', YearManufactured: 2016, VIN: 'WVWZZZ1KZ123456', PlateNumber: 'A12-B-345', ForeignKeyClient: 'c1' },
  { PrimaryKey: 'v2', Manufacturer: 'Audi', Model: 'A4', YearManufactured: 2019, VIN: 'WAUZZZ8K9123456', PlateNumber: 'E55-K-901', ForeignKeyClient: 'c1' },
  { PrimaryKey: 'v3', Manufacturer: 'Mercedes', Model: 'Sprinter', YearManufactured: 2020, VIN: 'WDB9066331S123', PlateNumber: 'J77-M-112', ForeignKeyClient: 'c2' },
  { PrimaryKey: 'v4', Manufacturer: 'Renault', Model: 'Clio', YearManufactured: 2014, VIN: 'VF1BR1B0H51234', PlateNumber: 'K10-O-223', ForeignKeyClient: 'c4' },
  { PrimaryKey: 'v5', Manufacturer: 'Škoda', Model: 'Octavia', YearManufactured: 2021, VIN: 'TMBJJ7NE0M0123', PlateNumber: 'M22-T-456', ForeignKeyClient: '' },
  { PrimaryKey: 'v6', Manufacturer: 'BMW', Model: '320d', YearManufactured: 2018, VIN: 'WBA8E9105J0123', PlateNumber: 'O33-A-789', ForeignKeyClient: 'c5' },
  { PrimaryKey: 'v7', Manufacturer: 'Ford', Model: 'Transit', YearManufactured: 2017, VIN: 'WF0XXXTTGXHA12', PlateNumber: 'T44-E-012', ForeignKeyClient: 'c5' },
  { PrimaryKey: 'v8', Manufacturer: 'Toyota', Model: 'Yaris', YearManufactured: 2022, VIN: 'JTDKB20U1234567', PlateNumber: 'A99-Z-000', ForeignKeyClient: '' },
];

// Generate extra records so paging/infinite-scroll can be exercised in dev.
const makers = ['Volkswagen', 'Audi', 'BMW', 'Mercedes', 'Toyota', 'Ford', 'Opel', 'Peugeot'];
for (let i = 1; i <= 60; i++) {
  vehicles.push({
    PrimaryKey: `gv${i}`, Manufacturer: makers[i % makers.length], Model: `Model ${i}`,
    YearManufactured: 2000 + (i % 24), VIN: `VINGEN${String(i).padStart(6, '0')}`,
    PlateNumber: `G${String(i).padStart(3, '0')}-X-${i}`, ForeignKeyClient: i % 5 === 0 ? 'c5' : '',
  });
}
for (let i = 1; i <= 40; i++) {
  clients.push({
    PrimaryKey: `gc${i}`, FirstName: `Ime${i}`, LastName: `Prezime${i}`, CompanyName: '',
    Type: 'Fizičko lice', Phone: `06${i}`, Email: `klijent${i}@example.ba`,
    DisplayName_Display: `Ime${i} Prezime${i}`, VehicleCount_Calculation: 0,
  });
}

function matchClient(c, term) {
  if (!term) return true;
  const t = term.toLowerCase();
  return [c.DisplayName_Display, c.Phone, c.Email].some((f) => (f || '').toLowerCase().includes(t));
}
function matchVehicle(v, term) {
  if (!term) return true;
  const t = term.toLowerCase();
  return [v.Manufacturer, v.Model, v.VIN, v.PlateNumber].some((f) => (f || '').toLowerCase().includes(t));
}

function page(rows, offset, limit) {
  const slice = rows.slice(offset, offset + limit);
  return { results: slice, totalCount: rows.length, hasMore: offset + limit < rows.length };
}

class MockFileMaker {
  PerformScript(scriptName, parameter) {
    const p = parameter ? JSON.parse(parameter) : {};
    console.log('[Mock FM]', scriptName, p);
    setTimeout(() => this.route(scriptName, p), 200);
  }

  route(script, p) {
    switch (script) {
      case 'SearchClients': {
        const filtered = clients.filter((c) => matchClient(c, p.search));
        window.receiveClientData(page(filtered, p.offset || 0, p.limit || 25));
        break;
      }
      case 'SearchVehicles': {
        let rows = vehicles.filter((v) => matchVehicle(v, p.search));
        if (p.clientId && p.scope === 'owned') {
          rows = rows.filter((v) => v.ForeignKeyClient === p.clientId);
        } else if (p.clientId) {
          rows = rows.slice().sort((a, b) =>
            (a.ForeignKeyClient === p.clientId ? 0 : 1) - (b.ForeignKeyClient === p.clientId ? 0 : 1));
        }
        window.receiveVehicleData(page(rows, p.offset || 0, p.limit || 25));
        break;
      }
      case 'PICKER__SaveClient': {
        const id = nextId();
        const c = {
          PrimaryKey: id, Type: p.type,
          FirstName: p.firstName, LastName: p.lastName, CompanyName: p.companyName,
          Phone: p.phone, Email: p.email, VehicleCount_Calculation: 0,
          DisplayName_Display: p.type === 'Pravno lice' ? p.companyName : [p.firstName, p.lastName].filter(Boolean).join(' '),
        };
        clients.unshift(c);
        window.receiveClientSaved({ client: c });
        break;
      }
      case 'PICKER__SaveVehicle': {
        if (p.mode === 'update') {
          const v = vehicles.find((x) => x.PrimaryKey === p.vehicleId);
          if (v) Object.assign(v, { Manufacturer: p.manufacturer, Model: p.model, YearManufactured: p.year, VIN: p.vin, PlateNumber: p.plate });
          window.receiveVehicleSaved({ vehicle: v });
        } else {
          const v = { PrimaryKey: nextId(), Manufacturer: p.manufacturer, Model: p.model, YearManufactured: p.year, VIN: p.vin, PlateNumber: p.plate, ForeignKeyClient: p.clientId || '' };
          vehicles.unshift(v);
          window.receiveVehicleSaved({ vehicle: v });
        }
        break;
      }
      case 'PICKER__SetVehicleOwner': {
        const v = vehicles.find((x) => x.PrimaryKey === p.vehicleId);
        if (v) v.ForeignKeyClient = p.clientId || '';
        window.receiveVehicleOwnerChanged({ vehicleId: p.vehicleId, clientId: p.clientId || '' });
        break;
      }
      case 'PICKER__CommitClientVehicle': {
        console.log('[Mock FM] COMMIT', p, '→ would set ServiceOrders FKs and close card');
        alert(`Commit:\nclient=${p.clientId || '(none)'}\nvehicle=${p.vehicleId || '(none)'}${p.cancel ? '\n(cancelled)' : ''}`);
        break;
      }
      default:
        console.warn('[Mock FM] unhandled script', script);
    }
  }
}

export function initMockFileMaker() {
  window.FileMaker = new MockFileMaker();
  console.log('[Mock FM] initialized');
}
