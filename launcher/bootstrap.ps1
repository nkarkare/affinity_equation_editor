# Affinity Equation Editor — one-click setup and start
# -----------------------------------------------------
# Gets Node if it is missing, downloads the newest code, installs what the
# render server needs, and starts it. Safe to run again any time.
#
# Written for Windows PowerShell 5.1 (the one built into Windows) — so no
# ternaries, no ?? operator, nothing newer.

param(
    [switch]$Debug,
    [switch]$Trace,
    [int]$Port = 3737,
    [switch]$NoStart
)

$ErrorActionPreference = 'Stop'

$REPO_ZIP  = 'https://github.com/nkarkare/affinity_equation_editor/archive/refs/heads/main.zip'
$REPO_GIT  = 'https://github.com/nkarkare/affinity_equation_editor.git'
$HOME_DIR  = Join-Path $env:LOCALAPPDATA 'AffinityEquationEditor'
$APP_DIR   = Join-Path $HOME_DIR 'app'          # the code lives here
$SCRIPT_JS = Join-Path $APP_DIR 'equation_editor.js'
$SERVER_JS = Join-Path $APP_DIR 'server\katex_server.js'

# ── Pretty output ─────────────────────────────────────────────────────────────
function Say    ($m) { Write-Host $m }
function Step   ($m) { Write-Host ''; Write-Host "==> $m" -ForegroundColor Cyan }
function Good   ($m) { Write-Host "    OK  $m" -ForegroundColor Green }
function Warn   ($m) { Write-Host "    !   $m" -ForegroundColor Yellow }
function Oops   ($m) { Write-Host ''; Write-Host "    X   $m" -ForegroundColor Red }

# Waits for a keypress so the window does not vanish before it can be read —
# but only when there is a real person at a keyboard. Run from a script or a
# pipe it just returns, instead of throwing.
function Wait-ForKey {
    if ($env:AEE_NO_PAUSE -eq '1') { return }
    Write-Host '  Press any key to close this window.'
    try {
        $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
    } catch {
        # No interactive console attached. Nothing to wait for.
    }
}

function Stop-Here ($what, $fix) {
    Oops $what
    Write-Host ''
    Write-Host '    What to do:' -ForegroundColor Yellow
    foreach ($line in $fix) { Write-Host "      - $line" }
    Write-Host ''
    Wait-ForKey
    exit 1
}

try { Clear-Host } catch { }
Say ''
Say '  ============================================='
Say '   Affinity Equation Editor'
Say '   Setting things up. This can take a minute.'
Say '  ============================================='

# ── 1. Node ───────────────────────────────────────────────────────────────────
Step 'Looking for Node.js'

function Find-Node {
    # `where` misses a Node installed moments ago in this same session, so the
    # usual install spots get checked too.
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($p in @(
        (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
    )) {
        if ($p -and (Test-Path $p)) { return $p }
    }
    return $null
}

function Refresh-Path {
    $m = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $u = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$m;$u"
}

$node = Find-Node

if (-not $node) {
    Warn 'Node.js is not installed. Installing it now.'
    Say  '    A Windows permission box may pop up — please say yes.'

    $installed = $false

    # winget ships with Windows 11 and is the tidiest way in.
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Say '    Installing with winget...'
        try {
            winget install --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements | Out-Null
            Refresh-Path
            $node = Find-Node
            if ($node) { $installed = $true }
        } catch {
            Warn "winget could not do it: $($_.Exception.Message)"
        }
    }

    # Fall back to downloading the official installer.
    if (-not $installed) {
        Say '    Downloading the Node.js installer instead...'
        try {
            $arch = 'x64'
            if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $arch = 'arm64' }
            $msi = Join-Path $env:TEMP "node-lts-$arch.msi"
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            $url = "https://nodejs.org/dist/v20.18.1/node-v20.18.1-$arch.msi"
            Invoke-WebRequest -Uri $url -OutFile $msi -UseBasicParsing
            Say '    Running the installer (please accept the permission box)...'
            Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qb" -Wait
            Refresh-Path
            $node = Find-Node
        } catch {
            Warn "Download failed: $($_.Exception.Message)"
        }
    }

    if (-not $node) {
        Stop-Here 'Node.js could not be installed automatically.' @(
            'Go to  https://nodejs.org',
            'Download the big green LTS button and install it.',
            'Then run this file again.'
        )
    }
}

$nodeVersion = (& $node --version) 2>$null
Good "Node.js $nodeVersion"

