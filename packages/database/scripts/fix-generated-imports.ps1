# Add .js extensions to extensionless relative imports in Prisma-generated .ts files.
# Prisma 7 generates imports like `from './enums'` without .js extensions.
# Node.js ESM requires explicit .js extensions, so we fix them in the generated source.

$singleQuote = "(from '\.(?:/[^']*)?[^'/.]+)')"
$doubleQuote = '(from "\.(?:/[^"]*)?[^"/.]+)")'

Get-ChildItem -Path "$PSScriptRoot/../generated/client" -Recurse -Filter "*.ts" | ForEach-Object {
    $content = Get-Content -LiteralPath $_.FullName -Raw
    $updated = $content -replace $singleQuote, '$1.js'''
    $updated = $updated -replace $doubleQuote, '$1.js"'
    if ($content -ne $updated) {
        [System.IO.File]::WriteAllText($_.FullName, $updated)
        Write-Output "Fixed: $($_.Name)"
    }
}
