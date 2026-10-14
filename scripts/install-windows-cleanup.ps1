param([string]$ConfigRoot = (Join-Path $env:USERPROFILE '.agent-run'))
$ErrorActionPreference = 'Stop'
$ConfigRoot = [System.IO.Path]::GetFullPath($ConfigRoot)
$runner = Join-Path $PSScriptRoot 'run-windows-cleanup.ps1'
$launcher = Join-Path $PSScriptRoot 'run-hidden.vbs'
if ($ConfigRoot.Contains('"') -or $runner.Contains('"') -or $launcher.Contains('"')) { throw 'Paths cannot contain quotes.' }
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $wscript -Argument "//B //NoLogo `"$launcher`" `"$runner`" -ConfigRoot `"$ConfigRoot`"" -WorkingDirectory $env:USERPROFILE
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(10) -RepetitionInterval (New-TimeSpan -Hours 1)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'Agent Session Cleanup' -Action $action -Principal $principal -Trigger $trigger -Settings $settings -Description 'Hourly agent-run session retention cleanup for the signed-in user.' -Force | Out-Null
Write-Host "Agent Session Cleanup registered hourly for $account. Retention: $ConfigRoot\cleanup.env (default 7 days). Log: $ConfigRoot\runtime\cleanup.log"
