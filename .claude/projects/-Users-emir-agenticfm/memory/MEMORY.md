# Memory Index

- [Script Framework](project_framework.md) — Orchestrator/Pure Function pattern, Response_* CFs, Params.parse, Log.add, trace ID system
- [Response envelope framework](feedback_response_envelope.md) — Params.parse, Response_*, Log.add, UTIL__FlushLog pattern used in all scripts
- [epSQL plugin — usage rules and gotchas](feedback_sql_plugin.md) — preferred over native ExecuteSQL; UPDATE/DELETE support; 0-based epSQLResult indexing; commit-before-UPDATE rule
- [FM gotchas confirmed in practice](feedback_fm_gotchas.md) — Loop XML FlushType, portal TO vs base TO, SQL date literals, JSON pipe keys, IS NOT NULL bug
- [UFD workflow — architecture and scripts](project_ufd_workflow.md) — UFD→KMP→Ledger chain, price locks, state machines, script IDs, layout TO mapping
