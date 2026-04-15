# Record Locking in Multi-User Environments

**NOTE:** Items marked with **(step)** are script steps. Items marked with **(function)** are calculation functions used inside expressions.

## The Locking Model

FileMaker uses **optimistic record-level locking**. A record exists in one of two states:

- **Committed** — not being edited, no write lock, any client can read it.
- **Open (in edit mode)** — a client holds the write lock. No other client can open the same record for editing until the lock is released.

A record enters edit mode when:

- A user clicks into a field on a layout **and modifies the field contents**
- A script executes `Open Record/Request` **(step)**
- A script executes `Set Field` **(step)** (implicitly opens the record)
- A script executes an `Insert` step that modifies field data
- A portal row is modified

The write lock is released when:

- A script executes `Commit Records/Requests` **(step)**
- A script executes `Revert Record/Request` **(step)**
- The open record is navigated off of (e.g. previous/next buttons, entering Find mode, or any action that leaves the record)
- The user's session disconnects

## The Error Codes

| Code | Meaning                                 | Context                                                                   |
| ---- | --------------------------------------- | ------------------------------------------------------------------------- |
| 301  | Record is in use by another user        | `Open Record/Request`, `Set Field` on a locked record                     |
| 306  | Record modification ID does not match   | Record was modified by another process between open and commit            |
| 307  | Transaction could not be locked (comms) | Communication error with host while acquiring a transaction lock          |
| 512  | Record was already modified by another  | Validation-category error surfaced by concurrent modification of a record |

Error 301 is the classic locking error — another client holds the write lock. Error 306 is subtler: between opening and committing, another process modified and committed the same record, causing a modification ID mismatch. Error 307 can surface when using `Open Transaction` **(step)** over unreliable network connections. Error 512 is a validation-layer variant of the concurrent modification problem. All are silent when `Set Error Capture [ On ]` **(step)** is active and `Get ( LastError )` is not checked.

## The Silent Failure Problem

When `Set Error Capture [ On ]` suppresses dialogs and the script does not check `Get ( LastError )` after record-modifying steps, a locked record causes `Set Field` to fail silently. The script continues as though the write succeeded. The data is never written. This is particularly dangerous for financial transactions, inventory adjustments, and status changes that trigger downstream processes.

`Set Field` **(step)** implicitly opens the record if it is not already open. If another client holds the lock, `Set Field` fails with error 301. With error capture on, the failure is invisible. A related-table `Set Field` (`Set Field [ relatedTable::field ; value ]`) can also fail this way if the related record is locked.

## Record Modification Count

If a `Set Field` succeeds and the record is subsequently committed, the record's internal modification counter increments. `Get ( RecordModificationCount )` **(function)** can be compared before and after a sequence of operations to determine whether the record was actually modified. This is useful as a secondary verification that a commit changed data.

## Core Pattern: Check After Every Fallible Step

This pattern uses a single-pass loop (see `single-pass-loop.md`) so that any failure exits cleanly to shared cleanup after `End Loop`.

