param(
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$port = 8794
$url = "http://127.0.0.1:$port"
$dashboard = "$url/?view=codex"
$service = 'agent-office-codex-report'
$generated = Join-Path $root '.agent-office-runtime'
$static = Join-Path $generated 'codex-dist'

function Get-CodexOfficeHealth {
    try {
        $json = $http.GetStringAsync("$url/health").GetAwaiter().GetResult()
        $health = ConvertFrom-Json -InputObject $json
        if ($health.ok -is [bool] -and $health.ok -and
            $health.service -ceq $service -and $health.evidenceType -ceq 'bot-self-report') {
            return $health
        }
    } catch {
        # An occupied port does not guarantee a responsive HTTP service.
    }
}

function Test-RunningCodexOffice {
    $listeners = [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
    if ($port -notin $listeners.Port) {
        return $false
    }

    $health = Get-CodexOfficeHealth
    if (-not $health) {
        throw "Port $port is already in use. The listener is not a healthy Codex Office receiver."
    }
    if ($health.codexActivity -isnot [bool] -or -not $health.codexActivity) {
        throw "Port $port is already in use by an older Codex Office receiver. Restart that receiver with this launcher to enable Codex activity."
    }
    return $true
}

function Find-UsablePython {
    $commands = Get-Command -Name python.exe, python3.exe, py.exe -CommandType Application -All -ErrorAction SilentlyContinue
    $candidates = @($commands.Source | Where-Object { $_ -and $_ -notmatch '[\\/]WindowsApps[\\/]' })
    $bundled = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
    if (Test-Path -LiteralPath $bundled -PathType Leaf) {
        $candidates += $bundled
    }
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        $pythonArgs = @()
        if ((Split-Path -Leaf $candidate) -ieq 'py.exe') {
            $pythonArgs += '-3'
        }
        try {
            $python = & $candidate @pythonArgs -c 'import sys; assert sys.version_info >= (3, 10); print(sys.executable)' 2>$null
            if ($LASTEXITCODE -eq 0 -and $python -and (Test-Path -LiteralPath $python -PathType Leaf)) {
                return $python
            }
        } catch {
            # A launcher on PATH can exist without a usable interpreter.
        }
    }
    throw 'Python 3.10 or later is required. Install it or make the Codex bundled runtime available.'
}

Add-Type -AssemblyName System.Net.Http
$handler = [Net.Http.HttpClientHandler]::new()
$handler.UseProxy = $false
$handler.AllowAutoRedirect = $false
$http = [Net.Http.HttpClient]::new($handler)
$http.Timeout = [TimeSpan]::FromMilliseconds(700)
$mutex = [Threading.Mutex]::new($false, "Local\AgentOfficeCodexLaunch$port")
$locked = $false
$python = $null

try {
    try {
        $locked = $mutex.WaitOne([TimeSpan]::FromSeconds(30))
    } catch [Threading.AbandonedMutexException] {
        $locked = $true
    }
    if (-not $locked) {
        throw 'Another Codex Office launcher is still starting the receiver.'
    }

    $running = Test-RunningCodexOffice
    if (-not $running) {
        $python = Find-UsablePython
    }
    $node = Get-Command -Name node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $node) {
        throw 'Node.js is required to build the Codex Office dashboard.'
    }
    Push-Location -LiteralPath $root
    try {
        & $node.Source (Join-Path $PSScriptRoot 'build-local.mjs')
        if ($LASTEXITCODE -ne 0) {
            throw 'Building the Codex Office dashboard failed.'
        }
    } finally {
        Pop-Location
    }

    # Check again after the build in case a receiver was started independently.
    if (-not (Test-RunningCodexOffice)) {
        if (-not $python) {
            $python = Find-UsablePython
        }
        $runtime = Join-Path $env:LOCALAPPDATA $service
        $server = Join-Path $root 'receiver\self_report_server.py'
        $receiverArgs = @(
            '-u', ('"{0}"' -f $server), '--host', '127.0.0.1', '--port', "$port",
            '--roster', 'codex', '--runtime-dir', ('"{0}"' -f $runtime),
            '--static-dir', ('"{0}"' -f $static)
        )
        $receiver = Start-Process -FilePath $python -ArgumentList $receiverArgs -WorkingDirectory $root -WindowStyle Hidden -PassThru

        $deadline = [DateTime]::UtcNow.AddSeconds(15)
        do {
            $health = Get-CodexOfficeHealth
            if ($health -and $health.codexActivity -is [bool] -and $health.codexActivity) {
                break
            }
            if ($receiver.HasExited) {
                throw "The Codex Office receiver exited during startup (exit code $($receiver.ExitCode))."
            }
            if ([DateTime]::UtcNow -ge $deadline) {
                throw "The Codex Office receiver did not become ready at $url/health."
            }
            Start-Sleep -Milliseconds 200
        } while ($true)
    }
} finally {
    if ($locked) {
        $mutex.ReleaseMutex()
    }
    $mutex.Dispose()
    $http.Dispose()
}

Write-Output "Codex Office is ready at $dashboard"
if (-not $NoBrowser) {
    Start-Process $dashboard
}
