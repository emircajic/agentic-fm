#!/usr/bin/env python3
"""
Seed the price-event log (CijeneStavki) and the batch-level current valuation
fields on StavkePrimke, from posted kalkulacije.

This is the prerequisite for the first nivelacija: NIV__Post's chronology gate
reads CijeneStavki, and NIV__GetCandidates' eligibility rule reads
StavkePrimke::PDVPostotak_Trenutni.

For every line of every POSTED kalkulacija (KalkulacijaMP.Status = "Knjižena"):

  StavkePrimke.PDVPostotak_Trenutni    <- KMP__Stavke.PDVPostotak   (+ VAT_OVERRIDES)
  StavkePrimke.NabavnaCijenaEfektivna  <- NabavnaCijenaStavke
                                          - NabavnaCijenaStavke/100 * RabatPostotak
                                          + ZavisniTroskovi
  CijeneStavki                         <- one event, VaziOd = DatumKalkulacije,
                                          TipPrioritet = 1, Cijena = ProdajnaCijena (gross)

Writes go through OData, NOT SQL, so FileMaker's auto-enter and validation fire:
the TSID PrimaryKey, the KeyEvent uniqueness calc, and the audit fields are all
populated by the engine. A SQL INSERT would bypass every one of them.

Idempotent: existing events are matched on KeyEvent and skipped, and a PATCH is
only issued when a value actually differs. Safe to re-run and safe to resume
after an interruption.

Usage:
    python3 agent/scripts/niv_seed_prices.py                 # dry run, full report
    python3 agent/scripts/niv_seed_prices.py --limit 25      # dry run, small slice
    python3 agent/scripts/niv_seed_prices.py --apply         # write
"""

import argparse
import base64
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "agent" / "config" / "automation.json"
SOLUTION = "Autoklinika"

POSTED_STATUS = "Knjižena"
IZVOR_TIP = "Kalkulacija"
TIP_PRIORITET = 1

# Kalkulacije whose stored VAT rate disagrees with the document actually filed.
# K-023-26 was printed and filed at 0% VAT; some lines were later hand-edited to
# 17 so a month's totals would tie out. The filed document is authoritative, so
# its batches are seeded at 0 and N-001 lifts them to 17 through a numbered
# document instead of a manual edit.
VAT_OVERRIDES = {"K-023-26": 0}

MONEY_DP = 6  # guards against float noise; FM stores full precision


# --------------------------------------------------------------------------- io


def load_odata():
    cfg = json.loads(CONFIG.read_text())["solutions"][SOLUTION]["odata"]
    base = f"{cfg['base_url'].rstrip('/')}/{cfg['database']}"
    token = base64.b64encode(
        f"{cfg['username']}:{cfg['password']}".encode()
    ).decode()
    return base, token


def request(base, token, method, path, body=None, retries=3):
    url = path if path.startswith("http") else base + path
    data = json.dumps(body).encode() if body is not None else None
    for attempt in range(retries):
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", f"Basic {token}")
        if data:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read().decode("utf-8")
                return resp.status, (json.loads(raw) if raw.strip() else {})
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:400]
            if exc.code >= 500 and attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1))
                continue
            return exc.code, {"error": detail}
        except urllib.error.URLError as exc:
            if attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1))
                continue
            return 0, {"error": str(exc)}
    return 0, {"error": "exhausted retries"}


def fetch_all(base, token, entity, select):
    """Page through an entity set, following @nextLink."""
    path = f"/{entity}?$select={','.join(select)}"
    rows = []
    while path:
        status, payload = request(base, token, "GET", path)
        if status != 200:
            raise SystemExit(f"GET {entity} failed [{status}]: {payload.get('error')}")
        rows.extend(payload.get("value", []))
        nxt = payload.get("@nextLink") or payload.get("@odata.nextLink")
        path = nxt if nxt else None
    return rows


def quote_key(pk):
    return "'" + str(pk).replace("'", "''") + "'"


# ---------------------------------------------------------------------- helpers


def num(value):
    if value in (None, ""):
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def effective_cost(nabavna, rabat_pct, zavisni):
    return round(nabavna - (nabavna / 100.0 * rabat_pct) + zavisni, MONEY_DP)


