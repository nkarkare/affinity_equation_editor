/**
 * name: Equation Editor
 * category: Tools
 * description: LaTeX equation editor for Affinity Publisher — add new equations
 *              and change equations you already made.
 *
 *              WHAT IT DOES:
 *              • Opens with "Add a NEW equation" chosen. Your old equations are
 *                never touched unless you pick one from the list yourself.
 *              • The list at the top shows every equation on the page. Pick one
 *                to change its maths or its size. It stays in the same spot.
 *              • Size is set in points (pt), the same as text. 18 pt maths looks
 *                like 18 pt writing on any document, at any DPI.
 *
 *              Requires: Edit → Preferences → Allow network access for scripts
 *              (only needed if you use the cloud fallback).
 */

'use strict';

(function () {

    // ── Imports ────────────────────────────────────────────────────────────────
    const { app }                                        = require('/application');
    const { Dialog, DialogResult }                       = require('/dialog');
    const { HttpRequest, RequestMethod }                 = require('/network');
    const { Colour }                                     = require('/colours');
    const { FillDescriptor, SolidFill }                  = require('/fills');
    const { LineStyleDescriptor }                        = require('/linestyle');
    const { CurveBuilder, PolyCurve }                    = require('/geometry');
    const { PolyCurveNodeDefinition }                    = require('/nodes');
    const { AddChildNodesCommandBuilder, InsertionMode } = require('/commands');
    const { Document }                                   = require('/document');

    // ── 50 essential symbols — 5 columns × 10 rows ────────────────────────────
    const SYMBOLS = [
        // Row 1 — Arithmetic
        ['±','\\pm'],            ['×','\\times'],         ['÷','\\div'],           ['·','\\cdot'],          ['∘','\\circ'],
        // Row 2 — Comparison
        ['≠','\\neq'],           ['≤','\\leq'],           ['≥','\\geq'],           ['≈','\\approx'],        ['≡','\\equiv'],
        // Row 3 — Logic
        ['∧','\\wedge'],         ['∨','\\vee'],           ['¬','\\neg'],           ['∀','\\forall'],        ['∃','\\exists'],
        // Row 4 — Greek I
        ['α','\\alpha'],         ['β','\\beta'],          ['γ','\\gamma'],         ['δ','\\delta'],         ['ε','\\varepsilon'],
        // Row 5 — Greek II
        ['θ','\\theta'],         ['λ','\\lambda'],        ['μ','\\mu'],            ['π','\\pi'],            ['σ','\\sigma'],
        // Row 6 — Greek III + uppercase
        ['φ','\\varphi'],        ['ω','\\omega'],         ['Γ','\\Gamma'],         ['Δ','\\Delta'],         ['Σ','\\Sigma'],
        // Row 7 — Calculus / special
        ['∞','\\infty'],         ['∂','\\partial'],       ['∇','\\nabla'],         ['ℝ','\\mathbb{R}'],     ['ℕ','\\mathbb{N}'],
        // Row 8 — Integrals & roots
        ['∫','\\int_{a}^{b}'],   ['∬','\\iint'],          ['∑','\\sum_{n=0}^{N}'], ['√','\\sqrt{x}'],       ['∛','\\sqrt[3]{x}'],
        // Row 9 — Arrows
        ['→','\\rightarrow'],    ['⇒','\\Rightarrow'],    ['⟹','\\implies'],       ['↔','\\leftrightarrow'],['↦','\\mapsto'],
        // Row 10 — Sets
        ['∈','\\in'],            ['∉','\\notin'],         ['∅','\\emptyset'],      ['∪','\\cup'],           ['∩','\\cap'],
    ];

    const TEMPLATES = [
        ['Quadratic formula',    '\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}'],
        ["Euler's identity",     'e^{i\\pi} + 1 = 0'],
        ['Gaussian integral',    '\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}'],
        ['Basel problem',        '\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}'],
        ['Bayes theorem',        'P(A|B) = \\dfrac{P(B|A)\\,P(A)}{P(B)}'],
        ['Normal distribution',  'f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}} e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}'],
        ["Maxwell's equation",   '\\nabla \\times \\mathbf{E} = -\\dfrac{\\partial \\mathbf{B}}{\\partial t}'],
        ["Schrödinger",          '\\hat{H}\\psi = i\\hbar\\dfrac{\\partial\\psi}{\\partial t}'],
        ['2×2 matrix',           '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}'],
        ['Taylor series',        'f(x) = \\sum_{n=0}^{\\infty} \\frac{f^{(n)}(a)}{n!}(x-a)^n'],
        ['Pythagorean theorem',  'a^2 + b^2 = c^2'],
        ['E = mc²',              'E = mc^2'],
    ];

    // ── Sizes in POINTS ───────────────────────────────────────────────────────
    // A point is the unit Affinity already uses for text, so 18 pt maths sits
    // next to 18 pt writing and matches it — on a 96 DPI web document and on a
    // 300 DPI print document alike.
    //
    // The old script sized equations in raw document pixels, which is why they
    // came out microscopic: 40 px is 14 mm at 72 DPI but only 3.4 mm at 300 DPI.
    const SIZES = [
        [10, 'Tiny — 10 pt'],
        [14, 'Small — 14 pt'],
        [18, 'Normal — 18 pt'],
        [24, 'Big — 24 pt'],
        [32, 'Very big — 32 pt'],
        [48, 'Huge — 48 pt'],
        [72, 'Poster — 72 pt'],
    ];
    const DEFAULT_SIZE_IDX = 2;   // Normal — 18 pt

    const DEFAULT_FORMULA = '\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}';

    // ── Guard ──────────────────────────────────────────────────────────────────
    const doc = Document.current;
    if (!doc) { app.alert('Please open a document first.', 'Equation Editor'); return; }

    const DPI       = (function () { try { return doc.dpi || 96; } catch (_) { return 96; } })();
    const PX_PER_PT = DPI / 72;

    // ── Remember the size you picked last time ────────────────────────────────
    // Kept in a small file in your home folder. Every step is optional — if any
    // of it fails the script quietly falls back to the default size.
    const PREFS_PATH = (function () {
        try {
            const desktop = app.userDesktopPath;            // ...\Users\Name\Desktop
            if (!desktop) return null;
            const cut = Math.max(desktop.lastIndexOf('\\'), desktop.lastIndexOf('/'));
            if (cut < 1) return null;
            return desktop.slice(0, cut) + desktop.charAt(cut) + '.affinity-equation-editor.json';
        } catch (_) { return null; }
    })();

    function loadPrefs() {
        if (!PREFS_PATH) return {};
        try {
            const { File } = require('/fs');
            return JSON.parse(File.readAll(PREFS_PATH).toString()) || {};
        } catch (_) { return {}; }
    }

    function savePrefs(prefs) {
        if (!PREFS_PATH) return;
        try {
            const { File } = require('/fs');
            const f = new File(PREFS_PATH, 'wb');
            f.writeStringAsUtf8(JSON.stringify(prefs));
            f.close();
        } catch (_) {}
    }

    const prefs = loadPrefs();

    function ptToSizeIdx(pt) {
        if (!pt) return DEFAULT_SIZE_IDX;
        let best = DEFAULT_SIZE_IDX, bestDiff = Infinity;
        SIZES.forEach(([p], i) => { const d = Math.abs(p - pt); if (d < bestDiff) { bestDiff = d; best = i; } });
        return best;
    }

    const rememberedSizeIdx = ptToSizeIdx(prefs.lastPt);

    // ── The layer tag ─────────────────────────────────────────────────────────
    // Written into the layer description so you can read it in the Layers panel,
    // and so this script can find its own equations again:
    //
    //     EQ 18pt: \frac{a}{b}
    //
    // Older tags are still understood:
    //     EQ:\frac{a}{b}||H:40     (v5 — size in document pixels)
    //     EQ:\frac{a}{b}           (v4 — no size)

    function makeTag(formula, pt) {
        return 'EQ ' + pt + 'pt: ' + formula;
    }

    function parseTag(desc) {
        if (!desc) return null;

        const m = desc.match(/^EQ\s+([0-9]+(?:\.[0-9]+)?)pt:\s?([\s\S]*)$/);
        if (m) return { formula: m[2], pt: parseFloat(m[1]) };

        if (desc.startsWith('EQ:')) {
            // Legacy tag. Its size was in pixels, which is what made old
            // equations tiny, so pt is left null and the current size is used
            // when it gets re-drawn.
            const body = desc.slice(3);
            const hIdx = body.indexOf('||H:');
            return { formula: hIdx >= 0 ? body.slice(0, hIdx) : body, pt: null };
        }
        return null;
    }

    // ── Plain-language preview of a formula, for the picker list ──────────────
    const PRETTY = [
        [/\\d?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '$1/$2'],
        [/\\sqrt\s*\{([^{}]*)\}/g,                  '√($1)'],
        [/\\left|\\right/g, ''],
        [/\\pm/g,'±'],    [/\\times/g,'×'],   [/\\div/g,'÷'],       [/\\cdot/g,'·'],
        [/\\neq/g,'≠'],   [/\\leq/g,'≤'],     [/\\geq/g,'≥'],       [/\\approx/g,'≈'],
        [/\\infty/g,'∞'], [/\\partial/g,'∂'], [/\\nabla/g,'∇'],     [/\\int/g,'∫'],
        [/\\sum/g,'∑'],   [/\\prod/g,'∏'],    [/\\alpha/g,'α'],     [/\\beta/g,'β'],
        [/\\gamma/g,'γ'], [/\\delta/g,'δ'],   [/\\theta/g,'θ'],     [/\\lambda/g,'λ'],
        [/\\mu/g,'μ'],    [/\\pi/g,'π'],      [/\\sigma/g,'σ'],     [/\\omega/g,'ω'],
        [/\\Delta/g,'Δ'], [/\\Sigma/g,'Σ'],   [/\\rightarrow/g,'→'],[/\\Rightarrow/g,'⇒'],
        [/\^\s*\{?2\}?/g, '²'], [/\^\s*\{?3\}?/g, '³'],
        [/\\begin\{[^}]*\}|\\end\{[^}]*\}/g, ' '],
        [/\\[a-zA-Z]+/g, ' '],
        [/[{}]/g, ''],
        [/\s+/g, ' '],
    ];

    function prettyPreview(latex, maxLen) {
        let s = latex || '';
        // Three passes so nested fractions collapse too.
        for (let pass = 0; pass < 3; pass++) {
            for (const [re, to] of PRETTY) s = s.replace(re, to);
        }
        s = s.trim() || (latex || '').trim();
        return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
    }

    // ── Find every equation on the current spread ─────────────────────────────
    function scanForEquations(parent, out) {
        try {
            for (const child of parent.children) {
                let desc = '';
                try { desc = child.userDescription || child.name || ''; } catch (_) {}
                const parsed = parseTag(desc);
                if (parsed) out.push({ node: child, formula: parsed.formula, pt: parsed.pt });
                scanForEquations(child, out);
            }
        } catch (_) {}
        return out;
    }

    const spread    = doc.currentSpread;
    const equations = spread ? scanForEquations(spread, []) : [];

    // ── What is selected right now? ───────────────────────────────────────────
    // Affinity clears the selection before a script started from the Scripts
    // PANEL runs, so this only finds something when the script is launched from
    // the Scripts MENU or from a keyboard shortcut. That is exactly why the
    // picker below exists — it works either way.
    function getSelectedNodes() {
        try {
            const sel = doc.selection;
            if (!sel || sel.length === 0) return [];
            try {
                if (sel.nodes && typeof sel.nodes.toArray === 'function') return sel.nodes.toArray();
            } catch (_) {}
            const out = [];
            for (let i = 0; i < sel.length; i++) {
                try { const item = sel.at(i); out.push(item && item.node ? item.node : item); } catch (_) {}
            }
            return out;
        } catch (_) { return []; }
    }

    // Index into `equations` of the selected equation, or -1 for none.
    let selectedEqIdx = -1;
    const selectedNodes = getSelectedNodes();
    for (let i = 0; i < selectedNodes.length && selectedEqIdx < 0; i++) {
        for (let j = 0; j < equations.length; j++) {
            let same = false;
            try { same = equations[j].node.isSameNode(selectedNodes[i]); } catch (_) {}
            if (same) { selectedEqIdx = j; break; }
        }
    }

    // ── The picker ────────────────────────────────────────────────────────────
    // Item 0 is always "add a new one", and it is what you get unless you choose
    // otherwise. Nothing on the page is replaced unless you pick it here — so
    // clicking OK twice in a row gives you two equations, not one.
    const pickerItems = ['✚  Add a NEW equation to the page'];
    equations.forEach((eq, i) => {
        pickerItems.push('✎  Change #' + (i + 1) + ':  ' + prettyPreview(eq.formula, 46));
    });

    const initialPickIdx = selectedEqIdx >= 0 ? selectedEqIdx + 1 : 0;

    // One remembered formula and size per picker item, so switching back and
    // forth in the list never loses what you typed.
    const draftFormula = [ DEFAULT_FORMULA ];
    const draftSizeIdx = [ rememberedSizeIdx ];
    equations.forEach(eq => {
        draftFormula.push(eq.formula);
        draftSizeIdx.push(eq.pt ? ptToSizeIdx(eq.pt) : rememberedSizeIdx);
    });

    // ── Build the dialog ──────────────────────────────────────────────────────
    const dlg = Dialog.create('Equation Editor');
    dlg.initialWidth = 520;
    dlg.setIsResizable(true);

    const col = dlg.addColumn();

    const pickGroup = col.addGroup('1.  Which equation?');
    const pickCombo = pickGroup.addComboBox('', pickerItems, initialPickIdx);
    pickCombo.setIsFullWidth(true);
    pickGroup.addStaticText('', equations.length === 0
        ? 'This page has no equations yet. Click OK to add your first one.'
        : 'Keep the top choice to add one more. Your other equations stay as they are.');

    const fGroup     = col.addGroup('2.  Maths (LaTeX)');
    const formulaBox = fGroup.addTextBox('', draftFormula[initialPickIdx]);
    formulaBox.setIsMultiLine(true).setRowSpan(4).setIsFullWidth(true);

    const symGroup   = col.addGroup('Symbols  (click one to add it at the end)');
    const symStack   = symGroup.addColumnStack();
    const symColGrps = [];
    for (let c = 0; c < 5; c++) symColGrps.push(symStack.addColumn().addGroup(''));
    SYMBOLS.forEach((sym, i) => {
        const btn = symColGrps[i % 5].addButton(sym[0]);
        btn.setIsFullWidth(true);
        btn.setOnClickHandler(() => { formulaBox.text = formulaBox.text + sym[1]; });
    });

    const tmplGroup = col.addGroup('Ready-made equations');
    const tmplCombo = tmplGroup.addComboBox('', TEMPLATES.map(t => t[0]), 0);
    tmplCombo.setIsFullWidth(true);
    const useBtn = tmplGroup.addButton('Use this one  ↑  (wipes the box above)');
    useBtn.setIsFullWidth(true);
    useBtn.setOnClickHandler(() => {
        const t = TEMPLATES[tmplCombo.selectedIndex];
        if (t) formulaBox.text = t[1];
    });

    const sizeGroup = col.addGroup('3.  How big?');
    const sizeCombo = sizeGroup.addComboBox('', SIZES.map(s => s[1]), draftSizeIdx[initialPickIdx]);
    sizeCombo.setIsFullWidth(true);
    sizeGroup.addStaticText('', 'Same points as text. 18 pt maths matches 18 pt writing.');

    // Picking a different equation loads its maths and its size.
    let shownIdx = initialPickIdx;
    pickCombo.setOnValueChangedHandler(() => {
        try {
            const next = pickCombo.selectedIndex;
            if (next === shownIdx) return;
            draftFormula[shownIdx] = formulaBox.text;
            draftSizeIdx[shownIdx] = sizeCombo.selectedIndex;
            shownIdx = next;
            formulaBox.text = draftFormula[next];
            sizeCombo.selectedIndex = draftSizeIdx[next];
        } catch (_) {}
    });

    // Setting the text last is deliberate — Affinity sometimes clears a text box
    // when more controls are added after it.
    formulaBox.text = draftFormula[initialPickIdx];
    if (dlg.runModal() !== DialogResult.Ok) return;

    const pickedIdx = pickCombo.selectedIndex;
    const formula   = (formulaBox.text || '').trim();
    const pt        = SIZES[sizeCombo.selectedIndex][0];

    if (!formula) {
        app.alert('The maths box is empty.\nType something and try again.', 'Equation Editor');
        return;
    }

    // pickedIdx 0 = brand new. Anything else = change that equation in place.
    const editingNode = (pickedIdx > 0 && equations[pickedIdx - 1]) ? equations[pickedIdx - 1].node : null;

    // ── Where does it go? ─────────────────────────────────────────────────────
    // Changing an equation keeps it exactly where it was. A new one lands in the
    // middle of the page, nudged a little each time so they do not stack up
    // perfectly hidden behind each other.
    function getSpreadBox() {
        try {
            const b = spread.getSpreadExtents({ includeSpread: true, includeBleed: false, includeChildren: false });
            if (b && b.width > 0) return b;
        } catch (_) {}
        try { const b = spread.spreadBaseBox; if (b && b.width > 0) return b; } catch (_) {}
        try { return { x: 0, y: 0, width: doc.widthPixels, height: doc.heightPixels }; } catch (_) {}
        return { x: 0, y: 0, width: 1000, height: 1000 };
    }

    let oldBox = null;
    if (editingNode) {
        try {
            oldBox = editingNode.spreadVisibleBox
                  || (typeof editingNode.getSpreadBaseBox === 'function' ? editingNode.getSpreadBaseBox() : null)
                  || editingNode.baseBox;
        } catch (_) {}
    }

    // ── Fetch the SVG ─────────────────────────────────────────────────────────
    const ENCODED   = encodeURIComponent(formula);
    const LOCAL_URL = 'http://localhost:3737?from=' + ENCODED;
    const CLOUD_URL = 'https://math.vercel.app?from=' + ENCODED;

    function tryFetch(url, timeoutSec) {
        try {
            const req = HttpRequest.create(url, RequestMethod.Get);
            req.setTimeoutInSec(timeoutSec);
            const resp = req.do().response;
            if (resp && resp.statusCode.value === 200) {
                const text = resp.content;
                if (text && text.includes('<svg')) return text;
            }
        } catch (_) {}
        return null;
    }

    let svgText = tryFetch(LOCAL_URL, 3);
    let source  = 'local';
    if (!svgText) { source = 'cloud'; svgText = tryFetch(CLOUD_URL, 20); }

    if (!svgText) {
        app.alert(
            'The equation could not be drawn.\n\n' +
            'Two things to check:\n' +
            '  1. Is the render server running? In a terminal, run:\n' +
            '        node katex_server.js\n' +
            '  2. For the online fallback, turn on:\n' +
            '        Edit → Preferences → Allow network access for scripts\n\n' +
            'Nothing on your page was changed.',
            'Equation Editor'
        );
        return;
    }

    // ── Did the maths actually work? ──────────────────────────────────────────
    // When LaTeX is wrong, MathJax hands back a picture of an error message: a
    // wide background box plus some text. The box would be drawn as a long black
    // bar on the page and the text would vanish, which tells the user nothing.
    // Catching it here means a plain explanation instead of a mystery.
    // The quote style has to be matched properly here: MathJax writes messages
    // like  data-mjx-error="Unknown environment 'pmatrix'"  with real
    // apostrophes inside the double quotes.
    const errMatch = svgText.match(/data-mjx-error\s*=\s*("|')([\s\S]*?)\1/);
    if (errMatch) {
        const raw = errMatch[2]
            .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

        // Turn the most common complaints into something readable.
        let plain = null, hint = null;
        let m;
        if ((m = raw.match(/Undefined control sequence\s*(\\\S+)/))) {
            plain = 'I do not know the command  ' + m[1];
            hint  = 'Check the spelling. Every command starts with a \\ .';
        } else if ((m = raw.match(/Unknown environment\s*'([^']*)'/))) {
            plain = 'I do not know the block  \\begin{' + m[1] + '}';
            hint  = 'Check the spelling inside the { } after \\begin.';
        } else if (/Misplaced &/.test(raw)) {
            plain = 'There is an  &  outside a table or matrix.';
            hint  = 'The  &  sign only works inside \\begin{...} ... \\end{...}.';
        } else if (/[Mm]issing.*brace|[Ee]xtra.*brace/.test(raw)) {
            plain = 'The curly brackets do not match.';
            hint  = 'Count them: every  {  needs one  }  to close it.';
        } else if (/Missing \\right|Extra \\left|\\left.*\\right/.test(raw)) {
            plain = 'A  \\left  has no matching  \\right.';
            hint  = 'Every \\left( needs a \\right) somewhere after it.';
        } else {
            plain = raw;
            hint  = 'Check the spelling, and that every { has a matching }.';
        }

        app.alert(
            'That maths has a mistake in it.\n\n' +
            plain + '\n\n' +
            hint + '\n\n' +
            'Nothing on your page was changed. Run the script again to fix it.',
            'Equation Editor'
        );
        return;
    }

    // ── SVG helpers ────────────────────────────────────────────────────────────
    const IDENTITY = [1, 0, 0, 1, 0, 0];

    function matMul(p, q) {
        return [
            p[0]*q[0]+p[2]*q[1],  p[1]*q[0]+p[3]*q[1],
            p[0]*q[2]+p[2]*q[3],  p[1]*q[2]+p[3]*q[3],
            p[0]*q[4]+p[2]*q[5]+p[4],  p[1]*q[4]+p[3]*q[5]+p[5],
        ];
    }

    function parseTransformAttr(s) {
        if (!s) return IDENTITY;
        let result = [...IDENTITY];
        const fnRe = /(\w+)\s*\(([^)]*)\)/g;
        let m, found = false;
        while ((m = fnRe.exec(s)) !== null) {
            found = true;
            const fn   = m[1];
            const args = m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
            let t;
            switch (fn) {
            case 'matrix':    t = [args[0],args[1],args[2],args[3],args[4]||0,args[5]||0]; break;
            case 'translate': t = [1,0,0,1,args[0]||0,args[1]||0]; break;
            case 'scale': { const sx=args[0],sy=args.length>1?args[1]:args[0]; t=[sx,0,0,sy,0,0]; break; }
            case 'rotate': {
                const a=(args[0]||0)*Math.PI/180, cos=Math.cos(a), sin=Math.sin(a);
                if (args.length>=3) {
                    const cx=args[1],cy=args[2];
                    t=[cos,sin,-sin,cos,cx*(1-cos)+cy*sin,cy*(1-cos)-cx*sin];
                } else t=[cos,sin,-sin,cos,0,0];
                break;
            }
            default: t=[...IDENTITY];
            }
            result = matMul(result, t);
        }
        return found ? result : IDENTITY;
    }

    function getAttr(attrStr, name) {
        const re = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*["\']([^"\']*)["\']');
        const m  = attrStr.match(re);
        return m ? m[1] : null;
    }

    // ── Work out the true size on the page ────────────────────────────────────
    // MathJax draws with 1000 viewBox units to one em, and one em IS the point
    // size. So one viewBox unit is worth pt × DPI / 72 / 1000 document pixels,
    // and the equation comes out the right size on any document.
    const vbMatch = svgText.match(/viewBox\s*=\s*["']([^"']*)["']/);
    if (!vbMatch) {
        app.alert('The drawing came back with no viewBox.\nNothing on your page was changed.', 'Equation Editor');
        return;
    }
    const [vbX, vbY, vbW, vbH] = vbMatch[1].split(/[\s,]+/).map(Number);

    const UNITS_PER_EM = 1000;
    const SCALE = (pt * PX_PER_PT) / UNITS_PER_EM;     // viewBox unit → document pixel

    // Geometry is built around (0, 0) first and moved into place afterwards.
    // The viewBox always has blank margin around the actual ink, and Affinity
    // reports an object's position by its INK, not its viewBox. Anchoring to the
    // viewBox corner therefore nudged an equation right and down a little on
    // every single re-edit. Measuring the real ink first removes that drift.
    function toLocal(mat, svgX, svgY) {
        const sx = mat[0]*svgX + mat[2]*svgY + mat[4];
        const sy = mat[1]*svgX + mat[3]*svgY + mat[5];
        return [ (sx - vbX) * SCALE, (sy - vbY) * SCALE ];
    }

    // ── Collect drawable elements ──────────────────────────────────────────────
    const elements = [];
    const xfStack  = [[...IDENTITY]];
    const tagRe    = /(<\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s[^>]*)?)(\/?)>/g;
    let tagMatch;

    while ((tagMatch = tagRe.exec(svgText)) !== null) {
        const isClose   = tagMatch[1] === '</';
        const tagName   = tagMatch[2];
        const attrStr   = tagMatch[3];
        const selfClose = tagMatch[4] === '/';

        if (!isClose) {
            const combined = matMul(
                xfStack[xfStack.length - 1],
                parseTransformAttr(getAttr(attrStr, 'transform'))
            );
            if (tagName === 'g' && !selfClose) {
                xfStack.push(combined);
            } else if (tagName === 'path') {
                const d = getAttr(attrStr, 'd');
                if (d) elements.push({ type: 'path', d, mat: combined });
            } else if (tagName === 'rect') {
                const x = parseFloat(getAttr(attrStr, 'x')      || '0');
                const y = parseFloat(getAttr(attrStr, 'y')      || '0');
                const w = parseFloat(getAttr(attrStr, 'width')  || '0');
                const h = parseFloat(getAttr(attrStr, 'height') || '0');
                if (w > 0 && h > 0) elements.push({ type: 'rect', x, y, w, h, mat: combined });
            }
        } else if (tagName === 'g' && xfStack.length > 1) {
            xfStack.pop();
        }
    }

    if (elements.length === 0) {
        app.alert('Nothing could be drawn from that maths.\nCheck the LaTeX and try again.\n\n' +
                  'Nothing on your page was changed.', 'Equation Editor');
        return;
    }

    // ── Trace the shapes ───────────────────────────────────────────────────────
    // Each shape is recorded as a start point plus a list of line and curve
    // steps, all measured from (0, 0). Nothing is handed to Affinity yet — the
    // exact size has to be known before the equation can be put in the right
    // place.
    const subpaths = [];
    let current = null;

    function penDown(x, y) { current = { x, y, segs: [], closed: false }; subpaths.push(current); }
    function penLine(x, y) { if (current) current.segs.push({ t: 'L', x, y }); }
    function penCurve(c1x, c1y, c2x, c2y, x, y) {
        if (current) current.segs.push({ t: 'C', c1x, c1y, c2x, c2y, x, y });
    }
    function penClose() { if (current) current.closed = true; }

    function parseSVGPath(d) {
        const out = [], re = /([MmLlHhVvCcSsQqTtZz])([^MmLlHhVvCcSsQqTtZz]*)/g;
        let m;
        while ((m = re.exec(d)) !== null) {
            out.push({ cmd: m[1], nums: m[2].trim() ? m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number) : [] });
        }
        return out;
    }

    function buildPath(d, mat) {
        const cmds = parseSVGPath(d);
        let cx=0,cy=0,sx=0,sy=0,pcp2x=0,pcp2y=0,cb=null;
        const finish = () => { cb = null; };
        const ensure = (X,Y) => {
            if (!cb) { cb = true; const [px,py] = toLocal(mat,X,Y); penDown(px,py); sx=X; sy=Y; }
        };

        for (const {cmd, nums} of cmds) {
            const rel = cmd !== 'Z' && cmd !== 'z' && cmd === cmd.toLowerCase();
            const ax  = dx => rel ? cx+dx : dx;
            const ay  = dy => rel ? cy+dy : dy;

            switch (cmd.toUpperCase()) {
            case 'M':
                finish();
                for (let i=0; i+1<nums.length; i+=2) {
                    const nx=ax(nums[i]), ny=ay(nums[i+1]);
                    if (i===0) { cx=nx; cy=ny; cb=true; const [px,py]=toLocal(mat,nx,ny); penDown(px,py); sx=nx; sy=ny; }
                    else       { const [px,py]=toLocal(mat,nx,ny); penLine(px,py); cx=nx; cy=ny; }
                }
                pcp2x=cx; pcp2y=cy; break;
            case 'L':
                for (let i=0; i+1<nums.length; i+=2) {
                    const nx=ax(nums[i]), ny=ay(nums[i+1]); ensure(cx,cy);
                    const [px,py]=toLocal(mat,nx,ny); penLine(px,py); cx=nx; cy=ny;
                }
                pcp2x=cx; pcp2y=cy; break;
            case 'H':
                for (const v of nums) { const nx=rel?cx+v:v; ensure(cx,cy); const [px,py]=toLocal(mat,nx,cy); penLine(px,py); cx=nx; }
                pcp2x=cx; pcp2y=cy; break;
            case 'V':
                for (const v of nums) { const ny=rel?cy+v:v; ensure(cx,cy); const [px,py]=toLocal(mat,cx,ny); penLine(px,py); cy=ny; }
                pcp2x=cx; pcp2y=cy; break;
            case 'C':
                for (let i=0; i+5<nums.length; i+=6) {
                    const c1x=ax(nums[i]), c1y=ay(nums[i+1]), c2x=ax(nums[i+2]), c2y=ay(nums[i+3]), ex=ax(nums[i+4]), ey=ay(nums[i+5]);
                    ensure(cx,cy);
                    penCurve(...toLocal(mat,c1x,c1y), ...toLocal(mat,c2x,c2y), ...toLocal(mat,ex,ey));
                    pcp2x=c2x; pcp2y=c2y; cx=ex; cy=ey;
                }
                break;
            case 'S':
                for (let i=0; i+3<nums.length; i+=4) {
                    const rc1x=2*cx-pcp2x, rc1y=2*cy-pcp2y, c2x=ax(nums[i]), c2y=ay(nums[i+1]), ex=ax(nums[i+2]), ey=ay(nums[i+3]);
                    ensure(cx,cy);
                    penCurve(...toLocal(mat,rc1x,rc1y), ...toLocal(mat,c2x,c2y), ...toLocal(mat,ex,ey));
                    pcp2x=c2x; pcp2y=c2y; cx=ex; cy=ey;
                }
                break;
            case 'Q':
                for (let i=0; i+3<nums.length; i+=4) {
                    const qcx=ax(nums[i]), qcy=ay(nums[i+1]), ex=ax(nums[i+2]), ey=ay(nums[i+3]);
                    const c1x=cx+(2/3)*(qcx-cx), c1y=cy+(2/3)*(qcy-cy), c2x=ex+(2/3)*(qcx-ex), c2y=ey+(2/3)*(qcy-ey);
                    ensure(cx,cy);
                    penCurve(...toLocal(mat,c1x,c1y), ...toLocal(mat,c2x,c2y), ...toLocal(mat,ex,ey));
                    pcp2x=c2x; pcp2y=c2y; cx=ex; cy=ey;
                }
                break;
            case 'T':
                for (let i=0; i+1<nums.length; i+=2) {
                    const qcx=2*cx-pcp2x, qcy=2*cy-pcp2y, ex=ax(nums[i]), ey=ay(nums[i+1]);
                    const c1x=cx+(2/3)*(qcx-cx), c1y=cy+(2/3)*(qcy-cy), c2x=ex+(2/3)*(qcx-ex), c2y=ey+(2/3)*(qcy-ey);
                    ensure(cx,cy);
                    penCurve(...toLocal(mat,c1x,c1y), ...toLocal(mat,c2x,c2y), ...toLocal(mat,ex,ey));
                    pcp2x=qcx; pcp2y=qcy; cx=ex; cy=ey;
                }
                break;
            case 'Z':
                if (cb) penClose(); finish(); cx=sx; cy=sy; pcp2x=cx; pcp2y=cy; break;
            }
        }
        finish();
    }

    function buildRect(x, y, w, h, mat) {
        let rY = y, rH = h;
        // MathJax uses <rect> only for horizontal rules (fraction bars, sqrt
        // bars, etc.). Thin any rect much wider than tall so bars do not look
        // blocky.
        if (w > h * 5) { rH = h * 0.30; rY = y + (h - rH) / 2; }
        penDown(...toLocal(mat, x,   rY));
        penLine(...toLocal(mat, x+w, rY));
        penLine(...toLocal(mat, x+w, rY+rH));
        penLine(...toLocal(mat, x,   rY+rH));
        penClose();
    }

    for (const el of elements) {
        if      (el.type === 'path') buildPath(el.d, el.mat);
        else if (el.type === 'rect') buildRect(el.x, el.y, el.w, el.h, el.mat);
    }

    // ── Measure the ink exactly ───────────────────────────────────────────────
    // A curve can bulge past its own control points, so the turning points of
    // each curve are solved for rather than guessed. This gives the same box
    // Affinity itself reports, which is what keeps a re-edited equation from
    // creeping across the page.
    function curveExtremes(p0, p1, p2, p3) {
        const out = [p0, p3];
        // Turning points: the roots of the derivative of the cubic.
        const a = -p0 + 3*p1 - 3*p2 + p3;
        const b =  2*p0 - 4*p1 + 2*p2;
        const c = -p0 + p1;
        const at = t => {
            if (t <= 0 || t >= 1) return;
            const u = 1 - t;
            out.push(u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3);
        };
        if (Math.abs(a) < 1e-12) {
            if (Math.abs(b) > 1e-12) at(-c / b);
        } else {
            const disc = b*b - 4*a*c;
            if (disc >= 0) {
                const r = Math.sqrt(disc);
                at((-b + r) / (2*a));
                at((-b - r) / (2*a));
            }
        }
        return out;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    function note(x, y) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    for (const sp of subpaths) {
        let px = sp.x, py = sp.y;
        note(px, py);
        for (const sg of sp.segs) {
            if (sg.t === 'L') { note(sg.x, sg.y); }
            else {
                for (const v of curveExtremes(px, sg.c1x, sg.c2x, sg.x)) note(v, py);
                for (const v of curveExtremes(py, sg.c1y, sg.c2y, sg.y)) note(px, v);
                note(sg.x, sg.y);
            }
            px = sg.x; py = sg.y;
        }
    }

    if (!isFinite(minX)) {
        app.alert('That maths produced an empty drawing.\nNothing on your page was changed.', 'Equation Editor');
        return;
    }

    const inkW = maxX - minX;
    const inkH = maxY - minY;

    // ── Work out where it goes ────────────────────────────────────────────────
    // Changing an equation puts the new ink exactly where the old ink sat, so it
    // never wanders. A new one is centred on the page, nudged along a little
    // each time so a stack of them does not hide behind itself.
    let PLACE_X, PLACE_Y;
    if (oldBox && oldBox.x != null && oldBox.y != null) {
        PLACE_X = oldBox.x;
        PLACE_Y = oldBox.y;
    } else {
        const sb   = getSpreadBox();
        const step = DPI * 0.15;                       // ~4 mm nudge per equation
        const n    = equations.length % 8;
        PLACE_X = (sb.x || 0) + Math.max(0, (sb.width  - inkW) / 2) + n * step;
        PLACE_Y = (sb.y || 0) + Math.max(0, (sb.height - inkH) / 2) + n * step;
    }

    const OFF_X = PLACE_X - minX;
    const OFF_Y = PLACE_Y - minY;

    // ── Hand the shapes to Affinity ───────────────────────────────────────────
    const polyCurve = PolyCurve.create();
    for (const sp of subpaths) {
        const cb = CurveBuilder.create();
        cb.beginXY(sp.x + OFF_X, sp.y + OFF_Y);
        for (const sg of sp.segs) {
            if (sg.t === 'L') cb.lineToXY(sg.x + OFF_X, sg.y + OFF_Y);
            else cb.addBezierXY(sg.c1x + OFF_X, sg.c1y + OFF_Y,
                                sg.c2x + OFF_X, sg.c2y + OFF_Y,
                                sg.x   + OFF_X, sg.y   + OFF_Y);
        }
        if (sp.closed) cb.close();
        polyCurve.addCurve(cb.createCurve());
    }

    // ── Put it on the page ────────────────────────────────────────────────────
    // Everything above this line can still bail out without touching the
    // document. From here on the page changes, so the old node goes first and
    // the new one lands straight after it.
    if (editingNode) {
        try { editingNode.delete(); }
        catch (_) { console.log('[EqEditor] Could not remove the old equation — delete that layer by hand.'); }
    }

    const black     = Colour.createRGBA8({ r: 0, g: 0, b: 0, alpha: 255 });
    const brushFill = FillDescriptor.createSolid(SolidFill.create(black));
    const noFill    = FillDescriptor.createNone();
    const lsd       = LineStyleDescriptor.createDefault();

    const pcDef = PolyCurveNodeDefinition.create(polyCurve, brushFill, lsd, noFill, noFill);
    pcDef.userDescription = makeTag(formula, pt);

    const builder = AddChildNodesCommandBuilder.create();
    builder.setInsertionTarget(spread);
    builder.setInsertionMode(InsertionMode.Inside_AtFront);
    builder.addPolyCurveNode(pcDef);
    doc.executeCommand(builder.createCommand(true));   // true → leaves it selected

    prefs.lastPt = pt;
    savePrefs(prefs);

    console.log('[EqEditor] ' + (editingNode ? 'changed' : 'added') +
                '  "' + formula + '"  ' + pt + 'pt  (' +
                Math.round(inkW) + '×' + Math.round(inkH) + ' px @ ' + DPI + ' dpi)' +
                '  shapes=' + elements.length + '  via ' + source);

})();
