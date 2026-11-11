$ErrorActionPreference = 'Stop'
$http = $null

try {
    # Codex sends UTF-8 JSON. Select only lifecycle metadata from that input.
    $stdin = [IO.StreamReader]::new([Console]::OpenStandardInput(), [Text.Encoding]::UTF8)
    $json = $stdin.ReadToEnd()
    $stdin.Dispose()
    $event = ConvertFrom-Json -InputObject $json -NoEnumerate
    if ($event -isnot [pscustomobject] -or $event.hook_event_name -isnot [string]) {
        return
    }
    switch -CaseSensitive ($event.hook_event_name) {
        'SubagentStart' { $kind = 'started' }
        'SubagentStop' { $kind = 'stopped' }
        default { return }
    }
    $idPattern = '\A[A-Za-z0-9._:-]{1,128}\z'
    foreach ($id in @($event.session_id, $event.agent_id)) {
        if ($id -isnot [string] -or $id -cnotmatch $idPattern) {
            return
        }
    }
    $turnId = $event.turn_id
    if ($null -ne $turnId -and ($turnId -isnot [string] -or $turnId -cnotmatch $idPattern)) {
        return
    }
    if ($event.agent_type -isnot [string] -or [string]::IsNullOrWhiteSpace($event.agent_type) -or
        $event.agent_type -notmatch '\A(?:[^\p{C}\p{Z}]| ){1,80}\z') {
        return
    }

    $service = 'agent-office-codex-report'
    $headerPath = Join-Path $env:LOCALAPPDATA "$service\headers\codex-hook.header"
    if (-not (Test-Path -LiteralPath $headerPath -PathType Leaf)) {
        return
    }

    Add-Type -AssemblyName System.Net.Http
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.UseProxy = $false
    $handler.AllowAutoRedirect = $false
    $http = [Net.Http.HttpClient]::new($handler)
    $http.Timeout = [TimeSpan]::FromMilliseconds(650)
    $url = 'http://127.0.0.1:8794'
    $health = ConvertFrom-Json -InputObject $http.GetStringAsync("$url/health").GetAwaiter().GetResult()
    if ($health.ok -isnot [bool] -or -not $health.ok -or
        $health.service -cne $service -or $health.evidenceType -cne 'bot-self-report' -or
        $health.codexActivity -isnot [bool] -or -not $health.codexActivity) {
        return
    }

    $line = [IO.File]::ReadAllText($headerPath)
    if ($line -cnotmatch '\AAuthorization: Bearer ([A-Za-z0-9_-]{43})(?:\r?\n)?\z') {
        return
    }
    $http.DefaultRequestHeaders.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $Matches[1])

    # Hash a tuple so retries are idempotent and a later turn can report a new stop.
    $identity = ConvertTo-Json -InputObject @($kind, $event.session_id, $event.agent_id, $turnId) -Compress
    $hasher = [Security.Cryptography.SHA256]::Create()
    $digest = $hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($identity))
    $hasher.Dispose()
    $body = ConvertTo-Json -Compress -InputObject @{
        eventId = 'hook-' + [BitConverter]::ToString($digest).Replace('-', '').ToLowerInvariant()
        kind = $kind
        sessionId = $event.session_id
        agentId = $event.agent_id
        agentType = $event.agent_type
        turnId = $turnId
    }

    for ($attempt = 0; $attempt -lt 2; $attempt++) {
        $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post, "$url/api/codex-activity")
        $request.Content = [Net.Http.StringContent]::new($body, [Text.Encoding]::UTF8, 'application/json')
        try {
            $response = $http.SendAsync($request, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
            $status = [int]$response.StatusCode
            $response.Dispose()
            if ($status -lt 500) {
                break
            }
        } catch {
            # Retry once after a transport failure with the same event ID.
        } finally {
            $request.Dispose()
        }
        if ($attempt -eq 0) {
            Start-Sleep -Milliseconds 75
        }
    }
} catch {
    # Optional telemetry must not interrupt or add context to a Codex turn.
} finally {
    if ($http) {
        $http.Dispose()
    }
    [Console]::Out.WriteLine('{}')
}