# ------------------------------------------------------------------------ build


def build(base, token, limit=None):
    print("Reading source data …")

    kalk = fetch_all(
        base, token, "KMP__KalkulacijaMP",
        ["PrimaryKey", "BrojKalkulacije", "DatumKalkulacije", "Status", "UkupnoMP_Roba"],
    )
    lines = fetch_all(
        base, token, "KMP__Stavke",
        ["PrimaryKey", "ForeignKeyKalkulacijaID", "PDVPostotak",
         "RabatPostotak", "ZavisniTroskovi"],
    )
    batches = fetch_all(
        base, token, "StavkePrimke",
        ["PrimaryKey", "ForeignKeyArtikalID", "Kolicina", "ProdajnaCijena",
         "NabavnaCijenaStavke", "PDVPostotak_Trenutni", "NabavnaCijenaEfektivna"],
    )
    existing = fetch_all(base, token, "CijeneStavki", ["KeyEvent"])

    print(f"  kalkulacije      {len(kalk):>6}")
    print(f"  kalkulacija lines{len(lines):>6}")
    print(f"  batches          {len(batches):>6}")
    print(f"  existing events  {len(existing):>6}")

    kalk_by_pk = {k["PrimaryKey"]: k for k in kalk}
    batch_by_pk = {b["PrimaryKey"]: b for b in batches}
    seen_keys = {e.get("KeyEvent") for e in existing if e.get("KeyEvent")}

    posted = {pk for pk, k in kalk_by_pk.items() if k.get("Status") == POSTED_STATUS}

    seeds, notes = [], defaultdict(list)
    lines_per_batch = defaultdict(int)

    for line in lines:
        batch_pk = line.get("PrimaryKey")
        kalk_pk = line.get("ForeignKeyKalkulacijaID")
        lines_per_batch[batch_pk] += 1

        header = kalk_by_pk.get(kalk_pk)
        if header is None:
            notes["orphan_line"].append(batch_pk)
            continue
        if kalk_pk not in posted:
            notes["unposted"].append(f"{header.get('BrojKalkulacije')} / {batch_pk}")
            continue

        batch = batch_by_pk.get(batch_pk)
        if batch is None:
            notes["no_batch"].append(f"{header.get('BrojKalkulacije')} / {batch_pk}")
            continue

        broj = header.get("BrojKalkulacije") or ""
        datum = header.get("DatumKalkulacije")
        if not datum:
            notes["no_date"].append(broj)
            continue

        pdv = num(line.get("PDVPostotak"))
        if broj in VAT_OVERRIDES:
            if pdv != VAT_OVERRIDES[broj]:
                notes["vat_override"].append(f"{broj} / {batch_pk}: {pdv} -> {VAT_OVERRIDES[broj]}")
            pdv = VAT_OVERRIDES[broj]

        cost = effective_cost(
            num(batch.get("NabavnaCijenaStavke")),
            num(line.get("RabatPostotak")),
            num(line.get("ZavisniTroskovi")),
        )
        cijena = round(num(batch.get("ProdajnaCijena")), MONEY_DP)

        if cijena == 0:
            notes["zero_price"].append(f"{broj} / {batch_pk}")
        if cost == 0:
            notes["zero_cost"].append(f"{broj} / {batch_pk}")

        seeds.append({
            "batch_pk": batch_pk,
            "key_event": f"{batch_pk}|{IZVOR_TIP}|{kalk_pk}",
            "event": {
                "ForeignKeyStavkaPrimkeID": batch_pk,
                "ForeignKeyArtikalID": batch.get("ForeignKeyArtikalID") or "",
                "VaziOd": datum,
                "TipPrioritet": TIP_PRIORITET,
                "Cijena": cijena,
                "PDVPostotak": pdv,
                "NabavnaCijenaEfektivna": cost,
                "IzvorTip": IZVOR_TIP,
                "IzvorID": kalk_pk,
                "IzvorBroj": broj,
            },
            "patch": {
                "PDVPostotak_Trenutni": pdv,
                "NabavnaCijenaEfektivna": cost,
            },
            "current": {
                "PDVPostotak_Trenutni": batch.get("PDVPostotak_Trenutni"),
                "NabavnaCijenaEfektivna": batch.get("NabavnaCijenaEfektivna"),
            },
            "broj": broj,
        })

    for batch_pk, count in lines_per_batch.items():
        if count > 1:
            notes["multi_line_batch"].append(f"{batch_pk} x{count}")

    seeds.sort(key=lambda s: (s["event"]["VaziOd"], s["event"]["IzvorBroj"], s["batch_pk"]))
    if limit:
        seeds = seeds[:limit]

    drift = drift_report(kalk_by_pk, posted, lines, batch_by_pk)
    return seeds, notes, seen_keys, drift


