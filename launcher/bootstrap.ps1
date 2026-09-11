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

# Checking that the folder exists is not enough — a half-finished install
# leaves mathjax-full in place while its own dependencies are missing, and the
# server then quietly drops to a reduced set of commands. Actually loading it
# is the only check that means anything.
function Test-MathJaxWorks {
    if (-not (Test-Path $mathjax)) { return $false }
    Push-Location $serverDir
    try {
        & $node -e "require('mathjax-full/js/input/tex/AllPackages.js')" *>&1 | Out-Null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    } finally {
        Pop-Location
    }
}

if (Test-MathJaxWorks) {
    Good 'Already installed'
} else {
    if (Test-Path $mathjax) {
        Warn 'The maths engine is only half installed. Repairing it.'
    }
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
        if (Test-MathJaxWorks) { break }
    }

    if (Test-MathJaxWorks) {
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
if ($copied) { Good 'That path is copied, in case you need it' }

# ── 5. Affinity ──────────────────────────────────────────────────────────────
# Affinity has to be up BEFORE Script Manager, because Script Manager talks to
# it over a small server Affinity itself runs on port 6767. Start them the other
# way round and Script Manager comes up reporting no bridge.
Step 'Affinity'

function Find-Affinity {
    foreach ($p in @(
        (Join-Path $env:ProgramFiles 'Affinity\Affinity\Affinity.exe'),
        (Join-Path $env:ProgramFiles 'Affinity\Publisher 2\Publisher.exe'),
        (Join-Path $env:ProgramFiles 'Affinity\Designer 2\Designer.exe'),
        (Join-Path $env:ProgramFiles 'Affinity\Photo 2\Photo.exe')
    )) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

# Affinity's bridge listens on IPv6 loopback ONLY. Two traps in that: a check
# against 127.0.0.1 alone reports it down, and a default TcpClient is an IPv4
# socket that cannot reach ::1 even when handed that address. Asking Windows
# what is listening sidesteps both.
function Test-Bridge {
    try {
        $listening = @(Get-NetTCPConnection -LocalPort 6767 -State Listen -ErrorAction Stop)
        if ($listening.Count -gt 0) { return $true }
        return $false
    } catch { }

    # Fallback where that cmdlet is missing. The socket family has to match the
    # address it is given, or the connect fails for the wrong reason.
    foreach ($pair in @(
        @('::1',       [Net.Sockets.AddressFamily]::InterNetworkV6),
        @('127.0.0.1', [Net.Sockets.AddressFamily]::InterNetwork)
    )) {
        $client = New-Object Net.Sockets.TcpClient($pair[1])
        try {
            $async = $client.BeginConnect($pair[0], 6767, $null, $null)
            if ($async.AsyncWaitHandle.WaitOne(700, $false)) {
                $client.EndConnect($async)
                return $true
            }
        } catch {
        } finally {
            $client.Close()
        }
    }
    return $false
}

$affinityExe = Find-Affinity

if (-not $affinityExe) {
    Warn 'Affinity is not installed on this PC.'
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Say '    Installing it with winget. This is a big download — please wait.'
        Say '    A Windows permission box may pop up — please say yes.'
        try {
            winget install --id Canva.Affinity --silent --accept-source-agreements --accept-package-agreements | Out-Null
        } catch {
            Warn "winget could not do it: $($_.Exception.Message)"
        }
        $affinityExe = Find-Affinity
    }
}

if (-not $affinityExe) {
    Warn 'Affinity could not be installed automatically.'
    Say  '    Get it from  https://affinity.serif.com  and run this file again.'
    Say  '    Affinity is paid software, so it needs your account after installing.'
} else {
    $affinityRunning = Get-Process -Name 'Affinity', 'Publisher', 'Designer', 'Photo' -ErrorAction SilentlyContinue
    if ($affinityRunning) {
        Good 'Affinity is already running'
    } else {
        try {
            Start-Process $affinityExe
            Good 'Started Affinity'
        } catch {
            Warn "Could not start Affinity: $($_.Exception.Message)"
        }
    }

    # Affinity takes a while to come up, and Script Manager is no use until its
    # bridge answers. Wait for it, but never hang on it.
    if (-not (Test-Bridge)) {
        Say '    Waiting for Affinity to finish starting...'
        for ($i = 0; $i -lt 60; $i++) {
            Start-Sleep -Seconds 2
            if (Test-Bridge) { break }
        }
    }
    if (Test-Bridge) {
        Good 'Affinity is ready'
    } else {
        Warn 'Affinity is up but its script bridge is not answering.'
        Say  '    Script Manager will retry on its own once you use it.'
    }
}

# ── 6. Script Manager ────────────────────────────────────────────────────────
Step 'Script Manager'

$smExeDir = Join-Path $env:LOCALAPPDATA 'Programs\affinity-script-manager'
$smExe    = Join-Path $smExeDir 'Script Manager for Affinity.exe'

if (-not (Test-Path $smExe)) {
    Warn 'Script Manager is not installed.'
    Say  '    Downloading it from GitHub...'
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $api = Invoke-RestMethod -Uri 'https://api.github.com/repos/JiriKrblich/Affinity-script-manager/releases/latest' -UseBasicParsing -Headers @{ 'User-Agent' = 'affinity-equation-editor' }
        $asset = $api.assets | Where-Object { $_.name -like '*Setup*.exe' } | Select-Object -First 1
        if (-not $asset) { throw 'no Windows installer in the latest release' }

        $setup = Join-Path $env:TEMP $asset.name
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $setup -UseBasicParsing
        Say  "    Installing $($asset.name)..."
        Start-Process $setup -Wait
        Remove-Item $setup -Force -ErrorAction SilentlyContinue
    } catch {
        Warn "Could not install Script Manager: $($_.Exception.Message)"
        Say  '    Get it from  https://github.com/JiriKrblich/Affinity-script-manager/releases'
    }
}

