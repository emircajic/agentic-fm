# INSPECT__PrimkeQuery

Inspection tool that shows which StavkePrimke (incoming stock lines) were consumed by outgoing invoices via service orders. Read-only — no data is edited from the web viewer.

## Purpose

Auditing/reconciliation use case: given a set of filter criteria (invoice status, supplier name, date), surface the full chain from `Invoices` down to `StavkePrimke` and `Primke`, so the user can verify that the right stock lines were charged.

---

## Architecture

**FM → JS (push):** FileMaker script runs SQL, builds a JSON payload, and calls `Perform JavaScript in Web Viewer` targeting `window.receiveFromFileMaker(data)`.

**JS → FM (callback):** `FileMaker.PerformScript()` for navigation only. No data is written from the web viewer.

**Refresh:** FM fires it — the web viewer is purely reactive.

---

## Data flow

```
Filter params (global fields on layout)
  → INSPECT__PrimkeQuery (FM script)
    → epSQLExecute (6-table JOIN)
      → JSON array built in FM loop
        → Perform JavaScript in Web Viewer → receiveFromFileMaker(json)
          → render() → table
```

---

## SQL query

```sql
SELECT
    inv.PrimaryKey,         -- invPK     (for FM navigation)
    p.PrimaryKey,           -- primkaPK  (for FM navigation)
    sp.PrimaryKey,          -- stavkaPK  (row identity, used for selection)
    d.NazivDobavljaca,
    p.BrojFaktureDobavljaca,
    sol.Description,
    sp.Kolicina,
    sp.NabavnaCijenaStavke,
    sp.ProdajnaCijena,
    inv.BrojFakture,
    inv.Datum
FROM Invoices inv
    INNER JOIN InvoiceLinks il      ON il.ForeignKeyInvoiceID      = inv.PrimaryKey
    INNER JOIN ServiceOrders so     ON so.PrimaryKey               = il.ForeignKeyServiceOrderID
    INNER JOIN ServiceOrderLines sol ON sol.ForeignKeyServiceOrder  = so.PrimaryKey
    INNER JOIN Primke p             ON p.PrimaryKey                = sol.ForeignKeyPrimkaID
    INNER JOIN StavkePrimke sp      ON sp.PrimaryKey               = sol.ForeignKeyStavkaPrimkeID
    INNER JOIN Dobavljaci d         ON d.PrimaryKey                = p.ForeignKeyDobavljacID
WHERE
    inv.StatusDokumenta = ? AND d.NazivDobavljaca = ? AND p.DatumPrimitka > ?
ORDER BY
    p.BrojFaktureDobavljaca, sol.Description
```

**Notes:**
- `Date` in ServiceOrders is a reserved keyword — must be quoted as `so."Date"` if selected
- `--` comments are not supported by FileMaker's SQL engine — remove before use
- Unstored calculation fields cannot be queried via SQL

---

## FM script — INSPECT__PrimkeQuery (HR)

Parameter: `{ "statusDokumenta": "Račun", "dobavljac": "Motorex", "datumOd": "2026-03-23" }`

