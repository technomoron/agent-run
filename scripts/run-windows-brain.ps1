param([Parameter(Mandatory = $true)][string]$ConfigRoot)
$ErrorActionPreference = 'Stop'
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
$brain = Join-Path $PSScriptRoot '..\dist\agent-brain.js'
$runtime = Join-Path $ConfigRoot 'runtime'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$log = Join-Path $runtime 'service.log'
$node = (Get-Command node.exe -ErrorAction Stop).Source
# WScript prevents console flashes. Watch that launcher so stopping the task
# also stops the server, even when Windows detaches the launcher's descendants.
$launcherId = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId
$launcher = Get-Process -Id $launcherId -ErrorAction Stop
$process = Start-Process -FilePath $node -ArgumentList @("`"$brain`"", 'serve', '--configdir', "`"$ConfigRoot`"") -WindowStyle Hidden -PassThru -RedirectStandardError $log -RedirectStandardOutput (Join-Path $runtime 'service-output.log')
try {
    while (-not $process.WaitForExit(1000)) {
        if ($launcher.HasExited) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue; exit 0 }
    }
    exit $process.ExitCode
} finally {
    if (-not $process.HasExited) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue }
    $process.Dispose()
    $launcher.Dispose()
}
