# `LID__BuildLista` (961) — read VAT as of the sale, not as of the kalkulacija

## The bug

The report takes `RUCIznos` and `PDVIznos` from `KMP__Stavke` — the kalkulacija line. Those record
what was true when the goods were priced **in**, not when they were sold. Anything kalkulisano
before VAT registration carries `PDVIznos = 0` permanently, so every later sale of that stock
reports no tax.

The script already notices the symptom and blames the wrong cause:

```
ZERO_PDV — "…PDVIznos nije upisan na kalkulaciji (KMP__SyncPDV not run)"
```

`KMP__SyncPDV` was never the problem. The kalkulacija is correct; it is simply being asked a
question it cannot answer.

## Why the fix is small

A nivelacija **never changes cost**, and rabat is a purchase fact that cannot change after the
event. So `nabavnaVrijednost` and `rabat` are already right and stay untouched.

Only RUC and PDV are wrong, and both fall out of two numbers — the gross shelf price in force on
the invoice date and the rate contained in it:

```
neto = gross / (1 + pct/100)
ruc  = (neto − cost) × qty
pdv  = (gross − neto) × qty
```

`CijeneStavki` supplies gross and pct as of any date. Four edits.

---

## 1. Append one column to the main SELECT

In the `$sql` variable, append `il."PrimaryKey"` to the **end** of the SELECT list. Change:

```
"k.\"RabatPostotak\", k.\"ZavisniTroskovi\", k.\"RabatIznos\", k.\"RUCIznos\", k.\"PDVIznos\" " &
```

to:

```
"k.\"RabatPostotak\", k.\"ZavisniTroskovi\", k.\"RabatIznos\", k.\"RUCIznos\", k.\"PDVIznos\", " &
"il.\"PrimaryKey\" " &
```

> **Append, do not insert.** Every `epSQLResult` index in the loop is positional. Adding the column
> at the end makes it index **12** and leaves 0–11 exactly where they are. Putting it anywhere else
> silently shifts every field the loop reads — the script would still run and every number would be
> wrong.

## 2. Insert the as-of lookup

Paste `agent/sandbox/LID__BuildLista.fragment-A.xml` **after**

```
Set Variable [ $rowCount ; epSQLResultRowCount ( "rs_lid" ) ]
```

and **before** the `# 2. Group by invoice…` comment.

It runs one query and builds `$asof`, a map of `InvoiceLines.PrimaryKey → { c: gross, p: rate }`
resolved to each line's own invoice date.

## 3. Replace the RUC and PDV accumulators

At the bottom of the main loop, delete these two steps:

```
Set Variable [ $accRUC ; $accRUC + GetAsNumber ( epSQLResult ( $i ; 10 ; "rs_lid" ) ) * $faktor ]
Set Variable [ $accPDV ; $accPDV + GetAsNumber ( epSQLResult ( $i ; 11 ; "rs_lid" ) ) * $faktor ]
```

and paste `agent/sandbox/LID__BuildLista.fragment-B.xml` in their place — i.e. after
`Set Variable [ $accRabat ; … ]` and before `Set Variable [ $i ; $i + 1 ]`.

Leave `$accNabavna` and `$accRabat` exactly as they are.

## 4. Retire the misleading warning text

`ZERO_PDV` can still legitimately fire — a genuine sale at 0% VAT before 21.07.2026 — but the
message now names the wrong cause. Suggested replacement:

```
$bezPDV & " dokument(a) ima PDV = 0 uz oporezivu prodaju — provjeriti da li je roba
prodana prije uvođenja PDV-a ili nedostaje cjenovni događaj: " & $bezPDVLista
```

---

## What changes in the output

For any sale **after 21.07.2026** of stock kalkulisano before it, `pdv` stops being 0 and `ruc`
drops by the same amount — the margin that N-001-26 moved into tax. `nabavnaVrijednost`,
`rabat` and `prodajnaVrijednost` are unchanged, and `prodajnaVrijednost = nabavna + ruc` still
holds exactly, because RUC is derived against the loop's own `$costUnit` rather than the event's
copy of it.

Sales **before** 21.07.2026 still report 0% — correctly, because that is what was in force.

## Worth checking after pasting

The 14.07–21.07 window. Memory says `K-037-26` (14.07) is the first kalkulacija carrying VAT, but
21.07 is the registration date N-001 uses. If any invoice in those seven days charged VAT while the
batch's as-of rate resolves to 0, LID and the invoice will disagree. Run LID for
**01.07 – 31.07.2026** and compare its `pdv` total against those invoices before trusting the July
figures.

I can drive that through `AGFMScriptBridge` and diff it — say the word.
