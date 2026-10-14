param([Parameter(Mandatory = $true)][string]$ConfigRoot)
$ErrorActionPreference = 'Stop'
$ConfigRoot = [System.IO.Path]::GetFullPath($ConfigRoot)
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
# Do not inherit a wrapper's guarded PATH or a particular interactive session.
foreach ($name in @('AGENT_RUN_REAL_PATH', 'CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CLAUDE_SESSION_ID', 'GROK_SESSION_ID')) {
    [Environment]::SetEnvironmentVariable($name, $null, 'Process')
}
Set-Location $env:USERPROFILE
$runtime = Join-Path $ConfigRoot 'runtime'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$log = Join-Path $runtime 'cleanup.log'
$agentRun = Join-Path $PSScriptRoot '..\dist\agent-run.js'
try {
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    # Native stderr is diagnostic output; the native exit status decides failure.
    $ErrorActionPreference = 'Continue'
    & $node $agentRun --configdir $ConfigRoot --clean-old all *> $log
    exit $LASTEXITCODE
} catch {
    $_ | Out-File -FilePath $log
    exit 1
}
