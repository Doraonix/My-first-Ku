# Day 28｜核心流程重复检测：云端收藏“写入→刷新读回→修改→删除”连续完整走两遍。
# 仅限 Windows PowerShell 5.1。把整份内容粘贴进窗口只会定义函数，不发送任何请求。
# 第 1 步：输入 Test-Day28Fingerprint，把显示的 FINGERPRINT 那一行贴给 AI 核对。
# 第 2 步：AI 确认后输入 Invoke-Day28CrudRepeat。登录一次后对 recipe-004 走两遍：写前读回→写入→读回→修改→读回→删除→读回。
# 出错后只读核对：Invoke-Day28ReadCheck（登录后只 GET 一次，不写任何数据）。
# 只动本人 recipe-004 收藏且每遍最后删除；recipe-001、002 只核对不修改；不碰 recipe-003 和 006～008。
# 不输出密码、token 和 UID；任何一步不符立即停止、不自动重试；写请求开始后本窗口拒绝再次运行闭环。
# 不要把 $Error 或 Format-List * 的输出贴给任何人。
function Test-D28Keys($value,[string[]]$keys) {
  if ($value -isnot [pscustomobject] -or $value -is [array]) { return $false }
  $names=@($value.PSObject.Properties.Name)
  if ($names.Count -ne $keys.Count) { return $false }
  foreach ($name in $names) { if ($keys -cnotcontains $name) { return $false } }
  return $true
}
function Test-D28Root($result,[int]$status) {
  return ($result.status -eq $status -and (Test-D28Keys $result.json @('ok','data')) -and
    $result.json.ok -is [bool] -and $result.json.ok)
}
function Get-D28Time {
  return [DateTimeOffset]::UtcNow.ToOffset([TimeSpan]::FromHours(8)).ToString('yyyy-MM-dd HH:mm:ss.fff')
}
function Get-D28Id($headers,[string]$name) {
  try { $value=[string]$headers[$name] } catch { return '未取得' }
  if ($value -cmatch '\A[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\z') { return $value }
  return '未取得'
}
function Invoke-D28Business([string]$method,[string]$uri,$body,$headers) {
  $status=$null; $responseHeaders=$null; $raw=$null; $json=$null
  $request=@{ Method=$method; Uri=$uri; Headers=$headers; UseBasicParsing=$true; TimeoutSec=20
    MaximumRedirection=0; ErrorAction='Stop'; Verbose=$false; Debug=$false }
  if ($null -ne $body) {
    $request.ContentType='application/json; charset=utf-8'
    $request.Body=[Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Compress))
  }
  $started=Get-D28Time
  $clock=[Diagnostics.Stopwatch]::StartNew()
  try {
    $response=Invoke-WebRequest @request
    $status=[int]$response.StatusCode; $responseHeaders=$response.Headers; $raw=$response.Content
  } catch {
    $property=$_.Exception.PSObject.Properties['Response']
    if ($null -ne $property -and $null -ne $property.Value) {
      $status=[int]$property.Value.StatusCode; $responseHeaders=$property.Value.Headers
    }
    if ($null -ne $_.ErrorDetails) { $raw=$_.ErrorDetails.Message }
  } finally { $clock.Stop() }
  if ($raw -is [string] -and $raw.Length -le 8192 -and $raw.TrimStart().StartsWith('{',[StringComparison]::Ordinal)) {
    try { $json=$raw | ConvertFrom-Json -ErrorAction Stop } catch { $json=$null }
  }
  return [pscustomobject]@{ status=$status; headers=$responseHeaders; json=$json
    started=$started.Substring(11); elapsed_ms=$clock.ElapsedMilliseconds }
}
function Test-D28Rows($rows,[string]$uid,[hashtable]$expected) {
  if ($rows -isnot [array] -or $rows.Count -ne $expected.Count) { return $false }
  $ids=[string[]]@($expected.Keys)
  $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($row in $rows) {
    if (-not (Test-D28Keys $row @('user_id','recipe_id','created_at','note'))) { return $false }
    foreach ($key in @('user_id','recipe_id','created_at','note')) { if ($row.$key -isnot [string]) { return $false } }
    if ($row.user_id -cne $uid -or $ids -cnotcontains $row.recipe_id -or -not $seen.Add($row.recipe_id)) { return $false }
    $want=$expected[$row.recipe_id]
    if (-not [string]::Equals($row.created_at,$want[0],[StringComparison]::Ordinal) -or
        -not [string]::Equals($row.note,$want[1],[StringComparison]::Ordinal)) { return $false }
  }
  return $true
}
function Show-D28Rows($rows,[string]$uid) {
  if ($rows -isnot [array]) { '    （data 不是数组，内容已隐藏）'; return }
  if ($rows.Count -eq 0) { '    （本人收藏为空）'; return }
  $other=0; $bad=0
  foreach ($row in $rows) {
    if (-not ((Test-D28Keys $row @('user_id','recipe_id','created_at','note')) -and $row.user_id -is [string] -and
        $row.recipe_id -is [string] -and $row.recipe_id -cmatch '\A[A-Za-z0-9_-]{1,64}\z' -and $row.created_at -is [string] -and
        $row.created_at -cmatch '\A\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\z' -and $row.note -is [string])) { $bad++; continue }
    if ($row.user_id -cne $uid) { $other++; continue }
    $shown='（非预期备注，长度 '+$row.note.Length+'，已隐藏）'
    if ($row.note -ceq '' -or $row.note -cmatch '\ADay28 run [12]\z') { $shown='"'+$row.note+'"' }
    '    {0}  created_at={1}  note={2}' -f $row.recipe_id,$row.created_at,$shown
  }
  if ($other) { '    （另有 {0} 行不是本人的数据，内容已隐藏）' -f $other }
  if ($bad) { '    （另有 {0} 行格式不符，内容已隐藏）' -f $bad }
}
function Add-D28Step($steps,[int]$run,[string]$stage,$result,[bool]$verified) {
  $code='OK'
  if (-not $verified) {
    $code='不符合预期'
    if ((Test-D28Keys $result.json @('ok','error')) -and $result.json.ok -is [bool] -and -not $result.json.ok -and
        (Test-D28Keys $result.json.error @('code','message')) -and $result.json.error.code -is [string] -and
        $result.json.error.code -cmatch '\A(?:AUTH_REQUIRED|AUTH_INVALID|AUTH_UNAVAILABLE|FAVORITE_EXISTS|RECIPE_NOT_FOUND|FAVORITE_NOT_FOUND|FAVORITE_READ_FAILED|FAVORITE_WRITE_FAILED|FAVORITE_DELETE_FAILED|METHOD_NOT_ALLOWED|UNSUPPORTED_MEDIA_TYPE|BODY_TOO_LARGE|INVALID_JSON|INVALID_BODY|INVALID_QUERY|RECIPE_ID_REQUIRED|RECIPE_ID_INVALID|UNEXPECTED_FIELDS|PATCH_FIELDS_INVALID|NOTE_REQUIRED|NOTE_INVALID|GET_BODY_NOT_ALLOWED|DELETE_BODY_NOT_ALLOWED)\z') {
      $code=$result.json.error.code
    }
  }
  $http='未取得'
  if ($null -ne $result.status) { $http=[string]$result.status }
  $label='第'+$run+'遍'
  if ($run -eq 0) { $label='只读' }
  [void]$steps.Add([pscustomobject]@{ run=$label; stage=$stage; started=$result.started; http=$http; verified=$verified
    code=$code; client_ms=$result.elapsed_ms; gateway_request_id=(Get-D28Id $result.headers 'X-Request-Id')
    function_request_id=(Get-D28Id $result.headers 'X-Tencent-Scf-Request-Id') })
  return ('[{0}] {1}  HTTP {2}  {3}  {4} ms' -f $label,$stage,$http,$code,$result.elapsed_ms)
}
function Connect-D28 {
  $secret=$null; $credential=$null; $loginBody=$null; $bodyBytes=$null; $login=$null; $identity=$null
  $auth='https://doraonix-d2g6piooqfa4ba0c9.api.tcloudbasegateway.com/auth/v1/'
  $client='?client_id=doraonix-d2g6piooqfa4ba0c9'
  $options=@{ TimeoutSec=20; MaximumRedirection=0; ErrorAction='Stop'; Verbose=$false; Debug=$false }
  try {
    $secret=Read-Host '请输入 day18_test 的密码（隐藏输入，只在本机使用，不要发给 AI）' -AsSecureString
    if ($null -eq $secret -or $secret.Length -eq 0) { throw '密码为空' }
    try {
      $credential=[pscredential]::new('day18_test',$secret)
      $loginBody=@{ username='day18_test'; password=$credential.GetNetworkCredential().Password } | ConvertTo-Json -Compress
      $bodyBytes=[Text.Encoding]::UTF8.GetBytes($loginBody)
      $loginBody=$null
      $login=Invoke-RestMethod @options -Method Post -Uri ($auth+'signin'+$client) -Headers @{ 'Cache-Control'='no-store' } -ContentType 'application/json; charset=utf-8' -Body $bodyBytes
    } catch {
      $code='无响应'
      $property=$_.Exception.PSObject.Properties['Response']
      if ($null -ne $property -and $null -ne $property.Value) { try { $code=[string][int]$property.Value.StatusCode } catch { $code='无响应' } }
      throw ('登录请求失败（HTTP '+$code+'）')
    } finally {
      if ($null -ne $bodyBytes) { [Array]::Clear($bodyBytes,0,$bodyBytes.Length); $bodyBytes=$null }
      $loginBody=$null; $credential=$null
      if ($null -ne $secret) { $secret.Dispose(); $secret=$null }
    }
    if ($login -isnot [pscustomobject] -or $login -is [array] -or
        $login.access_token -isnot [string] -or $login.access_token.Length -gt 8185 -or
        $login.access_token -cnotmatch '\A[A-Za-z0-9._~+/-]+=*\z' -or
        $login.sub -isnot [string] -or $login.sub -cnotmatch '\A[A-Za-z0-9_-]{1,128}\z' -or
        $login.token_type -isnot [string] -or $login.token_type -ine 'Bearer') { throw '登录核验未通过' }
    $headers=@{ Authorization='Bearer '+$login.access_token; 'Cache-Control'='no-store' }
    try {
      $identity=Invoke-RestMethod @options -Method Get -Uri ($auth+'token/introspect'+$client) -Headers $headers
    } catch {
      $code='无响应'
      $property=$_.Exception.PSObject.Properties['Response']
      if ($null -ne $property -and $null -ne $property.Value) { try { $code=[string][int]$property.Value.StatusCode } catch { $code='无响应' } }
      throw ('身份核验请求失败（HTTP '+$code+'）')
    }
    if ($identity -isnot [pscustomobject] -or $identity -is [array] -or
        $identity.sub -isnot [string] -or $identity.sub -cne $login.sub -or
        $identity.client_id -isnot [string] -or $identity.client_id -cne 'doraonix-d2g6piooqfa4ba0c9' -or
        $identity.token_type -isnot [string] -or $identity.token_type -ine 'Bearer') { throw '身份核验未通过' }
    return [pscustomobject]@{ uid=$identity.sub; headers=$headers }
  } finally {
    if ($null -ne $bodyBytes) { [Array]::Clear($bodyBytes,0,$bodyBytes.Length); $bodyBytes=$null }
    $credential=$null; $loginBody=$null; $login=$null; $identity=$null
    if ($null -ne $secret) { $secret.Dispose(); $secret=$null }
  }
}
function Invoke-Day28CrudRepeat {
  if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) { '停止：请在 Windows PowerShell 5.1 窗口运行。'; return }
  $gate=$false
  try { $gate=((Test-Day28Fingerprint -Quiet) -eq $true) } catch { $gate=$false }
  if (-not $gate) { '停止：指纹核验没有通过（函数缺失或内容与 AI 审核的版本不一致），未发送请求。请重新粘贴整份文件。'; return }
  if ($null -ne (Get-Variable -Name day28WriteAttempted -Scope Global -ErrorAction SilentlyContinue)) {
    '停止：本窗口已经发过写请求，不再运行闭环。不要换窗口绕过；先把上次的输出贴给 AI 核对。'; return
  }
  $ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
  $confirm=Read-Host '将真实写入云端：对 recipe-004 收藏连续完整走两遍（写入→读回→修改→读回→删除→读回），约 30 秒，通常扣 1 段资源点。运行中不要按 Ctrl+C、不要关窗口。确认请输入 DAY28 TWO RUNS'
  if (-not [string]::Equals($confirm,'DAY28 TWO RUNS',[StringComparison]::Ordinal)) { '已停止：确认文字不匹配，未发送请求。'; return }
  $api='https://doraonix-d2g6piooqfa4ba0c9-1500260867.ap-shanghai.app.tcloudbase.com/api/favorites'
  $base=@{ 'recipe-001'=@('2026-10-10T16:07:55.192Z',''); 'recipe-002'=@('2026-10-12T07:10:09.338Z','') }
  $steps=[Collections.ArrayList]::new(); $session=$null; $result=$null; $data=$null
  $stage='登录与身份核验'; $run=0; $passed=0; $pending=$false; $reported=$false; $done=$false
  $errorStart=$global:Error.Count
  '开始时间（UTC+8）：'+(Get-D28Time)
  try {
    $session=Connect-D28
    '身份核验通过：测试账号、环境和令牌类型均匹配（UID 不显示）。'
    foreach ($run in @(1,2)) {
      $note='Day28 run '+$run
      $stage='1 写前读回 GET'
      $result=Invoke-D28Business 'Get' $api $null $session.headers
      $ok=(Test-D28Root $result 200) -and (Test-D28Rows $result.json.data $session.uid $base)
      Add-D28Step $steps $run $stage $result $ok
      if ($ok -or (Test-D28Root $result 200)) { Show-D28Rows $result.json.data $session.uid }
      if (-not $ok) { throw $stage }
      $stage='2 写入 POST'
      $global:day28WriteAttempted=$true
      $pending=$true
      $result=Invoke-D28Business 'Post' $api ([ordered]@{ recipe_id='recipe-004' }) $session.headers
      $data=$null
      if (Test-D28Root $result 201) { $data=$result.json.data }
      $ok=(Test-D28Keys $data @('user_id','recipe_id','created_at')) -and $data.user_id -is [string] -and
        $data.user_id -ceq $session.uid -and $data.recipe_id -is [string] -and $data.recipe_id -ceq 'recipe-004' -and
        $data.created_at -is [string] -and $data.created_at -cmatch '\A\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\z'
      Add-D28Step $steps $run $stage $result $ok
      if (-not $ok) { throw $stage }
      $created=$data.created_at
      $expected=$base.Clone()
      $expected['recipe-004']=@($created,'')
      $stage='3 刷新读回 GET'
      $result=Invoke-D28Business 'Get' $api $null $session.headers
      $ok=(Test-D28Root $result 200) -and (Test-D28Rows $result.json.data $session.uid $expected)
      Add-D28Step $steps $run $stage $result $ok
      if ($ok -or (Test-D28Root $result 200)) { Show-D28Rows $result.json.data $session.uid }
      if (-not $ok) { throw $stage }
      $pending=$false
      $stage='4 修改 PATCH'
      $pending=$true
      $result=Invoke-D28Business 'Patch' $api ([ordered]@{ recipe_id='recipe-004'; note=$note }) $session.headers
      $data=$null
      if (Test-D28Root $result 200) { $data=$result.json.data }
      $ok=(Test-D28Keys $data @('user_id','recipe_id','created_at','note')) -and $data.user_id -is [string] -and
        $data.user_id -ceq $session.uid -and $data.recipe_id -is [string] -and $data.recipe_id -ceq 'recipe-004' -and
        $data.created_at -is [string] -and $data.created_at -ceq $created -and $data.note -is [string] -and $data.note -ceq $note
      Add-D28Step $steps $run $stage $result $ok
      if (-not $ok) { throw $stage }
      $expected['recipe-004']=@($created,$note)
      $stage='5 改后读回 GET'
      $result=Invoke-D28Business 'Get' $api $null $session.headers
      $ok=(Test-D28Root $result 200) -and (Test-D28Rows $result.json.data $session.uid $expected)
      Add-D28Step $steps $run $stage $result $ok
      if ($ok -or (Test-D28Root $result 200)) { Show-D28Rows $result.json.data $session.uid }
      if (-not $ok) { throw $stage }
      $pending=$false
      $stage='6 删除 DELETE'
      $pending=$true
      $result=Invoke-D28Business 'Delete' ($api+'?recipe_id=recipe-004') $null $session.headers
      $data=$null
      if (Test-D28Root $result 200) { $data=$result.json.data }
      $ok=(Test-D28Keys $data @('recipe_id','deleted')) -and $data.recipe_id -is [string] -and
        $data.recipe_id -ceq 'recipe-004' -and $data.deleted -is [bool] -and $data.deleted
      Add-D28Step $steps $run $stage $result $ok
      if (-not $ok) { throw $stage }
      $stage='7 删后读回 GET'
      $result=Invoke-D28Business 'Get' $api $null $session.headers
      $ok=(Test-D28Root $result 200) -and (Test-D28Rows $result.json.data $session.uid $base)
      Add-D28Step $steps $run $stage $result $ok
      if ($ok -or (Test-D28Root $result 200)) { Show-D28Rows $result.json.data $session.uid }
      if (-not $ok) { throw $stage }
      $pending=$false
      $passed++
      '第{0}遍：7 步全部核验通过。' -f $run
    }
    $done=$true
    '结束时间（UTC+8）：'+(Get-D28Time)
    '结论：两遍结果一致（每遍 7 步全部通过；两遍结束后都只剩 recipe-001、recipe-002，时间和备注未变）。'
  } catch {
    $reported=$true
    $reason=[string]$_.Exception.Message
    if ($run -eq 0) {
      '已停止：「'+$stage+'」未通过。'
      if ($reason -cmatch '\A(?:密码为空|登录核验未通过|身份核验未通过|(?:登录请求失败|身份核验请求失败)（HTTP (?:\d{3}|无响应)）)\z') { '原因：'+$reason } else { '原因：已隐藏' }
    } else { '已停止：第{0}遍「{1}」不符合预期（原始错误已隐藏）。完整通过的遍数：{2}。' -f $run,$stage,$passed }
    if ($pending) {
      '写请求已经发出但还没读回确认：即使报错，也可能已经写入、修改或删除。'
    } elseif ($null -ne (Get-Variable -Name day28WriteAttempted -Scope Global -ErrorAction SilentlyContinue)) {
      '之前发出的写请求都已读回确认（停下前库里只剩 recipe-001、002）；停下的这一步没有发写请求。'
    } else {
      '还没有发送任何写请求。若原因是 HTTP 400/401（多半是密码输错），可以在本窗口直接重新运行；其他情况先把输出贴给 AI。'
    }
    if ($null -ne (Get-Variable -Name day28WriteAttempted -Scope Global -ErrorAction SilentlyContinue)) {
      '不要自行重跑或换窗口；把全部输出贴给 AI，等核对后再决定下一步。'
    }
  } finally {
    if ($pending -and -not $reported -and -not $done) {
      Write-Host '（运行被中断）写请求已经发出但还没读回确认，可能已经写入、修改或删除。不要重跑或换窗口；把屏幕上的全部内容贴给 AI。'
    }
    $session=$null; $result=$null; $data=$null
    $added=$global:Error.Count-$errorStart
    while ($added -gt 0) { $global:Error.RemoveAt(0); $added-- }
  }
  if ($steps.Count -gt 0) {
    '逐步记录（时间为 UTC+8）：'
    $steps | Format-Table run,stage,started,http,verified,code,client_ms,gateway_request_id,function_request_id -AutoSize | Out-String -Width 240
  }
}
function Invoke-Day28ReadCheck {
  if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) { '停止：请在 Windows PowerShell 5.1 窗口运行。'; return }
  $gate=$false
  try { $gate=((Test-Day28Fingerprint -Quiet) -eq $true) } catch { $gate=$false }
  if (-not $gate) { '停止：指纹核验没有通过（函数缺失或内容与 AI 审核的版本不一致），未发送请求。请重新粘贴整份文件。'; return }
  $ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
  $api='https://doraonix-d2g6piooqfa4ba0c9-1500260867.ap-shanghai.app.tcloudbase.com/api/favorites'
  $base=@{ 'recipe-001'=@('2026-10-10T16:07:55.192Z',''); 'recipe-002'=@('2026-10-12T07:10:09.338Z','') }
  $steps=[Collections.ArrayList]::new(); $session=$null; $result=$null; $stage='登录与身份核验'
  $errorStart=$global:Error.Count
  '只读核对开始（UTC+8）：'+(Get-D28Time)
  try {
    $session=Connect-D28
    $stage='只读 GET'
    $result=Invoke-D28Business 'Get' $api $null $session.headers
    $rootOk=Test-D28Root $result 200
    Add-D28Step $steps 0 $stage $result $rootOk
    if ($rootOk) {
      Show-D28Rows $result.json.data $session.uid
      '与写前基线一致（只有 recipe-001、002 且时间备注未变）：'+(Test-D28Rows $result.json.data $session.uid $base)
    } else { '未能读取，无法判断是否与基线一致（这不代表数据被改）。' }
  } catch {
    $reason=[string]$_.Exception.Message
    '已停止：「'+$stage+'」未完成。只读核对不会写任何数据。'
    if ($reason -cmatch '\A(?:密码为空|登录核验未通过|身份核验未通过|(?:登录请求失败|身份核验请求失败)（HTTP (?:\d{3}|无响应)）)\z') { '原因：'+$reason } else { '原因：已隐藏' }
  } finally {
    $session=$null; $result=$null
    $added=$global:Error.Count-$errorStart
    while ($added -gt 0) { $global:Error.RemoveAt(0); $added-- }
  }
  if ($steps.Count -gt 0) {
    $steps | Format-Table run,stage,started,http,verified,code,client_ms,gateway_request_id,function_request_id -AutoSize | Out-String -Width 240
  }
}
function Test-Day28Fingerprint([switch]$Quiet) {
  $names=@('Test-D28Keys','Test-D28Root','Get-D28Time','Get-D28Id','Invoke-D28Business','Test-D28Rows','Show-D28Rows',
    'Add-D28Step','Connect-D28','Invoke-Day28CrudRepeat','Invoke-Day28ReadCheck')
  $sha=[Security.Cryptography.SHA256]::Create()
  $text=''; $parts=@()
  foreach ($name in $names) {
    $command=Get-Command -Name $name -CommandType Function -ErrorAction SilentlyContinue
    if ($null -eq $command) { $text=$null; $parts+=($name+'=缺失'); continue }
    $piece=$name+"`n"+($command.Definition -replace "`r`n?","`n")+"`n"
    if ($null -ne $text) { $text+=$piece }
    $parts+=($name+'='+[BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($piece))).Replace('-','').Substring(0,8))
  }
  $hash='MISSING'
  if ($null -ne $text) { $hash=[BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($text))).Replace('-','') }
  $match=[string]::Equals($hash,'5D2DBB00A7703D92927EEB0447631CC14A4AD30493590D2B97EA7D1B525B7555',[StringComparison]::Ordinal)
  if ($Quiet) { return $match }
  if ($match) { return ('FINGERPRINT MATCH '+$hash.Substring(0,16)+'：请把这一行贴给 AI，确认是审核过的版本后再运行。') }
  return @(('FINGERPRINT MISMATCH '+$hash.Substring(0,[Math]::Min(16,$hash.Length))+'：不要运行，把下面几行一起发给 AI。')) + $parts
}
