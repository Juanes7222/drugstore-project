$log = "C:/Users/juanb/Documents/GitHub/drugstore-project/apps/pos-desktop/e2e/.artifacts/proc-tree.txt"
Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -like '*manual-backend.mjs*' -or
  $_.CommandLine -like '*npx tsx dist/apps/server/src/main.js*'
} | Select-Object ProcessId, ParentProcessId, Name, CommandLine |
  ConvertTo-Json | Out-File -Encoding utf8 $log
"done" | Out-File -Encoding utf8 $log -Append