# Its watched folder only exists once it has run at least once.
$smData    = Join-Path $env:APPDATA 'affinity-script-manager'
$smScripts = Join-Path $smData 'MyScripts'
$usingSM   = $false

if (Test-Path $smExe) {
    # The filename has to match the "name:" field in the script header, or
    # Script Manager will not treat a change as an update to the installed copy.
    try {
        if (-not (Test-Path $smScripts)) { New-Item -ItemType Directory -Path $smScripts -Force | Out-Null }
        Copy-Item $SCRIPT_JS (Join-Path $smScripts 'Equation Editor.js') -Force
        $usingSM = $true
        Good 'Copied in as "Equation Editor"'
    } catch {
        Warn "Could not copy the script in: $($_.Exception.Message)"
    }

    $smRunning = Get-Process -Name 'Script Manager for Affinity' -ErrorAction SilentlyContinue
    if ($smRunning) {
        Good 'Script Manager is already running — it will pick this up'
    } else {
        try {
            Start-Process $smExe
            Good 'Started Script Manager'
        } catch {
            Warn 'Could not start Script Manager — open it yourself.'
        }
    }
}

Say ''
Say '  -------------------------------------------------------'
if ($usingSM) {
    Say '   FIRST TIME ONLY:'
    Say ''
    Say '     1. In Script Manager, find "Equation Editor"'
    Say '        under My Scripts'
    Say '     2. Click the install dot next to it'
    Say ''
    Say '   After that it updates itself. Run this file again'
    Say '   and the newest version goes straight into Affinity.'
} else {
    Say '   To put this into Affinity by hand:'
    Say ''
    Say '     1. Open Affinity'
    Say '     2. Menu:  View  >  Studio  >  Scripts'
    Say '     3. Click the  +  (or Add) button'
    Say '     4. Paste the path with Ctrl+V and press Enter'
    Say ''
    Say '   Affinity keeps its own copy, so after an update you'
    Say '   have to add it again. Installing Script Manager'
    Say '   makes that automatic.'
}
Say '  -------------------------------------------------------'

if ($NoStart) {
    Say ''
    Say '  Setup finished.'
    Wait-ForKey
    exit 0
}

# ── 7. Start the server ───────────────────────────────────────────────────────
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