def drift_report(kalk_by_pk, posted, lines, batch_by_pk):
    """
    Diagnostic only — this script fixes nothing here.

    KalkulacijaMP.UkupnoMP_Roba is a STORED total written by KMP__RefreshTotals at
    posting time, while the line-level retail figures are unstored calcs reading
    StavkePrimke::ProdajnaCijena live. Where the two disagree, that kalkulacija has
    already drifted away from the document that was printed and filed — which is
    exactly the exception list KMP__FreezeBackfill will need.
    """
    recomputed = defaultdict(float)
    for line in lines:
        kalk_pk = line.get("ForeignKeyKalkulacijaID")
        if kalk_pk not in posted:
            continue
        batch = batch_by_pk.get(line.get("PrimaryKey"))
        if batch is None:
            continue
        recomputed[kalk_pk] += num(batch.get("Kolicina")) * num(batch.get("ProdajnaCijena"))

    out = []
    for kalk_pk in posted:
        header = kalk_by_pk[kalk_pk]
        stored = num(header.get("UkupnoMP_Roba"))
        live = round(recomputed.get(kalk_pk, 0.0), 2)
        if abs(stored - live) > 0.01:
            out.append({
                "broj": header.get("BrojKalkulacije"),
                "datum": header.get("DatumKalkulacije"),
                "stored": round(stored, 2),
                "live": live,
                "delta": round(live - stored, 2),
            })
    out.sort(key=lambda r: abs(r["delta"]), reverse=True)
    return out


# ------------------------------------------------------------------------ apply


def apply(base, token, seeds, seen_keys):
    patched = skipped_patch = inserted = skipped_event = 0
    failures = []

    for i, seed in enumerate(seeds, 1):
        want = seed["patch"]
        have = seed["current"]
        delta = {
            k: v for k, v in want.items()
            if have.get(k) is None or abs(num(have.get(k)) - v) > 1e-9
        }
        if delta:
            status, payload = request(
                base, token, "PATCH",
                f"/StavkePrimke({quote_key(seed['batch_pk'])})", delta,
            )
            if status in (200, 204):
                patched += 1
            else:
                failures.append(("PATCH", seed["batch_pk"], status, payload.get("error")))
        else:
            skipped_patch += 1

        if seed["key_event"] in seen_keys:
            skipped_event += 1
        else:
            status, payload = request(base, token, "POST", "/CijeneStavki", seed["event"])
            if status in (200, 201):
                inserted += 1
                seen_keys.add(seed["key_event"])
            else:
                failures.append(("POST", seed["batch_pk"], status, payload.get("error")))

        if i % 50 == 0 or i == len(seeds):
            print(f"  {i}/{len(seeds)}  patched={patched} inserted={inserted} "
                  f"skipped={skipped_patch + skipped_event} failed={len(failures)}")

    return patched, skipped_patch, inserted, skipped_event, failures


