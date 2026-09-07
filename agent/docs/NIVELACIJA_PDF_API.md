# Nivelacija PDF — service contract

Spec for the endpoint that renders a **Nivelacija cijena** document to PDF.
Producer: `NIV__Print` (FileMaker). Consumer: the document service on `192.168.0.150:54321`.

Written 2026-09-07. Envelope `verzija: 1`.

---

## 1. HTTP contract

```
POST http://192.168.0.150:54321/api/nivelacija-pdf
Content-Type: application/json; charset=utf-8
X-API-Key:    <64 hex chars, lowercase>
```

Same host and auth scheme as the existing fiscal endpoints — `X-API-Key` is
`SHA256( sharedSecret + <FileMaker PersistentID> )`, hex, lowercase, exactly as
`INV__CallFiscalAPI` (880) already sends. **Note:** under Perform Script on Server the
PersistentID is the *server's*, not a workstation's. If the service whitelists client IDs it must
also accept the server's, or the headless path will 401.

### Response — success

```json
{
  "status": "success",
  "pdfBase64": "JVBERi0xLjQK…",
  "filename": "N-001-26.pdf",
  "pages": 3
}
```

### Response — failure

```json
{ "status": "error", "error": "Nema stavki za prikaz" }
```

`status` is **mandatory in every response**, including errors. The caller treats a missing
`status` as `INVALID_RESPONSE` and a non-`success` value as `SERVICE_ERROR`, surfacing `error`
verbatim to the operator — so write `error` in Bosnian, for a human.

Caller timeout is 60s.

---

## 2. Envelope

```json
{
  "verzija": 1,
  "document": { … },
  "company":  { … },
  "stavke":   [ … ],
  "rekapitulacija": { … }
}
```

### `document`

| Field | Type | Notes |
|---|---|---|
| `tip` | string | Always `"Nivelacija"` |
| `naslov` | string | `"Nivelacija cijena"` — the printed title |
| `broj` | string | `"N-001-26"` |
| `datum` | string | ISO `YYYY-MM-DD` — the effective date |
| `datumPrikaz` | string | `"21.07.2026"` — pre-formatted for the header line |
| `status` | string | `"Otvorena"` or `"Knjižena"` |
| `datumKnjizenja` | string | Empty while open |
| `nacinIzmjene` | string | `ZadrziMPC` \| `ZadrziNeto` \| `NovaMPC` |
| `napomena` | string | Free text, may be empty |
| `datumIspisa` | string | `"07.09.2026"` — when this render was requested |

**Print a draft watermark when `status` is not `"Knjižena"`.** An unposted nivelacija changed no
price and must never be mistaken for a filed document.

### `company`

`naziv` · `adresa` · `grad` · `postanskiBroj` · `jib` · `pdvBroj` · `telefon` · `email`
— all strings, any may be empty. Letterhead block.

### `stavke[]` — one entry per batch, already in document order

**The five fields the grid prints are VAT-EXCLUSIVE.** This is deliberate; see §4.

| Field | Type | Meaning |
|---|---|---|
| `redniBroj` | number | Sequence within the document |
| `sifra` | string | Article code — the "Nomenkl. broj" column |
| `naziv` | string | Article name |
| `jm` | string | Unit, e.g. `"kom"` |
| `kolicina` | number | Stock on hand at `document.datum` |
| **`staraCijena`** | number | **NET** unit price before |
| **`ranijaVrijednost`** | number | **NET** `kolicina × staraCijena` |
| **`novaCijena`** | number | **NET** unit price after |
| **`novaVrijednost`** | number | **NET** value after |
| **`efekat`** | number | **NET** difference — the "Efekat nivelacije" column. May be negative. |
| `staraCijenaBruto` | number | VAT-inclusive unit price before |
| `ranijaVrijednostBruto` | number | VAT-inclusive value before |
| `novaCijenaBruto` | number | VAT-inclusive unit price after |
| `novaVrijednostBruto` | number | VAT-inclusive value after |
| `efekatBruto` | number | VAT-inclusive difference → **this is the figure the trgovačka knjiga takes** |
| `razlikaPDV` | number | Movement in contained VAT |
| `stariPDVPostotak` | number | e.g. `0` |
| `noviPDVPostotak` | number | e.g. `17` |
| `nabavnaCijena` | number | Effective unit cost. Never changes — a nivelacija cannot touch cost. |
| `stariRUC` / `noviRUC` | number | Unit margin before / after |
| `batchId` | string | Traceability. **Not printed.** |
| `nacinIzmjene` | string | Per-line anchor, usually equal to the document's |

### `rekapitulacija`

| Field | Meaning |
|---|---|
| `brojStavki` | Line count |
| `ranijaVrijednost` / `novaVrijednost` / `efekat` | **NET** totals — the grid's totals row |
| `ranijaVrijednostBruto` / `novaVrijednostBruto` / `efekatBruto` | Gross totals |
| `razlikaRUC` | Identical to `efekat`; both names provided |
| `razlikaPDV` | Total VAT movement |

---

## 3. Invariants the service may rely on — and should assert

