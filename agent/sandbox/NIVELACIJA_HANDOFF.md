# Nivelacija — state and what's left

Written 2026-09-07 at the end of the build session. Everything below is either live in FileMaker
or sitting in `agent/sandbox/` waiting to be pasted.

---

## What is live

**Schema** (via OData, `plans/schema/Autoklinika-nivelacija-*.md` — gitignored, regenerate if needed)

- `StavkePrimke` + `PDVPostotak_Trenutni`, `NabavnaCijenaEfektivna`
- New tables `CijeneStavki`, `Nivelacija`, `StavkeNivelacije` + indexes + relationships
- `CijeneStavki.KeyEvent` carries the uniqueness guard: `batch|IzvorTip|IzvorID`

**Seed** — `agent/scripts/niv_seed_prices.py`, applied. 755 price events from posted kalkulacije,
plus `PDVPostotak_Trenutni` / `NabavnaCijenaEfektivna` on all 755 batches. Idempotent; safe to
re-run (`--apply`, or omit for a dry run).

**Scripts pasted** — `NIV__GetCandidates` `NIV__Create` `NIV__GenerateStavke` `NIV__RefreshTotals`
`NIV__Post` `NIV__Unpost` `NIV__Print`, plus `TK__GetNivelacije` and the TK fragments.

**Documents posted**

| doc | datum | anchor | lines | TK (bruto) | RUC (neto) |
|---|---|---|---:|---:|---:|
| N-001-26 | 21.07.2026 | ZadrziMPC | 67 | 0,00 | −1.657,42 |
| N-002-26 | 07.09.2026 | NovaMPC | 3 | +115,97 | +99,12 |

`CijeneStavki` holds 825 events, no duplicates, no empties.

---

## 1. BLOCKING — re-paste `NIV__Create`

`agent/sandbox/NIV__Create.xml` has a fixed numbering bug that is **not yet in FileMaker**. As it
stands in FM, the next document created will collide with `N-002-26`.

Two FQL failures, both silent, both now in `feedback_fm_gotchas`:

- a `LIKE` pattern bound through `?` does not expand its wildcards
- `MAX()` over a TEXT column returns empty

Now inlines the pattern with `epSQLQuote` and uses `ORDER BY … DESC` + row 0.

Also pending, cosmetic only, no logic — re-paste whenever: `NIV__GetCandidates` (date format in one
warning message) and `NIV__Post` (a corrected comment).

## 2. Verify the TK and LID integrations

**TK** — `agent/sandbox/TK_NIVELACIJA_INTEGRATION.md`. Rebuild both periods and check:

- **August 2026** unchanged from the filed `TKM.pdf`, closing saldo included. N-001's zero effect
  must not shift anything.
- **September 2026** gains one row, `Nivelacija cijena N-002-26`, zaduženje **115,97**.

**LID** — `agent/sandbox/LID_ASOF_INTEGRATION.md`. Apply steps 1–3 if not already done (step 4, the
warning text, is deliberately **not** being changed — LID is a VAT requirement and the warning
still earns its place). Then run LID for July and August and confirm sales of pre-VAT stock after
the changeover now report tax instead of zero.

> **Watch the SELECT column.** It must be appended at the **end** of the list. Every `epSQLResult`
> index in that loop is positional; inserting mid-list shifts them all and the report keeps running
> with every number wrong.

## 3. PDF — separate project

`NIV__Print` builds the payload and POSTs to `192.168.0.150:54321/api/nivelacija-pdf`. It defaults
to `operation: "payload"`, which returns the envelope and makes **no HTTP call** — so a real
document's JSON can be handed over before the endpoint exists.

Contract: `agent/docs/NIVELACIJA_PDF_API.md`. The thing most easily got wrong: **the five printed
grid columns are net**; gross rides along under `*Bruto` and is what TK takes. Under hold-the-price
they diverge completely, and neither is ever derived from the other.

`NIV__Print` does not store `Nivelacija::PDFFile` — that needs record context and the table has no
layout yet. One `Set Field` once there is one; see `KMP__Print` (819) for the shape.

## 4. The freeze work

Neither piece blocks anything, and both fix bugs that exist independently of nivelacija.