# ------------------------------------------------------------------------- main


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true",
                    help="write to FileMaker (default is a dry run)")
    ap.add_argument("--limit", type=int,
                    help="process only the first N seed rows (smoke test)")
    ap.add_argument("--log", default="plans/schema/niv-seed-log.md")
    args = ap.parse_args()

    base, token = load_odata()
    seeds, notes, seen_keys, drift = build(base, token, args.limit)

    already = sum(1 for s in seeds if s["key_event"] in seen_keys)
    print(f"\nSeed rows ready: {len(seeds)}  ({already} already have an event)")

    labels = {
        "unposted": "lines on kalkulacije that are not Knjižena (excluded)",
        "no_batch": "kalkulacija lines with no matching StavkePrimke (excluded)",
        "orphan_line": "lines whose kalkulacija header is missing (excluded)",
        "no_date": "posted kalkulacije with no DatumKalkulacije (excluded)",
        "zero_price": "seeded with ProdajnaCijena = 0",
        "zero_cost": "seeded with effective cost = 0",
        "multi_line_batch": "batches with more than one kalkulacija line (PK-extension violation)",
        "vat_override": "VAT overrides applied (filed document wins)",
    }
    print("\nNotes")
    for key, label in labels.items():
        rows = notes.get(key, [])
        if rows:
            print(f"  {len(rows):>5}  {label}")
            for row in rows[:5]:
                print(f"         - {row}")
            if len(rows) > 5:
                print(f"         … and {len(rows) - 5} more")

    print(f"\nDrift diagnostic (for KMP__FreezeBackfill, not fixed here): "
          f"{len(drift)} posted kalkulacija(e) where Σ(lines) ≠ stored UkupnoMP_Roba")
    for row in drift[:10]:
        print(f"  {row['broj']:<12} {row['datum']}  stored {row['stored']:>10.2f}  "
              f"live {row['live']:>10.2f}  Δ {row['delta']:>+10.2f}")
    if len(drift) > 10:
        print(f"  … and {len(drift) - 10} more")

    if not args.apply:
        print("\nDRY RUN — nothing written. Re-run with --apply to seed.")
        write_log(args.log, seeds, notes, drift, applied=None)
        return 0

    print(f"\nApplying to {len(seeds)} batches …")
    patched, skipped_patch, inserted, skipped_event, failures = apply(
        base, token, seeds, seen_keys
    )
    print(f"\nStavkePrimke: {patched} patched, {skipped_patch} already correct")
    print(f"CijeneStavki: {inserted} inserted, {skipped_event} already present")
    if failures:
        print(f"\n{len(failures)} FAILURES:")
        for op, pk, status, err in failures[:20]:
            print(f"  {op} {pk} [{status}] {err}")
        if len(failures) > 20:
            print(f"  … and {len(failures) - 20} more")

    write_log(args.log, seeds, notes, drift,
              applied=(patched, skipped_patch, inserted, skipped_event, failures))
    return 1 if failures else 0


def write_log(path, seeds, notes, drift, applied):
    out = ROOT / path
    out.parent.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    lines = [
        "# Nivelacija — Price Event Seed Log", "",
        f"Run: {stamp}",
        f"Mode: {'APPLY' if applied else 'DRY RUN'}",
        f"Seed rows: {len(seeds)}", "",
        "## Notes", "",
        "| Count | Note |", "|---:|---|",
    ]
    for key, rows in sorted(notes.items()):
        lines.append(f"| {len(rows)} | {key} |")
    if applied:
        patched, skipped_patch, inserted, skipped_event, failures = applied
        lines += [
            "", "## Applied", "",
            f"- StavkePrimke patched: {patched} (already correct: {skipped_patch})",
            f"- CijeneStavki inserted: {inserted} (already present: {skipped_event})",
            f"- Failures: {len(failures)}",
        ]
        for op, pk, status, err in failures[:50]:
            lines.append(f"  - {op} `{pk}` [{status}] {err}")
    lines += [
        "", "## Drift diagnostic", "",
        "Posted kalkulacije where the sum of live line values no longer matches the",
        "stored `UkupnoMP_Roba` written at posting time. These are already out of step",
        "with the filed PDF; resolve them with the accountant before `KMP__FreezeBackfill`",
        "freezes today's values permanently.", "",
        "| Kalkulacija | Datum | Stored | Live | Δ |", "|---|---|---:|---:|---:|",
    ]
    for row in drift:
        lines.append(f"| {row['broj']} | {row['datum']} | {row['stored']:.2f} | "
                     f"{row['live']:.2f} | {row['delta']:+.2f} |")
    out.write_text("\n".join(lines) + "\n")
    print(f"\nLog written: {path}")


if __name__ == "__main__":
    sys.exit(main())
