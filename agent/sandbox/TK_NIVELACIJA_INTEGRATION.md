# Trgovačka knjiga — nivelacija integration

Three changes. One new script, two surgical inserts into working scripts.
Do them in this order — step 2 needs the script from step 1 to exist.

---

## 1. New script: `TK__GetNivelacije`

Paste `agent/sandbox/TK__GetNivelacije.xml` into a new script in the **Trgovačka knjiga** folder,
named exactly `TK__GetNivelacije`.

Sibling of `TK__GetZaduzenje` / `TK__GetRazduzenje` — same `{status, rows, errors}` contract, same
row shape, `sortOrder` **2** (after kalkulacije at 1, before sales at 3).

---

## 2. `TK__BuildLedger` (700) — add the nivelacija leg

**2a.** Paste `agent/sandbox/TK__BuildLedger.fragment.xml` immediately **after** the
`# // 3. RAZDUŽENJA` block — that is, after its closing `End If` and before `# // 4. MERGE`.

> **The one manual step.** The pasted `Perform Script` carries `id="0"` because
> `TK__GetNivelacije` did not exist when this was generated. FileMaker will show it as
> `<Unknown>` in red. Double-click it and pick `TK__GetNivelacije` from the list. It is visible
> and obvious — but it will not run until you do it.

**2b.** In `# // 4. MERGE`, extend the `Let` so the new rows join the merge. Replace:

```
~donosArray = JSONSetElement ( "[]" ; "[+]" ; $donosRow ; JSONObject );
~zaduzenjaArray = JSONGetElement ( $zaduzenjaResult ; "rows" );
~razduzenjaArray = JSONGetElement ( $razduzenjaResult ; "rows" );

~rezultat = JSONMergeArrays(~donosArray; ~zaduzenjaArray);
~rezultat = JSONMergeArrays(~rezultat;~razduzenjaArray)
```

with:

```
~donosArray = JSONSetElement ( "[]" ; "[+]" ; $donosRow ; JSONObject );
~zaduzenjaArray = JSONGetElement ( $zaduzenjaResult ; "rows" );
~nivelacijeArray = JSONGetElement ( $nivelacijeResult ; "rows" );
~razduzenjaArray = JSONGetElement ( $razduzenjaResult ; "rows" );

~rezultat = JSONMergeArrays(~donosArray; ~zaduzenjaArray);
~rezultat = JSONMergeArrays(~rezultat;~nivelacijeArray);
~rezultat = JSONMergeArrays(~rezultat;~razduzenjaArray)
```

`JSONSortLedgerRows` then orders everything by `sortDatum` + `sortOrder`, so the nivelacija lands
after the day's kalkulacije and before its sales. `TK__NumberRows` renumbers after the sort.

---

## 3. `TK__GetDonos` (697) — carry nivelacije into the opening balance

**Without this the opening balance is wrong from row one**, and the error persists in every later
period. A nivelacija changes the retail value of stock already carried, so a period opening after
one must inherit its effect.

**3a.** Paste `agent/sandbox/TK__GetDonos.fragment.xml` immediately **after** the
`# 1. ZADUŽENJA before datumOd` `Set Variable [ $zaduzenjeBefore ; … ]` step.

**3b.** Find this line further down:

```
Set Variable [ $zaduzenjeBefore ; GetAsNumber ( $zaduzenjeBefore ) ]
```

and change it to:

```
Set Variable [ $zaduzenjeBefore ; GetAsNumber ( $zaduzenjeBefore ) + $nivelacijeBefore ]
```

That single `+` is the whole of the arithmetic change. `donos = zaduzenje − razduzenje` already
follows below it, and a negative nivelacija carries a negative `UkupnoRazlika`, so it reduces the
opening balance correctly with no sign handling.

> Note: this script has a second, older copy of the same logic present as **disabled** steps (it
> reads `UkupnoGotovina + UkupnoKartice` rather than `UkupnoPologRoba`). Edit the **enabled** one.

---

## What this produces today

| doc | datum | UkupnoRazlika | ledger effect |
|---|---|---:|---|
| N-001-26 | 21.07.2026 | 0,00 | **no row** — hold-the-price moves no retail value |
| N-002-26 | 07.09.2026 | +115,97 | zaduženje 115,97 in September |

N-001 emitting nothing is deliberate. A 0,00 / 0,00 row would renumber every subsequent
`RedniBroj` in an already-filed July while changing no saldo — worse than its absence. The document
still exists, is numbered, and is filed on its own; it simply has nothing to say to the ledger.

## Verify after pasting

Rebuild both periods and check:

- **August 2026** — unchanged from the filed `TKM.pdf`, including the closing saldo. Nothing in
  that period has a nivelacija, and N-001's zero effect must not shift the opening balance.
- **September 2026** — one new row, `Nivelacija cijena N-002-26`, zaduženje **115,97**, sorted
  after any same-day kalkulacija.

I can drive both through `AGFMScriptBridge` and diff August against the filed PDF — say the word.
