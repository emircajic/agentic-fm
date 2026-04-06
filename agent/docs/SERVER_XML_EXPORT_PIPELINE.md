# Server XML Export Pipeline

## Goal

Move the slow FileMaker XML assembly step to the server while keeping the existing local explode step:

1. FileMaker Server assembles the XML export.
2. Server stores the XML in a container field.
3. Local machine downloads the finished XML.
4. Local machine runs `fmparse.sh`.

This avoids:
- public IIS file exposure
- FileMaker script-result size limits
- unnecessary reimplementation of the local explode toolchain

## Recommended Table

Create a small transport table, for example `AgentExports`.

Suggested fields:

- `PrimaryKey`
  - Text, UUID
- `Type`
  - Text
  - Example: `xml_export`
- `Solution`
  - Text
  - Example: `Autoklinika`
- `Status`
  - Text
  - Values: `pending`, `assembling`, `ready`, `failed`, `consumed`
- `Filename`
  - Text
  - Example: `Autoklinika.xml`
- `Payload`
  - Container
  - Holds the generated XML file
- `CreatedAt`
  - Timestamp
- `CreatedBy`
  - Text
- `Error`
  - Text
- `Bytes`
  - Number
- `Sha256`
  - Text
- `ConsumedAt`
  - Timestamp

Optional:

- `RequestedBy`
- `HostName`
- `JobNote`

## Status Model

Use a simple job lifecycle:

- `pending`
  - local side requested export
- `assembling`
  - PSOS/server script is building XML
- `ready`
  - payload is available for download
- `failed`
  - export failed; inspect `Error`
- `consumed`
  - local side downloaded successfully

## Server Script Design

Create a server script, for example:

- `AGENT__QueueXMLExport`
- `AGENT__BuildXMLExport`

### `AGENT__QueueXMLExport`

Purpose:
- create export-job record
- launch PSOS worker
- return job id

Input JSON:

```json
{
  "solution": "Autoklinika",
  "requested_by": "emir"
}
```

Output JSON:

```json
{
  "ok": true,
  "job_id": "UUID",
  "status": "pending"
}
```

Suggested steps:

1. Create record in `AgentExports`
2. Set:
   - `Type = "xml_export"`
   - `Solution`
   - `Status = "pending"`
   - `Filename = Solution & ".xml"`
3. Store `PrimaryKey` in `$jobId`
4. Perform Script on Server:
   - `AGENT__BuildXMLExport`
   - parameter `{ "job_id": "...", "solution": "..." }`
5. Exit script with `job_id`

### `AGENT__BuildXMLExport`

Purpose:
- assemble XML on server
- import/set XML into `AgentExports::Payload`
- set status to `ready` or `failed`

Input JSON:

```json
{
  "job_id": "UUID",
  "solution": "Autoklinika"
}
```

Suggested steps:

1. Find export record by `job_id`
2. Set `Status = "assembling"`
3. Use BaseElements to generate/save XML to a temporary server path
4. Insert/import that temporary file into `AgentExports::Payload`
5. Set:
   - `Bytes`
   - optional `Sha256`
   - `Status = "ready"`
6. Delete temp file from disk
7. On error:
   - set `Status = "failed"`
   - write `Error`

## Temporary File Handling

Do not write directly to a public IIS-served location.

Use a private temp folder on the server, for example:

- a locked application-data folder
- a private temp/export folder outside public web root

Pattern:

1. BaseElements writes XML to private temp path
2. FileMaker imports file into container
3. BaseElements deletes temp file

That keeps the XML publicly inaccessible.

## Local Download Flow

Local workflow should become:

1. Trigger `AGENT__QueueXMLExport`
2. Poll the `AgentExports` record until:
   - `Status = "ready"`
   - or `Status = "failed"`
3. Download the container payload locally
4. Save as `Autoklinika.xml`
5. Run existing parse step:

```bash
./fmparse.sh Autoklinika /path/to/Autoklinika.xml
```

6. Optionally mark job `consumed`

## Local Polling API Shape

The local helper can use either:

- OData if the export table is exposed safely
- Data API / script bridge

Recommended returned JSON:

```json
{
  "job_id": "UUID",
  "solution": "Autoklinika",
  "status": "ready",
  "filename": "Autoklinika.xml",
  "bytes": 16777216,
  "sha256": "..."
}
```

## Retention Policy

Do not keep every export forever.

Recommended policy:

- keep latest 5 successful XML export jobs per solution
- keep failed jobs for troubleshooting for a short period
- purge old payloads automatically

Example cleanup script:

- `AGENT__CleanupExports`

Rules:

- keep newest `ready`/`consumed` records
- delete older container payloads or whole records

## Safety Notes

- Do not expose the XML file through IIS public paths.
- Do not send the full XML through script result.
- Prefer container transport over text/base64 transport.
- Keep the export table scoped to admin/developer privileges only.
- If possible, hash the payload after write so the local side can verify integrity.

## Minimal First Version

Start with the smallest useful version:

1. Create `AgentExports` table
2. Create `AGENT__QueueXMLExport`
3. Create `AGENT__BuildXMLExport`
4. Store XML in `Payload`
5. Download locally
6. Run current `fmparse.sh`

Do not move explode to the server yet.

The current local explode is already fast enough, so the first optimization should target only XML assembly.

## Future Improvements

After the first version works, consider:

- hashing payloads
- diff-aware local fetch
- incremental export jobs
- per-solution retention cleanup
- optional server-side explode only if it proves useful later