```
Set Variable [ $statusDokumenta ; JSONGetElement ( Get ( ScriptParameter ) ; "statusDokumenta" ) ]
Set Variable [ $dobavljac       ; JSONGetElement ( Get ( ScriptParameter ) ; "dobavljac" ) ]
Set Variable [ $datumOd         ; GetAsDate ( JSONGetElement ( Get ( ScriptParameter ) ; "datumOd" ) ) ]

Set Variable [ $sql ; "SELECT ..." ]   // full query above

Set Variable [ $raw ; epSQLExecute ( $sql ; "columnSeparator=TAB" ; $statusDokumenta ; $dobavljac ; $datumOd ) ]

If [ $raw = "?" or IsEmpty ( $raw ) ]
    Perform JavaScript in Web Viewer [ Object Name: "wv_PrimkeInspect" ; Function Name: "receiveFromFileMaker" ; Parameters: "{\"rows\":[]}" ]
    Exit Script [ Text Result: "" ]
End If

Set Variable [ $json     ; JSONSetElement ( "{}" ; "rows" ; "[]" ; JSONArray ) ]
Set Variable [ $rowCount ; ValueCount ( $raw ) ]
Set Variable [ $i        ; 1 ]

Loop
    Exit Loop If [ $i > $rowCount ]
    Set Variable [ $c ; Substitute ( GetValue ( $raw ; $i ) ; Char ( 9 ) ; ¶ ) ]

    Set Variable [ $obj ; JSONSetElement ( "{}" ;
        [ "invPK"               ; GetValue ( $c ; 1  ) ; JSONString ] ;
        [ "primkaPK"            ; GetValue ( $c ; 2  ) ; JSONString ] ;
        [ "stavkaPK"            ; GetValue ( $c ; 3  ) ; JSONString ] ;
        [ "dobavljac"           ; GetValue ( $c ; 4  ) ; JSONString ] ;
        [ "brFaktureDobavljaca" ; GetValue ( $c ; 5  ) ; JSONString ] ;
        [ "opis"                ; GetValue ( $c ; 6  ) ; JSONString ] ;
        [ "kolicina"            ; GetValue ( $c ; 7  ) ; JSONNumber ] ;
        [ "nabavnaCijena"       ; GetValue ( $c ; 8  ) ; JSONNumber ] ;
        [ "prodajnaCijena"      ; GetValue ( $c ; 9  ) ; JSONNumber ] ;
        [ "brFakture"           ; GetValue ( $c ; 10 ) ; JSONString ] ;
        [ "datum"               ; GetValue ( $c ; 11 ) ; JSONString ]
    ) ]

    Set Variable [ $json ; JSONSetElement ( $json ; [ "rows" ; $i - 1 ; JSONObject ] ; $obj ; JSONObject ) ]
    Set Variable [ $i    ; $i + 1 ]
End Loop

Perform JavaScript in Web Viewer [ Object Name: "wv_PrimkeInspect" ; Function Name: "receiveFromFileMaker" ; Parameters: $json ]
```

---

## Web viewer source

See `INSPECT__PrimkeQuery.js` — this is the `src/js/main.js` for the Vite project.

**Setup:**
```bash
# use filemaker-webviewer-singlepage-template to scaffold
npm install @fontsource/pt-sans
npm run dev     # dev mode loads mock data automatically
npm run build   # outputs dist/index.html — paste into FM web viewer
```

**Web viewer object name:** `wv_PrimkeInspect`

**FM navigation script wired to row action:** `INSPECT__OpenInvoice` (not yet implemented)

---

## JSON payload structure

```json
{
  "rows": [
    {
      "invPK":               "...",
      "primkaPK":            "...",
      "stavkaPK":            "...",
      "dobavljac":           "Motorex",
      "brFaktureDobavljaca": "I07-160-001",
      "opis":                "Filter ulja",
      "kolicina":            2,
      "nabavnaCijena":       15.50,
      "prodajnaCijena":      25.00,
      "brFakture":           "A-01-0042-26",
      "datum":               "2026-03-25"
    }
  ]
}
```

---

## Current state

- [x] SQL query working, filters by StatusDokumenta / NazivDobavljaca / DatumPrimitka
- [x] FM script builds JSON from epSQL result
- [x] Web viewer renders responsive table with PT Sans, dark header, zebra striping
- [x] Column sort (click header)
- [x] Multi-row selection by stavkaPK (click to toggle, accumulates)
- [x] Footer totals: stavki count, nabavna ukupno, prodajna ukupno
- [ ] FM navigation script (INSPECT__OpenInvoice) — pending
- [ ] Action on selected rows — pending (user has plans for this)
- [ ] Filter UI — currently driven by FM script parameter