```
Set Error Capture [ On ]
#
Loop
    #
    Open Record/Request
    Set Variable [ $errData ; JSONSetElement ( "{}" ;
        [ "lastError" ; Get ( LastError ) ; JSONNumber ] ;
        [ "lastErrorDetail" ; Get ( LastErrorDetail ) ; JSONString ] ;
        [ "lastErrorLocation" ; Get ( LastErrorLocation ) ; JSONString ]
    ) ]
    Exit Loop If [ JSONGetElement ( $errData ; "lastError" ) ≠ 0 ]
    #
    Set Field [ Table::field ; "value" ]
    Set Variable [ $errData ; JSONSetElement ( "{}" ;
        [ "lastError" ; Get ( LastError ) ; JSONNumber ] ;
        [ "lastErrorDetail" ; Get ( LastErrorDetail ) ; JSONString ] ;
        [ "lastErrorLocation" ; Get ( LastErrorLocation ) ; JSONString ]
    ) ]
    Exit Loop If [ JSONGetElement ( $errData ; "lastError" ) ≠ 0 ]
    #
    Commit Records/Requests [ With dialog: Off ]
    Set Variable [ $errData ; JSONSetElement ( "{}" ;
        [ "lastError" ; Get ( LastError ) ; JSONNumber ] ;
        [ "lastErrorDetail" ; Get ( LastErrorDetail ) ; JSONString ] ;
        [ "lastErrorLocation" ; Get ( LastErrorLocation ) ; JSONString ]
    ) ]
    Exit Loop If [ JSONGetElement ( $errData ; "lastError" ) ≠ 0 ]
    #
    Set Variable [ $isSuccess ; True ]
    Exit Loop If [ True ]
End Loop
#
If [ not $isSuccess ]
    Revert Record/Request [ With dialog: Off ]
    # Handle error — $errData contains the failure details
End If
```

Error data must be captured in a **single `JSONSetElement` expression** immediately after the risky step — see `error-data-capture.md` for the rationale and the three-function timing constraint.

## Retry Logic for Transient Locks

Error 301 is often transient — the other client releases the lock within moments. Automatic retry with backoff is appropriate for 301 but **not** for 306 (modification ID mismatch), which indicates a genuine data conflict requiring resolution logic.

```
Set Variable [ $maxRetries ; 3 ]
Set Variable [ $retryCount ; 0 ]
Set Variable [ $isSuccess ; False ]
#
Loop
    Exit Loop If [ $retryCount ≥ $maxRetries ]
    #
    Open Record/Request
    Set Variable [ $err ; Get ( LastError ) ]
    #
    If [ $err = 0 ]
        Set Variable [ $isSuccess ; True ]
        Exit Loop If [ True ]
    Else If [ $err = 301 ]
        # Transient lock — wait and retry with exponential backoff
        Set Variable [ $retryCount ; $retryCount + 1 ]
        Pause/Resume Script [ Duration (seconds): .25 * ( 2 ^ $retryCount ) ]
    Else
        # Non-locking error — do not retry
        Exit Loop If [ True ]
    End If
End Loop
```

## Multi-Record Transactions

The modern path for modifying multiple records atomically is `Open Transaction` **(step)** paired with `Commit Transaction`. Within a transaction block, multiple records can be opened, modified, and committed together — if any step fails, the entire transaction can be rolled back.

`Open Record/Request` **(step)** has no options — it is a self-closing step that simply attempts to acquire the write lock on the current record. Within an `Open Transaction` block, each `Open Record/Request` call adds that record to the transaction scope. If any record cannot be locked, the developer can revert the entire transaction.

**Important:** outside of an `Open Transaction` block, there is no native multi-record rollback. If Record A commits successfully and Record B's commit fails, Record A's changes are permanent. This is why `Open Transaction` is the preferred approach for coordinated multi-record writes.

## Audit Logging with OnWindowTransaction

`OnWindowTransaction` is a **file-level script trigger** (introduced in FM 20.1) that fires after a transaction is successfully committed. It creates a JSON object containing the file name, base table name, record ID, operation type ("New", "Modified", or "Deleted"), and the contents of a designated payload field for every operation within the completed transaction.

Key behaviors:

- Fires after the commit, not before — the data is already written when the trigger runs.
- Covers **all tables in the file** where the trigger is enabled — you cannot filter by table at the trigger level (filter in the processor script instead).
- The **payload field** (default name `onWindowTransaction`, configurable) should be an unstored calculation set to "evaluate always" that returns JSON with pertinent record data. Keep it lean — this evaluates on every record modification.
- The processor script runs at the **end of the script stack**.
- **Do not log to a table in the same file** — this creates recursive trigger invocations. Use a separate log file.
- `Truncate Table` does not fire the trigger. Imports do.
- FileMaker Data API and OData calls do not directly fire OnWindowTransaction, but scripts invoked by Data API or OData can trigger it.
- Performance impact is small for individual operations (~2,500 microseconds per record) and drops further (~700 microseconds) when operations are batched inside an `Open Transaction` / `Commit Transaction` block.