# node and npm sit side by side; npm.cmd is what actually runs on Windows.
$npm = Join-Path (Split-Path $node) 'npm.cmd'
if (-not (Test-Path $npm)) {
    $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
    if ($npmCmd) { $npm = $npmCmd.Source }
}
if (-not (Test-Path $npm)) {
    Stop-Here 'Node.js is installed but npm is missing.' @(
        'Reinstall Node.js from  https://nodejs.org',
        'Then run this file again.'
    )
}

# ── 2. Newest code ────────────────────────────────────────────────────────────
Step 'Getting the newest version'

if (-not (Test-Path $HOME_DIR)) { New-Item -ItemType Directory -Path $HOME_DIR -Force | Out-Null }

$gotCode = $false
$git = Get-Command git -ErrorAction SilentlyContinue

if ($git -and (Test-Path (Join-Path $APP_DIR '.git'))) {
    # Already a clone — just pull. Local edits are dropped on purpose so the
    # copy here always matches what is published.
    try {
        Push-Location $APP_DIR
        & git fetch --quiet origin main 2>&1 | Out-Null
        & git reset --hard origin/main 2>&1 | Out-Null
        Pop-Location
        $gotCode = $true
        Good 'Updated with git'
    } catch {
        Pop-Location -ErrorAction SilentlyContinue
        Warn 'git update failed — downloading a fresh copy instead.'
    }
}

if (-not $gotCode -and $git -and -not (Test-Path $APP_DIR)) {
    try {
        & git clone --quiet --depth 1 $REPO_GIT $APP_DIR 2>&1 | Out-Null
        if (Test-Path $SCRIPT_JS) { $gotCode = $true; Good 'Downloaded with git' }
    } catch {
        Warn 'git clone failed — downloading a zip instead.'
    }
}

if (-not $gotCode) {
    # No git needed for this path, which is the point.
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $zip     = Join-Path $env:TEMP 'affinity-equation-editor.zip'
        $unzip   = Join-Path $env:TEMP 'affinity-equation-editor-unzip'
        Say '    Downloading...'
        Invoke-WebRequest -Uri $REPO_ZIP -OutFile $zip -UseBasicParsing

        if (Test-Path $unzip) { Remove-Item $unzip -Recurse -Force }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [IO.Compression.ZipFile]::ExtractToDirectory($zip, $unzip)

        # GitHub wraps everything in a <repo>-main folder.
        $inner = Get-ChildItem $unzip -Directory | Select-Object -First 1
        if (-not $inner) { throw 'the download looked empty' }

        # Keep node_modules so npm install stays fast next time.
        $keep = Join-Path $APP_DIR 'server\node_modules'
        $stash = $null
        if (Test-Path $keep) {
            $stash = Join-Path $env:TEMP 'aee_node_modules'
            if (Test-Path $stash) { Remove-Item $stash -Recurse -Force }
            Move-Item $keep $stash
        }

        if (Test-Path $APP_DIR) { Remove-Item $APP_DIR -Recurse -Force }
        Move-Item $inner.FullName $APP_DIR

        if ($stash) {
            $dest = Join-Path $APP_DIR 'server'
            if (-not (Test-Path $dest)) { New-Item -ItemType Directory -Path $dest -Force | Out-Null }
            Move-Item $stash (Join-Path $dest 'node_modules')
        }

        Remove-Item $zip -Force -ErrorAction SilentlyContinue
        Remove-Item $unzip -Recurse -Force -ErrorAction SilentlyContinue
        $gotCode = $true
        Good 'Downloaded the newest version'
    } catch {
        if (Test-Path $SCRIPT_JS) {
            Warn "Could not download ($($_.Exception.Message)). Using the copy already on this PC."
            $gotCode = $true
        } else {
            Stop-Here "The newest version could not be downloaded: $($_.Exception.Message)" @(
                'Check that this PC is connected to the internet.',
                'If your workplace blocks GitHub, ask IT about github.com.',
                'Then run this file again.'
            )
        }
    }
}

if (-not (Test-Path $SERVER_JS)) {
    Stop-Here 'The download is missing the render server.' @(
        "Delete this folder and run the file again:  $HOME_DIR"
    )
}

# ── 3. Dependencies ───────────────────────────────────────────────────────────
Step 'Checking the maths engine'

$serverDir = Join-Path $APP_DIR 'server'
$mathjax   = Join-Path $serverDir 'node_modules\mathjax-full\package.json'

