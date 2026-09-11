# Affinity Equation Editor

A LaTeX equation editor for **Affinity Publisher 2** — no external apps, no plugins, just one script. Type LaTeX, click OK, get a crisp vector equation on your canvas.

![Affinity Publisher 2](https://img.shields.io/badge/Affinity%20Publisher-2.x-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## How it works

The script calls a local MathJax rendering server (included) which converts LaTeX → SVG. The SVG paths are then drawn directly onto the Affinity canvas as native vector curves — fully scalable, fully editable, no rasterisation.

**One dialog handles everything.** The list at the top is the only thing that decides whether you add or change:

| Top of the dialog says | What happens on OK |
|---|---|
| ✚ Add a NEW equation to the page | A new equation is added. Nothing else is touched. |
| ✎ Change #2: a² + b² = c² | That one equation is redrawn, in the same spot. |

It opens on **✚ Add a NEW equation** every time, unless you had an equation selected when you launched the script — then it opens ready to change that one. Clicking OK twice in a row always gives you two equations, never one replacing the other.

### Editing an equation you already made

Affinity has no way for a script to hook a double-click on a layer, so double-clicking the layer cannot open this dialog. Use either of these instead:

- **Pick it from the list** — run the script and choose it under *1. Which equation?*. Works however you launch the script.
- **Select it first** — click the equation on the canvas, then run the script from the **Script menu** or a keyboard shortcut. It opens with that equation already chosen.

> Launching from the **Scripts panel** clears the selection before the script runs — that is an Affinity behaviour, not a bug in the script. The list exists so this never matters.

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
- Leave the top list on **✚ Add a NEW equation** to add one
- Type a LaTeX formula in the text box (e.g. `\frac{-b \pm \sqrt{b^2-4ac}}{2a}`)
- Click symbols from the palette to build the formula
- Choose a size and click **OK** — the new equation lands in the middle of the page, already selected, ready to drag
- To change one later: run the script and pick it from that same top list

---

## LaTeX support

Every MathJax 3 package is loaded — fractions, integrals, sums, Greek letters, matrices, aligned environments, cases, `\mathbb`, `\mathbf`, `\text`, and so on.

```latex
\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}           % Quadratic formula
e^{i\pi} + 1 = 0                             % Euler's identity
\int_{-\infty}^{\infty} e^{-x^2}\,dx         % Gaussian integral
\begin{pmatrix} a & b \\ c & d \end{pmatrix} % Matrix
\begin{cases} 1 & x > 0 \\ 0 & x \le 0 \end{cases}
```

If a formula has a mistake in it, the script says so in plain words — which command it did not recognise, or which brackets do not match — and leaves your page exactly as it was.

> **Note:** `\dfrac`, `\begin{pmatrix}`, `\begin{align}` and every other AMS command silently failed before. The server listed the AMS package but never imported it, so those commands came back as *"Undefined control sequence"*. Fixed in `server/katex_server.js` — **restart the render server** to pick it up.

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

## Size

Equations are sized in **points**, the same unit Affinity uses for text — so 18 pt maths sits next to 18 pt writing and matches it, whether the document is 96 DPI or 300 DPI.

| Choice | Size |
|---|---|
| Tiny | 10 pt |
| Small | 14 pt |
| **Normal** | **18 pt** (default) |
| Big | 24 pt |
| Very big | 32 pt |
| Huge | 48 pt |
| Poster | 72 pt |

The size you pick is remembered for next time, in `~/.affinity-equation-editor.json`.

> **Upgrading from v5?** Older versions sized equations in raw document pixels, which is why they came out microscopic on print documents — the old default of 40 px is 14 mm at 72 DPI but only 3.4 mm at 300 DPI. Old equations are still recognised; pick one from the list and click OK to redraw it at a proper point size.

---

## How equations are stored

Each equation is a native PolyCurve node. The layer description holds the formula and its size, so you can read it straight from the Layers panel:

```
EQ 18pt: \frac{a}{b}
```

The script finds its own equations by this tag, which is how the list at the top of the dialog is built. Tags from older versions (`EQ:\frac{a}{b}||H:40`) are still read.

---

## License

MIT — use freely in personal and commercial Affinity Publisher projects.