```
efekat        = novaVrijednost      − ranijaVrijednost
efekatBruto   = novaVrijednostBruto − ranijaVrijednostBruto
efekatBruto   = efekat + razlikaPDV                    ← per line AND on the totals
```

Totals are the **sum of the rounded lines**, never a re-rounding of a sum, so the printed column
adds up to the printed total exactly. If it does not, reject rather than render — something
upstream is wrong and a plausible-looking wrong document is worse than an error.

`kolicina` is the same on both sides of every line. The specimen form has two quantity columns
because its source system prices per article and splits rows across new prices; this system prices
per batch, so each line has exactly one old and one new price. Keep both columns for familiarity —
they simply always match.

---

## 4. Why the printed columns are net

Under `nacinIzmjene: "ZadrziMPC"` the shelf price is held and VAT is absorbed out of the margin.
Printed gross, every `efekatBruto` is `0.00` and the document says nothing. Printed net, the same
document shows exactly how much margin the VAT took.

Worked line — cost 70, shelf price 100, 5 on hand, entering VAT at 17%:

| | Neto | PDV | Bruto | RUC |
|---|---:|---:|---:|---:|
| Prije | 100,000 | 0,000 | 100,000 | 30,000 |
| Poslije | 85,470 | 14,530 | 100,000 | 15,470 |

```
ranijaVrijednost 500,00   novaVrijednost 427,35   efekat      −72,65
                                                  razlikaPDV  +72,65
                                                  efekatBruto   0,00   ← nothing reaches the ledger
```

Both numbers are true and they have different readers. **Never derive one from the other at render
time** — use the field you are given.

---

## 5. Page layout

Follow the specimen (`nivelacija 31072026.pdf`), A4 portrait.

**Header, repeated on every page:**

```
Dana: {document.datumPrikaz} godine          {company.naziv}
{document.naslov} br. {document.broj}        {company.adresa}
                                             {company.postanskiBroj} {company.grad}
                                             JIB: {company.jib}   PDV: {company.pdvBroj}
```

**Column band, repeated on every page:**

```
Red.br. | Nomenkl.broj | NAZIV ARTIKLA | Jed.mj. | Količina | Stara cijena |
Ranija vrijednost | Količina | Nova cijena | Nova vrijednost | Efekat nivelacije
```

**Totals row — last page only**, under the last line: the three `rekapitulacija` net figures,
aligned under `Ranija vrijednost`, `Nova vrijednost`, `Efekat nivelacije`.

**Recapitulation block — last page only**, below the totals:

```
Ranija vrijednost (bez PDV-a)      {rekapitulacija.ranijaVrijednost}
Nova vrijednost (bez PDV-a)        {rekapitulacija.novaVrijednost}
Efekat nivelacije / razlika u cijeni {rekapitulacija.efekat}
Razlika PDV-a                      {rekapitulacija.razlikaPDV}
Efekat u maloprodajnoj vrijednosti {rekapitulacija.efekatBruto}
```

That last line is what goes into the trgovačka knjiga. Where it is `0,00`, no ledger entry is made
at all — worth a footnote on the form so the accountant is not left looking for one.

**Footer — last page only:**

```
        POTPIS                                    M.P.
   ________________
```

`document.napomena` prints above the signature block when non-empty.

---

## 6. Number formatting — the service's job, not FileMaker's

Every amount arrives as a raw JSON number. Format for BiH locale:

- **Decimal separator `,`** · **thousands separator `.`** — `8.517,502`
- **Prices and values: 3 decimals**, matching the specimen
- **Quantities: 3 decimals** — the specimen prints `1,000` and `13,000`
- **Percentages: 0 decimals** — `17`
- Negative values with a leading minus, no parentheses, no colour
- Currency symbol is **not** printed in the grid

Encoding is UTF-8 throughout — `č ć ž š đ` must survive into the PDF. Check `Knjižena` and
`Količina` on the first render; a mangled diacritic here means the font subset is wrong, not the
data.

---

## 7. Getting a real payload before the endpoint exists

`NIV__Print` defaults to `operation: "payload"`, which builds the full envelope and returns it in
`data.payload` **without making any HTTP call**. So a real document's JSON can be handed over
before the service is written:

```
Perform Script [ "NIV__Print" ; JSONSetElement ( "{}" ;
    [ "nivelacijaId" ; <PK> ; JSONString ] ;
    [ "operation"    ; "payload" ; JSONString ] ) ]
```

Switch to `"operation": "generate-pdf"` once the endpoint answers. An `endpoint` parameter
overrides the path for testing against a staging route.

---

## 8. Not in scope for the service

- **Storing the PDF.** `NIV__Print` returns `pdfBase64` and does not write
  `Nivelacija::PDFFile` — that needs FileMaker record context and no layout exists for the table
  yet. One `Set Field` step once there is one; see `KMP__Print` (819).
- **The `Za objekat` line** from the specimen. Single location, so it is omitted.
- **Printing.** Rendering only. The existing `/api/print-pdf` route handles physical printing and
  takes `pdfBase64` back.
