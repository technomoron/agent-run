param(
    [Parameter(Mandatory = $true)][string]$PipePath,
    [switch]$Secure
)
$ErrorActionPreference = 'Stop'
if ($PipePath -notmatch '^\\\\\.\\pipe\\[a-zA-Z0-9._-]+$') { throw 'Expected a local Windows named pipe.' }
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$trusted = @($identity.Value, 'S-1-5-18', 'S-1-5-32-544')
$rights = [System.IO.Pipes.PipeAccessRights]::ReadWrite -bor [System.IO.Pipes.PipeAccessRights]::ReadPermissions
if ($Secure) { $rights = $rights -bor [System.IO.Pipes.PipeAccessRights]::ChangePermissions }
# Anonymous impersonation prevents a substituted server from impersonating this client.
$pipe = [System.IO.Pipes.NamedPipeClientStream]::new('.', $PipePath.Substring(9), $rights,
    [System.IO.Pipes.PipeOptions]::None, [System.Security.Principal.TokenImpersonationLevel]::Anonymous,
    [System.IO.HandleInheritability]::None)
try {
    $pipe.Connect(5000)
    if ($PSVersionTable.PSEdition -eq 'Desktop') { $acl = $pipe.GetAccessControl() }
    else { $acl = [System.IO.Pipes.PipesAclExtensions]::GetAccessControl($pipe) }
    if ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $identity.Value) {
        throw 'The brain pipe must be owned by the current Windows user.'
    }
    if ($Secure) {
        $acl = [System.IO.Pipes.PipeSecurity]::new()
        $acl.SetAccessRuleProtection($true, $false)
        foreach ($sid in $trusted) {
            $acl.AddAccessRule([System.IO.Pipes.PipeAccessRule]::new(
                [System.Security.Principal.SecurityIdentifier]::new($sid),
                [System.IO.Pipes.PipeAccessRights]::FullControl,
                [System.Security.AccessControl.AccessControlType]::Allow))
        }
        if ($PSVersionTable.PSEdition -eq 'Desktop') { $pipe.SetAccessControl($acl) }
        else { [System.IO.Pipes.PipesAclExtensions]::SetAccessControl($pipe, $acl) }
    } else {
        foreach ($rule in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
            if ($rule.AccessControlType -eq 'Allow' -and $trusted -notcontains $rule.IdentityReference.Value) {
                throw 'The brain pipe grants access to another Windows account.'
            }
        }
    }
} finally { $pipe.Dispose() }
