# Affinity Equation Editor

A LaTeX equation editor for **Affinity Publisher 2** — no external apps, no plugins, just one script. Type LaTeX, click OK, get a crisp vector equation on your canvas.

![Affinity Publisher 2](https://img.shields.io/badge/Affinity%20Publisher-2.x-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## How it works

The script calls a local MathJax rendering server (included) which converts LaTeX → SVG. The SVG paths are then drawn directly onto the Affinity canvas as native vector curves — fully scalable, fully editable, no rasterisation.

**Modes — one script handles everything:**

| Selection state | What happens |
|---|---|
| Select an EQ-tagged equation | Re-edits it — formula and size pre-filled |
| Select any other object | Replaces it with a new equation |
| Nothing selected, equations on page | Auto-picks the most recent one to edit |
| Nothing selected, blank page | Fresh create dialog |

---

## Files

| File | Purpose |
|---|---|
| `equation_editor.js` | The Affinity Publisher script — **this is the main deliverable** |
| `server/katex_server.js` | Standalone MathJax render server — run with Node, no build step |
| `server/server.js` | Node.js source for the packaged (`server.exe`) renderer |
| `server/package.json` | npm config for building `server.exe` with `pkg` |
| `server/service.xml` | WinSW config to run the renderer as a Windows service |
| `server/build.ps1` | PowerShell build script — produces `server.exe` + installer |

**Binaries** (attached to the [latest GitHub Release](../../releases/latest)):

| File | Purpose |
|---|---|
| `AffinityEquationRenderer-Package.zip` | All-in-one package: server, service wrapper, install bat |
| `AffinityEquationRenderer-Setup.exe` | Windows installer (installs + registers the service) |

---

## Quick start

### 1 — Start the local render server

Two options depending on your setup:

**Option A — `katex_server.js` (simplest, no install)**

Requires [Node.js 14+](https://nodejs.org/).

```bash
cd server
npm install mathjax-full
node katex_server.js
```

The server starts on `http://localhost:3737` and stays running in that terminal. Leave it open while using Affinity.

**Verify:**
```
curl http://localhost:3737/health
# → {"status":"ok","engine":"mathjax3"}
```

**Option B — Windows service (set-and-forget)**

Download `AffinityEquationRenderer-Package.zip` from the [Releases page](../../releases/latest), extract it, and run `install.bat` as Administrator.

This installs a Windows service (`AffinityEquationRenderer`) that starts automatically on boot.

**Verify:**
```
curl http://localhost:3737/health
```

> **No server?** The script falls back to `https://math.vercel.app` (cloud) automatically — slower, requires network access enabled in Affinity preferences.

### 2 — Add the script to Affinity Publisher

1. Open **Affinity Publisher 2**
2. Go to **Script → Script Manager** (see [Affinity Script Manager docs](https://affinity.serif.com/en-us/tutorials/publisher/desktop/tutorial/scripting-an-introduction/))
3. Click **Add** and select `equation_editor.js`
4. Optionally assign it a keyboard shortcut

> **Network access:** Enable it once via **Edit → Preferences → Allow network access for scripts**.

### 3 — Use it

- Run the script from **Script → equation_editor** (or your shortcut)
- Type a LaTeX formula in the text box (e.g. `\frac{-b \pm \sqrt{b^2-4ac}}{2a}`)
- Click symbols from the palette to build the formula
- Choose a size and click **OK**
- To re-edit: select the equation on the canvas and run the script again

---

## LaTeX support

Anything MathJax 3 supports — fractions, integrals, sums, Greek letters, matrices, aligned environments, `\mathbb`, `\mathbf`, etc.

```latex
\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}          % Quadratic formula
e^{i\pi} + 1 = 0                             % Euler's identity
\int_{-\infty}^{\infty} e^{-x^2}\,dx        % Gaussian integral
\begin{pmatrix} a & b \\ c & d \end{pmatrix} % Matrix
```

---

## Building from source

Requires Node.js 18+, `pkg`, and PowerShell 7+.

```powershell
cd installer
npm install
.\build.ps1
# Outputs: dist\server.exe, dist\AffinityEquationRenderer-Package.zip
```

Or build `server.exe` alone:
```bash
npm install -g pkg
npm install
pkg server.js --targets node18-win-x64 --output dist/server.exe
```

---

## How equations are stored

Each equation is stored as a native PolyCurve node. The layer name encodes the formula and size:

```
EQ:\frac{a}{b}||H:40
```

When you select the node and re-run the script, it reads this tag to pre-fill the editor — so you always get back to the original LaTeX.

---

## License

MIT — use freely in personal and commercial Affinity Publisher projects.