For full documentation, see the [Claris help for OnWindowTransaction](https://help.claris.com/en/pro-help/content/onwindowtransaction.html).

## Design Principles

- **Minimize open-record duration.** Compute values in variables before opening the record, then set fields and commit quickly.
- **Optionally use card windows for editing.** The record opens when the card opens, commits when it closes — the main layout context stays committed.
- **Separate read and write contexts.** List views should be read-only; editing happens in a card or detail layout via explicit action.
- **Accumulate input in globals or variables.** Write to the record only at the point of confirmed submission.
- **Run batch processes off-hours** when possible. When not possible, minimize lock duration and implement retry logic.
- **Log every failure in server-side scripts.** PSOS and scheduled scripts have no UI — write failures to a log table with record ID, timestamp, and error code.

## References

| Name                            | Type     | Local doc                                                           | Claris help                                                                                                 |
| ------------------------------- | -------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Set Error Capture               | step     | `agent/docs/filemaker/script-steps/set-error-capture.md`            | [set-error-capture](https://help.claris.com/en/pro-help/content/set-error-capture.html)                     |
| Open Record/Request             | step     | `agent/docs/filemaker/script-steps/open-record-request.md`          | [open-record-request](https://help.claris.com/en/pro-help/content/open-record-request.html)                 |
| Set Field                       | step     | `agent/docs/filemaker/script-steps/set-field.md`                    | [set-field](https://help.claris.com/en/pro-help/content/set-field.html)                                     |
| Commit Records/Requests         | step     | `agent/docs/filemaker/script-steps/commit-records-requests.md`      | [commit-records-requests](https://help.claris.com/en/pro-help/content/commit-records-requests.html)         |
| Revert Record/Request           | step     | `agent/docs/filemaker/script-steps/revert-record-request.md`        | [revert-record-request](https://help.claris.com/en/pro-help/content/revert-record-request.html)             |
| Open Transaction                | step     | `agent/docs/filemaker/script-steps/open-transaction.md`             | [open-transaction](https://help.claris.com/en/pro-help/content/open-transaction.html)                       |
| Commit Transaction              | step     | `agent/docs/filemaker/script-steps/commit-transaction.md`           | [commit-transaction](https://help.claris.com/en/pro-help/content/commit-transaction.html)                   |
| Pause/Resume Script             | step     | `agent/docs/filemaker/script-steps/pause-resume-script.md`          | [pause-resume-script](https://help.claris.com/en/pro-help/content/pause-resume-script.html)                 |
| Get ( LastError )               | function | `agent/docs/filemaker/functions/get/get-lasterror.md`               | [get-lasterror](https://help.claris.com/en/pro-help/content/get-lasterror.html)                             |
| Get ( LastErrorLocation )       | function | `agent/docs/filemaker/functions/get/get-lasterrorlocation.md`       | [get-lasterrorlocation](https://help.claris.com/en/pro-help/content/get-lasterrorlocation.html)             |
| Get ( LastErrorDetail )         | function | `agent/docs/filemaker/functions/get/get-lasterrordetail.md`         | [get-lasterrordetail](https://help.claris.com/en/pro-help/content/get-lasterrordetail.html)                 |
| Get ( RecordModificationCount ) | function | `agent/docs/filemaker/functions/get/get-recordmodificationcount.md` | [get-recordmodificationcount](https://help.claris.com/en/pro-help/content/get-recordmodificationcount.html) |
| OnWindowTransaction             | trigger  | —                                                                   | [onwindowtransaction](https://help.claris.com/en/pro-help/content/onwindowtransaction.html)                 |
