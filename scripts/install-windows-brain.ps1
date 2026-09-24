param([string]$ConfigRoot = (Join-Path $env:USERPROFILE '.agent-run'))
$ErrorActionPreference = 'Stop'
$ConfigRoot = [System.IO.Path]::GetFullPath($ConfigRoot)
$runner = Join-Path $PSScriptRoot 'run-windows-brain.ps1'
if ($ConfigRoot.Contains('"') -or $runner.Contains('"')) { throw 'Paths cannot contain quotes.' }
$launcher = Join-Path $PSScriptRoot 'run-hidden.vbs'
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$action = New-ScheduledTaskAction -Execute $wscript -Argument "//B //NoLogo `"$launcher`" `"$runner`" -ConfigRoot `"$ConfigRoot`"" -WorkingDirectory $env:USERPROFILE
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$trigger = New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'Agent Brain' -Action $action -Principal $principal -Trigger $trigger -Settings $settings -Description 'Private local MCP brain server for agent-run.' -Force | Out-Null
Start-ScheduledTask -TaskName 'Agent Brain'
Write-Host "Agent Brain registered for sign-in and started. Log: $ConfigRoot\runtime\service.log"
