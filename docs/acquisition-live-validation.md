# Acquisition V1 local runtime and one-call validation

This is a manually authorized server-side validation procedure. It does not grant a CALL-E result authority, does not apply a review, and does not create external business effects. Use only a recipient who has explicitly consented to the call.

## Server configuration

The acquisition server recognizes these server-only environment variables:

| Variable | Purpose | Fail-closed behavior |
| --- | --- | --- |
| `CALLE_API_KEY` | CALL-E server credential | Read lazily only after local policy accepts a call |
| `ACQUISITION_LIVE_ENABLED` | Explicit live-call switch | Anything except `true` disables calls |
| `ACQUISITION_ALLOWED_DEMO_TOKENS` | Comma-separated trusted demo tokens | Empty means no client is allowed |
| `ACQUISITION_RECIPIENT_ALLOWLIST` | Comma-separated E.164 recipients | When set, all other recipients are denied |
| `ACQUISITION_PER_CLIENT_DAILY_LIMIT` | Daily calls per demo token | Defaults to `1` |
| `ACQUISITION_GLOBAL_DAILY_LIMIT` | Daily calls for this store | Defaults to `1` |
| `ACQUISITION_COOLDOWN_MS` | Minimum delay between acquisitions | Defaults to `60000` |
| `ACQUISITION_STORE_PATH` | Durable JSON record path | Defaults to `.acquisition-data/acquisitions.json` |
| `ACQUISITION_SERVER_PORT` | Local HTTP port | Defaults to `8787` |

`ACQUISITION_SERVER_HOST` optionally changes the safe `127.0.0.1` bind default. `ACQUISITION_STATIC_ROOT` optionally changes the built frontend directory from `dist`.

Never place `CALLE_API_KEY`, demo tokens, or recipient numbers in `VITE_*` variables. Never commit an `.env` file containing them.

## One manually authorized acquisition

Use a fresh PowerShell session and placeholder-free values entered interactively. These commands intentionally enforce one global call and one call for the chosen token.

### 1. Configure and start the acquisition server

```powershell
$env:CALLE_API_KEY = Read-Host 'CALL-E API key' -MaskInput
$env:ACQUISITION_ALLOWED_DEMO_TOKENS = Read-Host 'One strong demo token' -MaskInput
$env:ACQUISITION_RECIPIENT_ALLOWLIST = Read-Host 'One authorized recipient in E.164 format' -MaskInput
$env:ACQUISITION_LIVE_ENABLED = 'true'
$env:ACQUISITION_PER_CLIENT_DAILY_LIMIT = '1'
$env:ACQUISITION_GLOBAL_DAILY_LIMIT = '1'
$env:ACQUISITION_COOLDOWN_MS = '60000'
$env:ACQUISITION_STORE_PATH = '.acquisition-data/acquisitions.json'
$env:ACQUISITION_SERVER_PORT = '8787'
npm run acquisition:server
```

The server prints only its local address and whether live policy is enabled. It does not print credentials, tokens, recipients, or provider payloads.

### 2. Start Vite in a second terminal

```powershell
$env:ACQUISITION_SERVER_PORT = '8787'
npm run dev -- --port 5173 --strictPort
```

Vite proxies `/api/*` to the local acquisition server. The current Slice A frontend does not initiate acquisition; Slice B is intentionally absent.

### 3. Create exactly one acquisition from a third terminal

Enter the same token and recipient without echoing them, construct one explicit logical request, and submit it once:

```powershell
$demoToken = Read-Host 'Same strong demo token' -MaskInput
$authorizedPhone = Read-Host 'Same authorized E.164 recipient' -MaskInput
$acquisitionId = 'ACQ-MANUAL-LIVE-V1-001'
$requestId = 'REQUEST-MANUAL-LIVE-V1-001'
$createdAt = (Get-Date).ToUniversalTime().ToString('o')
$body = @{
  acquisitionId = $acquisitionId
  clientToken = $demoToken
  authorizationConfirmed = $true
  phoneNumber = $authorizedPhone
  request = @{
    requestId = $requestId
    caseId = 'CASE-MANUAL-LIVE-V1'
    planId = 'PLAN-MANUAL-LIVE-V1'
    actorId = 'ACTOR-MANUAL-LIVE-CLIENT'
    actorRole = 'client'
    objective = 'Obtain exactly one explicit decision about this synthetic test proposal.'
    context = 'Synthetic test only. Choose APPROVED, REJECTED, PENDING, or NEEDS_CLARIFICATION. No real customer authority or external business effect is claimed.'
    expectedDecisionSchema = @{ name = 'exception-broker-phone-decision'; version = 1 }
    createdAt = $createdAt
  }
} | ConvertTo-Json -Depth 8
$created = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:5173/api/acquisitions' -ContentType 'application/json' -Body $body
$created.record | Select-Object acquisitionId, maskedRecipient, status, normalizationStatus, handoffState
```

Do not resubmit changed content under the same acquisition ID. An exact retry of the same create request reuses the same persisted CALL-E idempotency key.

### 4. Refresh one provider state at a time

Each request below performs at most one CALL-E `get` and never creates a call. Repeat deliberately until the status is `completed`, `failed`, or `canceled`:

```powershell
$headers = @{ 'x-acquisition-demo-token' = $demoToken }
$current = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:5173/api/acquisitions/$acquisitionId/refresh" -Headers $headers
$current.record | Select-Object acquisitionId, status, normalizationStatus, safeStopReason, handoffState
```

Stop if the API reports a provider failure, access failure, or unexpected response. Do not rotate the acquisition ID or retry call creation merely to obtain a preferred result.

### 5. Inspect only the sanitized durable record

```powershell
$record = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:5173/api/acquisitions/$acquisitionId" -Headers $headers
$record | ConvertTo-Json -Depth 12
```

The response contains the masked recipient and sanitized acquisition evidence, not the API key, raw demo token, full recipient phone, raw CALL-E payload, review, or application result.

After validation, stop both servers and clear sensitive session values:

```powershell
Remove-Item Env:CALLE_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:ACQUISITION_ALLOWED_DEMO_TOKENS -ErrorAction SilentlyContinue
Remove-Item Env:ACQUISITION_RECIPIENT_ALLOWLIST -ErrorAction SilentlyContinue
Remove-Variable demoToken, authorizedPhone, body -ErrorAction SilentlyContinue
```