if (Test-Path $mathjax) {
    Good 'Already installed'
} else {
    Say '    Installing MathJax. First time only, please wait...'

    # A dropped connection part-way through a download is common enough on
    # school and office networks to be worth simply trying again.
    $lastOutput = ''
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        if ($attempt -gt 1) {
            Warn "That did not work. Trying again ($attempt of 3)..."
            Start-Sleep -Seconds 3
        }
        Push-Location $serverDir
        try {
            # 2>&1 on a native command makes PowerShell treat stderr lines as
            # errors, so it is routed to a plain string instead.
            $lastOutput = (& $npm install --no-audit --no-fund --loglevel=error *>&1 | Out-String)
        } catch {
            $lastOutput = $_.Exception.Message
        } finally {
            Pop-Location
        }
        if (Test-Path $mathjax) { break }
    }

    if (Test-Path $mathjax) {
        Good 'MathJax installed'
    } else {
        $hint = @(
            'Check that this PC is connected to the internet.',
            'Then run this file again.'
        )
        if ($lastOutput -match 'ECONNRESET|ETIMEDOUT|ENOTFOUND|network|proxy') {
            $hint = @(
                'This PC could not reach registry.npmjs.org.',
                'If you are on a school or office network, that address may be blocked —',
                '  ask IT to allow it, or try again on a home network.',
                'If you use a proxy, run:  npm config set proxy http://YOUR-PROXY:PORT',
                'Then run this file again.'
            )
        }
        Say ''
        Say '    npm said:'
        foreach ($line in ($lastOutput -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -First 6)) {
            Say "      $line"
        }
        Stop-Here 'The maths engine could not be installed.' $hint
    }
}

# ── 4. Hand the script to the user ────────────────────────────────────────────
Step 'The Affinity script'

Good $SCRIPT_JS

# Copying the path saves the user typing it into Affinity's file picker.
$copied = $false
try { Set-Clipboard -Value $SCRIPT_JS; $copied = $true } catch { }
if (-not $copied) {
    try { $SCRIPT_JS | clip.exe; $copied = $true } catch { }
}
if ($copied) { Good 'That path is copied — just paste it into Affinity' }

Say ''
Say '  -------------------------------------------------------'
Say '   To put this into Affinity (only needed once, and'
Say '   again whenever the script itself changes):'
Say ''
Say '     1. Open Affinity Publisher'
Say '     2. Menu:  View  >  Studio  >  Scripts'
Say '     3. Click the  +  (or Add) button'
Say '     4. Paste the path with Ctrl+V and press Enter'
Say ''
Say '   Affinity keeps its own copy of the script, so after'
Say '   an update you have to add it again to get the newest'
Say '   one. The maths server updates on its own.'
Say '  -------------------------------------------------------'

try { Start-Process explorer.exe "/select,`"$SCRIPT_JS`"" } catch { }

if ($NoStart) {
    Say ''
    Say '  Setup finished.'
    Wait-ForKey
    exit 0
}

# ── 5. Start the server ───────────────────────────────────────────────────────
Step 'Starting the maths server'

# Something already on the port is almost always this same server from earlier.
# A plain TCP connect answers instantly, where the first Invoke-WebRequest of a
# session can spend longer than that just warming up and time out on a server
# that is in fact running.
function Test-PortOpen ($portNumber) {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect('127.0.0.1', $portNumber, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(1500, $false)) { return $false }
        $client.EndConnect($async)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

$busy = Test-PortOpen $Port

if ($busy) {
    Good "Already running on port $Port"
    Say ''
    Say '  Nothing else to do. You can close this window and use Affinity.'
    Say ''
    Say "  If equations will not draw, look at:  http://localhost:$Port/debug"
    Say ''
    Wait-ForKey
    exit 0
}

$serverArgs = @((Join-Path $serverDir 'katex_server.js'))
if ($Trace)      { $serverArgs += '--trace' }
elseif ($Debug)  { $serverArgs += '--debug' }
if ($Port -ne 3737) { $serverArgs += '--port'; $serverArgs += "$Port" }

Say ''
Say '  -------------------------------------------------------'
Say '   Leave this window OPEN while you use Affinity.'
Say '   Closing it turns the maths off.'
Say ''
Say "   Something wrong?  http://localhost:$Port/debug"
Say '  -------------------------------------------------------'
Say ''

Push-Location $serverDir
& $node $serverArgs
Pop-Location

Say ''
Say '  The maths server has stopped.'
Wait-ForKey
