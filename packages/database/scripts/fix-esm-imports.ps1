# Fix extensionless relative imports in compiled JS files for Node.js ESM compatibility.
# Prisma 7 generates imports like `from './enums'` which Node.js ESM cannot resolve.
# This script adds `.js` extensions: `from './enums.js'`

$patternSingle = "(from '\.(?:/[^']*)?[^'/.]+)')"
$patternDouble = '(from "\.(?:/[^"]*)?[^"/.]+)")'

Get-ChildItem -Path "$PSScriptRoot/../dist/generated/client" -Recurse -Filter "*.js" | ForEach-Object {
    $content = Get-Content -LiteralPath $_.FullName -Raw
    $updated = $content -replace $patternSingle, '$1.js'''
    $updated = $updated -replace $patternDouble, '$1.js"'
    if ($content -ne $updated) {
        [System.IO.File]::WriteAllText($_.FullName, $updated)
        Write-Output "Fixed: $($_.Name)"
    }
}
