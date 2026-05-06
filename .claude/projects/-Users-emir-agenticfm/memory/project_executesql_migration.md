---
name: ExecuteSQL → epSQLExecute migration
description: Planned migration of 40 ExecuteSQL calls across 25 scripts to epSQLExecute; deferred until KMP flow redesign is complete
type: project
---

Migration of all native `ExecuteSQL` calls to `epSQLExecute` is planned but deliberately deferred.

**Why:** KMP flow is being redesigned; introducing SQL changes mid-redesign risks masking or creating new errors in actively changing scripts.

**How to apply:** Resume this after KMP redesign is stable. Do not start partial migrations in the meantime.

## Agreed approach (when we resume)

- `epSQLExecute` replaces `ExecuteSQL` everywhere — better error strings, INSERT/UPDATE support
- `GetFieldName()` selectively for rename safety on PKs/FKs only — not wholesale
- Named result sets (`useSQLResult=stavke`) for any script with multi-query loops
- **No `epFMNameID`** — tokenization overhead in FM text processing makes it a net burden
- **No wrapper script** — each migration is self-contained; a wrapper adds indirection without enough saving
- Tier 1 scripts (`KMP__RefreshTotals`, `DP__RefreshTotals`, `TK__GetDonos`) need query splitting before migration due to the JOIN ≤3-column limit in epSQL

## Audit results (40 calls, 25 scripts)

Tier 1 — financial aggregates, complex JOINs (migrate carefully, query splitting likely needed):
- `KMP__RefreshTotals`, `DP__RefreshTotals`, `TK__GetDonos`, `DB__ConsumePreYearStock`, `S__Knjiženje`

Tier 2 — pagination and utility:
- `ExecuteSQL_ToJSON`, `GenericSearch`, `GetPaginatedData`, `GetVehicles`

Tier 3 — simple lookups and client list scripts:
- `SP__SetProdajnaCijena`, `UFD__AttachFromPrimka`, `UFD__Remove`, `SO__NapraviNoviInvoice`, `LoadClientPage`, `LoadClientPicker`, `BuildClientListJSON`, `GenerateClientSelectOptions`, `Lista imena`, and others
