# Day 22: offline-only check for the single-delete verification candidate.
# UTF-8 BOM is intentional for Windows PowerShell 5.1.
# Run normally with &, never dot-source. No actual login, HTTP, SQL or deletion.
& {
  if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) {
    'STOP: Run this offline check in Windows PowerShell 5.1.'
    return
  }
  $offline22Body = {

$ErrorActionPreference='Stop'
$sample=@'
& {
  if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) {
    '停止：请在原 Windows PowerShell 5.1 窗口运行。'; return
  }
  foreach ($d22Name in @('day22DeleteVerificationAttempted','day22DeleteAttempted',
      'day22DeleteBeforeReceipt','day22DeleteResponseReceipt')) {
    if ($null -ne (Get-Variable -Name $d22Name -Scope Global -ErrorAction SilentlyContinue)) {
      '停止：已有删除验证记录，不覆盖、不重发，也不要换窗口绕过。'; return
    }
  }
  $ErrorActionPreference='Stop'
  $ProgressPreference='SilentlyContinue'
  function Test-D22Keys($value,[string[]]$keys) {
    if ($value -isnot [pscustomobject] -or $value -is [array]) { return $false }
    $names=@($value.PSObject.Properties.Name)
    if ($names.Count -ne $keys.Count) { return $false }
    foreach ($name in $names) { if ($keys -cnotcontains $name) { return $false } }
    return $true
  }
  function Test-D22Before($rows) {
    if ($rows -isnot [array] -or $rows.Count -ne 3) { return $false }
    $expected=@{
      'recipe-001'=@('2026-10-10T16:07:55.192Z','')
      'recipe-002'=@('2026-10-12T07:10:09.338Z','')
      'recipe-003'=@('2026-10-14T10:53:53.600Z','Day22备注验证')
    }
    $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($row in $rows) {
      if (-not (Test-D22Keys $row @('user_id','recipe_id','created_at','note'))) { return $false }
      foreach ($key in @('user_id','recipe_id','created_at','note')) {
        if ($row.$key -isnot [string]) { return $false }
      }
      if ($row.user_id -cne '2108871194250346498' -or
          @('recipe-001','recipe-002','recipe-003') -cnotcontains $row.recipe_id -or
          -not $seen.Add($row.recipe_id)) { return $false }
      if (-not [string]::Equals($row.created_at,$expected[$row.recipe_id][0],[StringComparison]::Ordinal) -or
          -not [string]::Equals($row.note,$expected[$row.recipe_id][1],[StringComparison]::Ordinal)) { return $false }
    }
    return $true
  }
  function Get-D22Time {
    [DateTimeOffset]::UtcNow.ToOffset([TimeSpan]::FromHours(8)).ToString('yyyy-MM-dd HH:mm:ss.fff')
  }
  function Get-D22Id($headers,[string]$name) {
    try { $value=[string]$headers[$name] } catch { return '未取得' }
    if ($value -cmatch '\A[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\z') { return $value }
    return '未取得'
  }
  function Invoke-D22Business([string]$method,[string]$uri) {
    $status=$null; $headers=$null; $raw=$null; $json=$null
    $started=Get-D22Time
    $clock=[Diagnostics.Stopwatch]::StartNew()
    try {
      $response=Invoke-WebRequest @d22Options -UseBasicParsing -Method $method -Uri $uri -Headers $d22Headers
      $status=[int]$response.StatusCode; $headers=$response.Headers; $raw=$response.Content
    } catch {
      $property=$_.Exception.PSObject.Properties['Response']
      if ($null -ne $property -and $null -ne $property.Value) {
        $status=[int]$property.Value.StatusCode; $headers=$property.Value.Headers
      }
      if ($null -ne $_.ErrorDetails) { $raw=$_.ErrorDetails.Message }
    } finally { $clock.Stop() }
    $finished=Get-D22Time
    if ($raw -is [string] -and $raw.Length -le 8192 -and $raw.TrimStart().StartsWith('{',[StringComparison]::Ordinal)) {
      try { $json=$raw | ConvertFrom-Json -ErrorAction Stop } catch { $json=$null }
    }
    [pscustomobject]@{ status=$status; headers=$headers; json=$json
      started=$started; finished=$finished; elapsed_ms=$clock.ElapsedMilliseconds }
  }
  function Show-D22Result($result,[string]$stage,[bool]$verified) {
    $code=if ($verified) { 'OK' } else { '未匹配预期响应，原文已隐藏' }
    if (-not $verified -and (Test-D22Keys $result.json @('ok','error')) -and
        $result.json.ok -is [bool] -and -not $result.json.ok -and
        (Test-D22Keys $result.json.error @('code','message')) -and $result.json.error.code -is [string] -and
        $result.json.error.code -cmatch '\A(?:AUTH_REQUIRED|AUTH_INVALID|AUTH_UNAVAILABLE|FAVORITE_READ_FAILED|FAVORITE_DELETE_FAILED|FAVORITE_NOT_FOUND|METHOD_NOT_ALLOWED|INVALID_QUERY|DELETE_BODY_NOT_ALLOWED|RECIPE_ID_REQUIRED)\z') {
      $code=$result.json.error.code
    }
    [pscustomobject]@{ stage=$stage; time_zone='UTC+8'; started=$result.started; finished=$result.finished
      client_elapsed_ms=$result.elapsed_ms; http_status=$(if ($null -eq $result.status) { '未取得' } else { $result.status })
      response_verified=$verified; response_code=$code
      gateway_request_id=Get-D22Id $result.headers 'X-Request-Id'
      cloudbase_request_id=Get-D22Id $result.headers 'X-Cloudbase-Request-Id'
      function_request_id=Get-D22Id $result.headers 'X-Tencent-Scf-Request-Id'
    } | Format-List
  }
  $d22Confirm=Read-Host '本次会删除 recipe-003 收藏及备注；请输入 DELETE recipe-003 确认'
  if (-not [string]::Equals($d22Confirm,'DELETE recipe-003',[StringComparison]::Ordinal)) {
    '已停止：确认文字不匹配，未发送请求。'; return
  }
  $d22Options=@{ TimeoutSec=20; MaximumRedirection=0; ErrorAction='Stop'; Verbose=$false; Debug=$false }
  $d22Secret=$null; $d22Stage='login'
  try {
    $d22Secret=Read-Host '请输入 day18_test 密码（隐藏输入，不要发给我）' -AsSecureString
    if ($d22Secret.Length -eq 0) { '停止：密码为空，未发送请求。'; return }
    $d22Credential=[pscredential]::new('day18_test',$d22Secret)
    $d22Body=@{ username='day18_test'; password=$d22Credential.GetNetworkCredential().Password } | ConvertTo-Json -Compress
    $d22Auth='https://doraonix-d2g6piooqfa4ba0c9.api.tcloudbasegateway.com/auth/v1/'
    $d22Client='?client_id=doraonix-d2g6piooqfa4ba0c9'
    $d22Api='https://doraonix-d2g6piooqfa4ba0c9-1500260867.ap-shanghai.app.tcloudbase.com/api/favorites'
    $global:day22DeleteVerificationAttempted=$true
    $global:day22DeleteBeforeReceipt=$null
    $global:day22DeleteResponseReceipt=$null
    $d22Login=Invoke-RestMethod @d22Options -Method Post -Uri ($d22Auth+'signin'+$d22Client) -Headers @{'Cache-Control'='no-store'} -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($d22Body))
    if ($d22Login -isnot [pscustomobject] -or $d22Login -is [array] -or
        $d22Login.access_token -isnot [string] -or $d22Login.access_token.Length -gt 8185 -or
        $d22Login.access_token -cnotmatch '\A[A-Za-z0-9._~+/-]+=*\z' -or
        $d22Login.sub -isnot [string] -or $d22Login.sub -cne '2108871194250346498' -or
        $d22Login.token_type -isnot [string] -or $d22Login.token_type -ine 'Bearer') { throw '登录核验未通过' }
    $d22Headers=@{ Authorization='Bearer '+$d22Login.access_token; 'Cache-Control'='no-store' }
    $d22Stage='introspect'
    $d22Identity=Invoke-RestMethod @d22Options -Method Get -Uri ($d22Auth+'token/introspect'+$d22Client) -Headers $d22Headers
    if ($d22Identity -isnot [pscustomobject] -or $d22Identity -is [array] -or
        $d22Identity.sub -isnot [string] -or $d22Identity.sub -cne '2108871194250346498' -or
        $d22Identity.client_id -isnot [string] -or $d22Identity.client_id -cne 'doraonix-d2g6piooqfa4ba0c9' -or
        $d22Identity.token_type -isnot [string] -or $d22Identity.token_type -ine 'Bearer') { throw '身份核验未通过' }
    '身份核验通过：测试用户、环境及 Bearer 类型均匹配。'
    $d22Stage='get-before-delete'
    $d22Get=Invoke-D22Business 'Get' $d22Api
    $d22GetOk=($d22Get.status -eq 200 -and (Test-D22Keys $d22Get.json @('ok','data')) -and
      $d22Get.json.ok -is [bool] -and $d22Get.json.ok -and (Test-D22Before $d22Get.json.data))
    Show-D22Result $d22Get $d22Stage $d22GetOk
    if (-not $d22GetOk) { throw '删除前数据不匹配' }
    $global:day22DeleteBeforeReceipt=[pscustomobject]@{
      verified=$true; uid='2108871194250346498'; get_finished=$d22Get.finished; rows=$d22Get.json.data }
    $d22Get.json | ConvertTo-Json -Depth 4
    $d22Stage='delete-once'
    $global:day22DeleteAttempted=$true
    $d22Delete=Invoke-D22Business 'Delete' ($d22Api+'?recipe_id=recipe-003')
    $d22DeleteOk=($d22Delete.status -eq 200 -and (Test-D22Keys $d22Delete.json @('ok','data')) -and
      $d22Delete.json.ok -is [bool] -and $d22Delete.json.ok -and
      (Test-D22Keys $d22Delete.json.data @('recipe_id','deleted')) -and
      $d22Delete.json.data.recipe_id -is [string] -and $d22Delete.json.data.recipe_id -ceq 'recipe-003' -and
      $d22Delete.json.data.deleted -is [bool] -and $d22Delete.json.data.deleted)
    Show-D22Result $d22Delete $d22Stage $d22DeleteOk
    if (-not $d22DeleteOk) { throw '删除响应不匹配' }
    $global:day22DeleteResponseReceipt=[pscustomobject]@{
      verified=$true; delete_finished=$d22Delete.finished; data=$d22Delete.json.data }
    $d22Delete.json | ConvertTo-Json -Depth 3
    '删除响应核验通过；尚未独立读回。请回传摘要，不要再次运行。'
  } catch {
    [pscustomobject]@{ stopped_at=$d22Stage; raw_error='已隐藏' } | Format-List
    if ($null -ne (Get-Variable -Name day22DeleteAttempted -Scope Global -ErrorAction SilentlyContinue)) {
      '删除发送阶段已开始，结果须核对；即使报错也可能已删除。不要重试、清标志或换窗口重跑。'
    } else {
      '本脚本尚未进入删除发送阶段；已停止，不自动重试。请回传摘要。'
    }
  } finally {
    $d22Credential=$null; $d22Body=$null; $d22Login=$null; $d22Identity=$null
    $d22Headers=$null; $d22Get=$null; $d22Delete=$null
    if ($null -ne $d22Secret) { $d22Secret.Dispose(); $d22Secret=$null }
  }
}
'@
$tokens=$null; $parseErrors=$null
$candidateAst=[Management.Automation.Language.Parser]::ParseInput($sample,[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count) { throw ('Parse failed: '+$parseErrors.Count) }

# This is a fixed candidate, not a sandbox for arbitrary PowerShell.
$allowedCommands=@('Get-Variable','Read-Host','ConvertTo-Json','ConvertFrom-Json',
 'Invoke-RestMethod','Invoke-WebRequest','Format-List','Test-D22Keys','Test-D22Before',
 'Get-D22Time','Get-D22Id','Invoke-D22Business','Show-D22Result')
foreach ($command in $candidateAst.FindAll({param($node) $node -is [Management.Automation.Language.CommandAst]},$true)) {
 $commandName=$command.GetCommandName()
 if ($null -eq $commandName) {
  if ($command.CommandElements[0] -isnot [Management.Automation.Language.ScriptBlockExpressionAst]) { throw 'Unexpected dynamic command' }
 } elseif ($allowedCommands -cnotcontains $commandName) { throw ('Unexpected candidate command: '+$commandName) }
 if ($command.InvocationOperator -eq [Management.Automation.Language.TokenKind]::Dot) { throw 'Dot sourcing is not allowed' }
}
if ($sample -match '(?i)HttpClient|WebClient|WebRequest\]::|Start-Process|ProcessStartInfo|System\.Net\.Sockets|Import-Module|iex|Invoke-Expression') {
 throw 'Unexpected alternate execution/network path'
}

$scriptBlock=[scriptblock]::Create($sample)
$flags=@('day22DeleteVerificationAttempted','day22DeleteAttempted','day22DeleteBeforeReceipt','day22DeleteResponseReceipt')
$cases=@(
 'success','cancel','empty-password','login-throw','login-other','login-number','login-bad-token','login-bad-type',
 'intro-throw','intro-other','intro-number','intro-env','intro-bad-type',
 'get-throw','get-http-error','get-500','get-html','get-invalid-json','get-too-long','get-empty','get-missing','get-extra','get-duplicate',
 'get-other-uid','get-uid-number','get-note-changed','get-time-changed','get-extra-field','get-object','get-ok-string',
 'get-uppercase-id','get-key-case','get-root-extra',
 'delete-timeout','delete-http-error','delete-500','delete-404','delete-405','delete-302','delete-html','delete-invalid-json',
 'delete-wrong-id','delete-bool-string','delete-bool-false','delete-extra','delete-array','delete-root-extra','delete-ok-string','delete-null',
 'guard-verification','guard-delete','guard-before','guard-response','guard-false','guard-null'
)
function Read-Host {
 param([string]$Prompt,[switch]$AsSecureString)
 if ($AsSecureString) {
   if ($script:mockCase -eq 'empty-password') { return [Security.SecureString]::new() }
   return ConvertTo-SecureString 'CANARY_password_22' -AsPlainText -Force
 }
 if ($script:mockCase -eq 'cancel') { return 'cancel' }
 return 'DELETE recipe-003'
}
function Invoke-RestMethod {
 [CmdletBinding()]
 param([string]$Method,[string]$Uri,$Headers,$Body,[string]$ContentType,[int]$TimeoutSec,[int]$MaximumRedirection)
 if ($TimeoutSec -ne 20 -or $MaximumRedirection -ne 0 -or $PSBoundParameters['ErrorAction'] -ne 'Stop') { throw 'HARNESS: unsafe options' }
 [void]$script:requests.Add("$Method $Uri")
 $auth='https://doraonix-d2g6piooqfa4ba0c9.api.tcloudbasegateway.com/auth/v1/'
 $client='?client_id=doraonix-d2g6piooqfa4ba0c9'
 if ($Method -eq 'Post' -and $Uri -ceq ($auth+'signin'+$client)) {
   if ($script:mockCase -eq 'login-throw') { throw 'CANARY_login_exception' }
   $login=[pscustomobject]@{access_token='CANARY_token_22';sub='2108871194250346498';token_type='Bearer'}
   switch($script:mockCase) {
    'login-other' {$login.sub='wrong'}
    'login-number' {$login.sub=[long]2108871194250346498}
    'login-bad-token' {$login.access_token="invalid token"}
    'login-bad-type' {$login.token_type='Other'}
   }
   return $login
 }
 if ($Method -eq 'Get' -and $Uri -ceq ($auth+'token/introspect'+$client)) {
   if ($Headers.Authorization -cne 'Bearer CANARY_token_22' -or $PSBoundParameters.ContainsKey('Body')) { throw 'HARNESS: bad intro' }
   if ($script:mockCase -eq 'intro-throw') { throw 'CANARY_intro_exception' }
   $identity=[pscustomobject]@{sub='2108871194250346498';client_id='doraonix-d2g6piooqfa4ba0c9';token_type='Bearer'}
   switch($script:mockCase) {
    'intro-other' {$identity.sub='wrong'}
    'intro-number' {$identity.sub=[long]2108871194250346498}
    'intro-env' {$identity.client_id='wrong'}
    'intro-bad-type' {$identity.token_type='Other'}
   }
   return $identity
 }
 throw 'HARNESS: unexpected REST request blocked'
}

function Throw-Offline22HttpError($headers,[string]$code) {
 $exception=[Exception]::new('CANARY_http_exception')
 Add-Member -InputObject $exception -NotePropertyName Response -NotePropertyValue ([pscustomobject]@{StatusCode=500;Headers=$headers})
 $record=[Management.Automation.ErrorRecord]::new($exception,'MockHttpFailure',[Management.Automation.ErrorCategory]::InvalidOperation,$null)
 $record.ErrorDetails=[Management.Automation.ErrorDetails]::new(
   (@{ok=$false;error=@{code=$code;message='CANARY_raw_error'}} | ConvertTo-Json -Depth 4 -Compress))
 throw $record
}

function Invoke-WebRequest {
 [CmdletBinding()]
 param([string]$Method,[string]$Uri,$Headers,[switch]$UseBasicParsing,[int]$TimeoutSec,[int]$MaximumRedirection,$Body)
 if ($TimeoutSec -ne 20 -or $MaximumRedirection -ne 0 -or -not $UseBasicParsing -or
   $PSBoundParameters['ErrorAction'] -ne 'Stop' -or $PSBoundParameters.ContainsKey('Body') -or
   $Headers.Authorization -cne 'Bearer CANARY_token_22') { throw 'HARNESS: unsafe business request' }
 [void]$script:requests.Add("$Method $Uri")
 $api='https://doraonix-d2g6piooqfa4ba0c9-1500260867.ap-shanghai.app.tcloudbase.com/api/favorites'
 $hdr=@{'X-Request-Id'='00000000-0000-0000-0000-000000000001';'X-Tencent-Scf-Request-Id'='00000000-0000-0000-0000-000000000002'}
 if ($Method -eq 'Get' -and $Uri -ceq $api) {
   if ($script:mockCase -eq 'get-throw') { throw 'CANARY_get_exception' }
   if ($script:mockCase -eq 'get-http-error') { Throw-Offline22HttpError $hdr 'FAVORITE_READ_FAILED' }
   $rows=@(
    [pscustomobject]@{user_id='2108871194250346498';recipe_id='recipe-003';created_at='2026-10-14T10:53:53.600Z';note='Day22备注验证'}
    [pscustomobject]@{user_id='2108871194250346498';recipe_id='recipe-002';created_at='2026-10-12T07:10:09.338Z';note=''}
    [pscustomobject]@{user_id='2108871194250346498';recipe_id='recipe-001';created_at='2026-10-10T16:07:55.192Z';note=''}
   )
   switch($script:mockCase) {
     'get-empty' {$rows=@()}
     'get-missing' {$rows=@($rows[0],$rows[1])}
     'get-extra' {$rows=@($rows)+@($rows[0])}
     'get-duplicate' {$rows=@($rows[0],$rows[0],$rows[2])}
     'get-other-uid' {$rows[0].user_id='wrong'}
     'get-uid-number' {$rows[0].user_id=[long]2108871194250346498}
     'get-note-changed' {$rows[0].note='CANARY_changed_note'}
     'get-time-changed' {$rows[0].created_at='2026-10-14T10:53:53.601Z'}
     'get-extra-field' {Add-Member -InputObject $rows[0] -NotePropertyName extra -NotePropertyValue 'CANARY_extra'}
     'get-uppercase-id' {$rows[0].recipe_id='RECIPE-003'}
     'get-key-case' {$rows[0]=[pscustomobject]@{user_id='2108871194250346498';recipe_id='recipe-003';created_at='2026-10-14T10:53:53.600Z';Note='Day22备注验证'}}
   }
   $root=[pscustomobject]@{ok=$true;data=$rows}
   if ($script:mockCase -eq 'get-object') {$root.data=$rows[0]}
   if ($script:mockCase -eq 'get-ok-string') {$root.ok='true'}
   if ($script:mockCase -eq 'get-root-extra') {Add-Member -InputObject $root -NotePropertyName extra -NotePropertyValue 1}
   $raw=$root | ConvertTo-Json -Depth 5 -Compress
   switch($script:mockCase) {
    'get-html' {$raw='<html>CANARY_html</html>'}
    'get-invalid-json' {$raw='{invalid'}
    'get-too-long' {$raw='{' + (' ' * 8200)}
   }
   $status=if($script:mockCase -eq 'get-500') {500} else {200}
   return [pscustomobject]@{StatusCode=$status;Headers=$hdr;Content=$raw}
 }
 if ($Method -eq 'Delete' -and $Uri -ceq ($api+'?recipe_id=recipe-003')) {
   if ($global:day22DeleteAttempted -isnot [bool] -or -not $global:day22DeleteAttempted -or
       $global:day22DeleteBeforeReceipt.verified -isnot [bool] -or -not $global:day22DeleteBeforeReceipt.verified) {
       throw 'HARNESS: DELETE flag/before missing'
   }
   $script:mockDeleted=$true
   if ($script:mockCase -eq 'delete-timeout') { throw 'CANARY_delete_timeout_after_commit' }
   if ($script:mockCase -eq 'delete-http-error') { Throw-Offline22HttpError $hdr 'FAVORITE_DELETE_FAILED' }
   $root=[pscustomobject]@{ok=$true;data=[pscustomobject]@{recipe_id='recipe-003';deleted=$true}}
   $status=200
   switch($script:mockCase) {
    'delete-500' {$status=500;$root=[pscustomobject]@{ok=$false;error=[pscustomobject]@{code='FAVORITE_DELETE_FAILED';message='CANARY_private_raw'}}}
    'delete-404' {$status=404;$root=[pscustomobject]@{ok=$false;error=[pscustomobject]@{code='FAVORITE_NOT_FOUND';message='CANARY_private_raw'}}}
    'delete-405' {$status=405;$root=[pscustomobject]@{ok=$false;error=[pscustomobject]@{code='METHOD_NOT_ALLOWED';message='CANARY_private_raw'}}}
    'delete-302' {$status=302}
    'delete-wrong-id' {$root.data.recipe_id='recipe-002'}
    'delete-bool-string' {$root.data.deleted='true'}
    'delete-bool-false' {$root.data.deleted=$false}
    'delete-extra' {Add-Member -InputObject $root.data -NotePropertyName extra -NotePropertyValue 'CANARY_extra'}
    'delete-array' {$root.data=@($root.data)}
    'delete-root-extra' {Add-Member -InputObject $root -NotePropertyName extra -NotePropertyValue 'CANARY_extra'}
    'delete-ok-string' {$root.ok='true'}
    'delete-null' {$root.data=$null}
   }
   $raw=$root | ConvertTo-Json -Depth 5 -Compress
   switch($script:mockCase) {
    'delete-html' {$raw='<html>CANARY_html</html>'}
    'delete-invalid-json' {$raw='{invalid'}
   }
   return [pscustomobject]@{StatusCode=$status;Headers=$hdr;Content=$raw}
 }
 throw 'HARNESS: unexpected Web request blocked'
}

foreach ($mockName in @('Read-Host','Invoke-RestMethod','Invoke-WebRequest')) {
 $mockCommand=Get-Command -Name $mockName -CommandType Function -ErrorAction Stop
 if ($mockCommand.CommandType -ne 'Function') { throw ('Missing mock: '+$mockName) }
}

$passed=0
$rerunChecks=0
$caseResults=[Collections.Generic.List[object]]::new()
foreach ($case in $cases) {
 foreach ($flag in $flags) { Remove-Variable -Name $flag -Scope Global -ErrorAction SilentlyContinue }
 $script:mockCase=$case; $script:requests=[Collections.Generic.List[string]]::new();$script:mockDeleted=$false
 switch($case) {
  'guard-verification' {$global:day22DeleteVerificationAttempted=$true}
  'guard-delete' {$global:day22DeleteAttempted=$true}
  'guard-before' {$global:day22DeleteBeforeReceipt=[pscustomobject]@{keep='original'}}
  'guard-response' {$global:day22DeleteResponseReceipt=[pscustomobject]@{keep='original'}}
  'guard-false' {$global:day22DeleteAttempted=$false}
  'guard-null' {$global:day22DeleteResponseReceipt=$null}
 }
 $out=(& $scriptBlock | Out-String)
 if ($out -match 'CANARY_') { throw "Secret/raw leak: $case" }
 $expectedCalls=if ($case -like 'guard-*' -or $case -in @('cancel','empty-password')) {0}
   elseif ($case -like 'login-*') {1}
   elseif ($case -like 'intro-*') {2}
   elseif ($case -like 'get-*') {3}
   else {4}
 if ($script:requests.Count -ne $expectedCalls) { throw "Wrong request count: $case = $($script:requests.Count), expected $expectedCalls." }
 $deleteCount=@($script:requests | Where-Object { $_ -clike 'Delete *' }).Count
 $expectedDeletes=if($expectedCalls -eq 4){1}else{0}
 if ($deleteCount -ne $expectedDeletes) { throw "Wrong DELETE count: $case" }
 if ($case -eq 'success') {
   if ($global:day22DeleteResponseReceipt.verified -cne $true -or $global:day22DeleteResponseReceipt.data.deleted -isnot [bool]) { throw 'Success not verified' }
 } elseif ($expectedCalls -gt 0 -and $null -ne $global:day22DeleteResponseReceipt) { throw "Unexpected verified receipt: $case" }
 if ($case -eq 'guard-false' -and $global:day22DeleteAttempted -cne $false) { throw 'Existing false flag overwritten' }
 if ($case -eq 'guard-before' -and $global:day22DeleteBeforeReceipt.keep -cne 'original') { throw 'Existing receipt overwritten' }
 if ($case -like 'delete-*') {
   if (-not $script:mockDeleted -or $global:day22DeleteAttempted -cne $true -or
       $out -notmatch '即使报错也可能已删除') { throw "Uncertain write not preserved: $case" }
 }

 if ($case -in @('get-http-error','delete-http-error')) {
   if ($out -notmatch 'http_status\s*:\s*500' -or $out -notmatch 'FAVORITE_(?:READ|DELETE)_FAILED') { throw ('HTTP exception metadata not handled: '+$case) }
 }
 # These flags and receipts live only in this isolated runspace.
 if ($case -eq 'guard-response' -and $global:day22DeleteResponseReceipt.keep -cne 'original') { throw 'Existing response receipt overwritten' }
 if ($case -eq 'guard-null' -and $null -ne $global:day22DeleteResponseReceipt) { throw 'Existing null receipt overwritten' }
 if ($expectedCalls -gt 0) {
   $beforeCalls=$script:requests.Count
   $out2=(& $scriptBlock | Out-String)
   if ($script:requests.Count -ne $beforeCalls -or $out2 -notmatch '已有删除验证记录') { throw ('Rerun was not blocked: '+$case) }
   if ($out2 -match 'CANARY_') { throw ('Secret/raw leak on rerun: '+$case) }
   $rerunChecks++
 }
 [void]$caseResults.Add([pscustomobject]@{case=$case;passed=$true;mock_requests=$script:requests.Count;mock_deletes=$deleteCount})

 $passed++
}

[pscustomobject]@{
 marker='day22-delete-offline-v1'
 powershell_version=$PSVersionTable.PSVersion.ToString()
 parse_errors=$parseErrors.Count
 scenarios_passed=$passed
 scenarios_total=$cases.Count
 result_records=$caseResults.Count
 rerun_checks=$rerunChecks
 rerun_blocked=($rerunChecks -gt 0 -and $rerunChecks -eq @($caseResults | Where-Object { $_.mock_requests -gt 0 }).Count)
 http_mode='mock functions only'
}

  }
  # A new runspace isolates all mock global flags from the user's original window.
  # It is NOT a network sandbox: offline behavior relies on the fixed code and mocks above.
  $offline22Runner=[powershell]::Create()
  try {
    [void]$offline22Runner.AddScript($offline22Body.ToString())
    $offline22Output=@($offline22Runner.Invoke())
    if ($offline22Runner.Streams.Error.Count -ne 0) {
      'OFFLINE CHECK FAILED. No real deletion was requested. Do not run DELETE.'
      $offline22Runner.Streams.Error | ForEach-Object { $_.Exception.Message }
      return
    }
    # HadErrors also counts intentionally suppressed missing-variable lookups.
    # Require an empty emitted error stream AND the complete, successful result record.
    if ($offline22Output.Count -ne 1) {
      'OFFLINE CHECK FAILED: incomplete or unexpected output. Do not run DELETE.'
      return
    }
    $offline22Summary=$offline22Output[0]
    if ($offline22Summary.marker -cne 'day22-delete-offline-v1' -or
        $offline22Summary.parse_errors -ne 0 -or
        $offline22Summary.scenarios_total -ne 55 -or
        $offline22Summary.scenarios_passed -ne $offline22Summary.scenarios_total -or
        $offline22Summary.result_records -ne $offline22Summary.scenarios_total -or
        $offline22Summary.rerun_checks -ne 47 -or
        $offline22Summary.rerun_blocked -ne $true) {
      'OFFLINE CHECK FAILED: result assertions not satisfied. Do not run DELETE.'
      return
    }
    $offline22Summary | Format-List
    'OFFLINE CHECK PASSED. Only fake credentials and mocked requests were used.'
    'Original-window Day 22 flags/receipts were not changed. No files were written by this check.'
    'Stop here and send this summary. Do not run a real DELETE yet.'
  } finally {
    $offline22Runner.Dispose()
  }
}