**`Invoices::PDVPostotak`** — `TotalNet` and `TotalVAT` are unstored and divide by
`Company::VATRate`, the *current* rate. Every pre-registration invoice is being split as though it
carried VAT, and the numbers changed the day you registered. Store the rate at fiscalization,
compute from the stored value, backfill to 0 before the changeover.

**Kalkulacija line freeze** — `StavkeKalkulacijeMP::MPCijena` and friends are unstored calcs reading
`StavkePrimke::ProdajnaCijena` live, so a price change restates every posted kalkulacija. Add stored
snapshots, populate them in `KMP__Post`, then `KMP__FreezeBackfill` over history.

There is a free oracle for that backfill: `UkupnoMP_Roba` on the header is **stored**, so
`Σ(lines) ≠ header` finds every document that has already drifted. Run it in report mode first —
`niv_seed_prices.py` already prints this list. As of tonight it flags **K-007-26 (−1,00)** only;
K-023-26 and K-044-26 were fixed during the session.

Note `TK__GetZaduzenje` reads the **stored** `UkupnoMP_Roba`, not live lines — so after the freeze,
TK's zaduženje should keep coming from the frozen header total.

## 5. Zero-margin sweep

`ProdajnaCijena == NabavnaCijenaStavke` to the cent is a defect signature. Two kinds turned up:

- **K-023-26** — FM had drifted away from its own filed PDF. Corrected toward the document.
- **K-012-26 / K-028-26** — the filed documents *themselves* have RUC 0% on some lines, with the
  sibling line on the same document priced normally. Nothing to correct toward; N-002 repriced them.

Worth a sweep across all stock for the same signature. The filed PDF settles each case, and it can
be pulled straight out of the container:

```
GET {odata}/KMP__KalkulacijaMP('<id>')/PDFFile/$value
```

---

## Open decisions — for you and the accountant

**The N-001 effective date.** It is dated **21.07.2026**. You have since said VAT was practically
entered on **02.07**, with post-02.07 kalkulacije lacking VAT only where the supplier invoice
predates it. If 02.07 is the right effective date, N-001 is 19 days late and sales of pre-VAT stock
in that window resolve to 0% through `CijeneStavki` while the invoice may have charged VAT.

**Measured exposure: one invoice line.** `B-07-0016-26`, 20.07.2026, qty 4,5, **76,50 KM**. That is
the entire cost of the question. If it matters, `NIV__Unpost` N-001 and repost it dated 02.07 —
nothing supersedes it except N-002, which touches three batches that did not sell in the window.

**14 lines below cost.** Batteries with genuine 14–15% margins that cannot absorb 17% VAT. Accepted
for now; the plan is to fix problems as they surface with further nivelacije rather than reopening
N-001.

**The −1.657,42.** Margin absorbed rather than passed on. Document margin went 33,1% → 18,6% of
retail. The accountant has not seen any of this yet, and this is the first number he will ask about.

---

## Running scripts from a session

Everything above was driven through `AGFMScriptBridge`:

```python
POST {odata.base_url}/{database}/Script.AGFMScriptBridge
{"scriptParameterValue": "{\"script\": \"NIV__GetCandidates\", \"parameter\": \"{...}\"}"}
```

Response: `{"scriptResult": {"code": 0, "resultParameter": "<script result JSON>"}}`.
Credentials from `agent/config/automation.json` (gitignored).

FileMaker's OData emits bare-fraction numbers (`-.92`) which are not legal JSON. Repair before
parsing:

```python
re.sub(r'(:\s*)(-?)\.(\d)', r'\1\g<2>0.\3', raw)
```

## Gotchas earned this session

All are in `feedback_fm_gotchas` memory, repeated here because they cost real time:

- **`Perform Script` with `id="0"` resolves by name on paste.** No placeholder-scaffold pass needed
  for cross-script wiring — generate `id="0"` with the exact name and paste in any order.
- **epSQL `INSERT` *does* fire auto-enter and validation.** Audit fields and auto-enter calcs
  populate on their own.
- A `LIKE` pattern bound through `?` does not expand wildcards; `MAX()` over TEXT returns empty.
- No dot-decimal literals in generated calcs — they paste as an *empty* calculation on a
  comma-decimal file. Use `117 / 100`.
- `If` / `Exit Loop If` take `<Calculation>` as a direct child, no `<Value>` wrapper.
