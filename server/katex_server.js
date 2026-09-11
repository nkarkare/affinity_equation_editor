#!/usr/bin/env node
/**
 * Local LaTeX → SVG render server for Affinity
 * -----------------------------------------------
 * Uses MathJax 3 with liteAdaptor — ZERO browser / DOM dependency.
 * KaTeX requires a DOM so we use MathJax which has a built-in lightweight adaptor.
 *
 * SETUP (one time):
 *   npm install mathjax-full
 *
 * START:
 *   node katex_server.js                 normal
 *   node katex_server.js --debug         log every render: timing, size, errors
 *   node katex_server.js --trace         --debug plus the full SVG of failures
 *   node katex_server.js --port 4000     use a different port
 *
 * API:
 *   GET /?from=\frac{a}{b}   → SVG text
 *   GET /health              → {"status":"ok", ...}
 *   GET /debug               → what the server has rendered so far, and every
 *                              failure it has seen. Open it in a browser when
 *                              an equation will not draw.
 *
 * The Affinity script calls this automatically before falling back to the cloud.
 */

'use strict';

const http = require('http');

// ── Options ───────────────────────────────────────────────────────────────────
const ARGS  = process.argv.slice(2);
const TRACE = ARGS.includes('--trace');
const DEBUG = TRACE || ARGS.includes('--debug') || process.env.EQ_DEBUG === '1';
const PORT  = (function () {
    const i = ARGS.indexOf('--port');
    const p = i >= 0 ? parseInt(ARGS[i + 1], 10) : parseInt(process.env.EQ_PORT, 10);
    return Number.isInteger(p) && p > 0 && p < 65536 ? p : 3737;
})();

// ── Render log ────────────────────────────────────────────────────────────────
// Kept in memory and served at /debug, so a failing equation can be diagnosed
// without reading the terminal or restarting anything.
const MAX_LOG = 100;
const stats   = { started: new Date().toISOString(), ok: 0, failed: 0, engine: null };
const history = [];
const failures = [];

function record(entry) {
    history.unshift(entry);
    if (history.length > MAX_LOG) history.pop();
    if (entry.error) {
        failures.unshift(entry);
        if (failures.length > MAX_LOG) failures.pop();
        stats.failed++;
    } else {
        stats.ok++;
    }
}

function debugLog() {
    if (!DEBUG) return;
    console.log('[debug] ' + Array.from(arguments).join(' '));
}

// ── Boot MathJax ──────────────────────────────────────────────────────────────
// mathjax-full is ESM; use dynamic import() from CJS. Requires Node 14+.
async function bootMathJax() {
    const { mathjax }             = await import('mathjax-full/js/mathjax.js');
    const { TeX }                 = await import('mathjax-full/js/input/tex.js');
    const { SVG }                 = await import('mathjax-full/js/output/svg.js');
    const { liteAdaptor }         = await import('mathjax-full/js/adaptors/liteAdaptor.js');
    const { RegisterHTMLHandler } = await import('mathjax-full/js/handlers/html.js');

    // Naming a package in the list below is NOT enough — each extension has to
    // be imported so that it registers itself first. Without this line \dfrac,
    // \begin{pmatrix}, \begin{align} and every other AMS command came back as
    // "Undefined control sequence". Importing AllPackages registers the lot.
    //
    // AllPackages also drags in mhchem and physics, which need extra modules of
    // their own. If an install is incomplete, loading the lot throws and the
    // server would refuse to start at all — so a core set is loaded one by one
    // as a fallback. Better to draw fractions and matrices than nothing.
    let packages;
    try {
        const { AllPackages } = await import('mathjax-full/js/input/tex/AllPackages.js');
        packages = AllPackages;
        debugLog('loaded AllPackages');
    } catch (e) {
        console.log('');
        console.log('Note: not every MathJax add-on could be loaded (' + e.message.split('\n')[0] + ').');
        console.log('Loading the main ones instead. Fractions, matrices and Greek letters will work.');
        console.log('To get all of them back:  npm install');
        console.log('');

        packages = ['base'];
        const core = [
            ['ams',        'ams/AmsConfiguration.js'],
            ['boldsymbol', 'boldsymbol/BoldsymbolConfiguration.js'],
            ['newcommand', 'newcommand/NewcommandConfiguration.js'],
            ['cases',      'cases/CasesConfiguration.js'],
            ['color',      'color/ColorConfiguration.js'],
            ['enclose',    'enclose/EncloseConfiguration.js'],
            ['textmacros', 'textmacros/TextMacrosConfiguration.js'],
            ['unicode',    'unicode/UnicodeConfiguration.js'],
        ];
        await import('mathjax-full/js/input/tex/base/BaseConfiguration.js');
        for (const [name, file] of core) {
            try {
                await import('mathjax-full/js/input/tex/' + file);
                packages.push(name);
            } catch (_) {
                debugLog('skipped package', name);
            }
        }
    }

    const adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);

    // 'noerrors' and 'noundefined' are deliberately dropped. They swallow
    // mistakes and quietly draw red "\dfrac" text into the page instead. Left
    // out, a bad formula produces a proper error that the Affinity script can
    // catch and explain in plain words — far better than a mystery on the page.
    packages = packages.filter(p => p !== 'noerrors' && p !== 'noundefined');

    const doc = mathjax.document('', {
        InputJax:  new TeX({
            packages,
        }),
        OutputJax: new SVG({
            fontCache:  'none',   // inline all glyph paths — self-contained SVG
            displayAlign: 'center',
        }),
    });

    return { mathjax, adaptor, doc, packageCount: packages.length };
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderSVG(ctx, latex, display) {
    const node = ctx.doc.convert(latex, { display: !!display });
    const html = ctx.adaptor.outerHTML(node);

    // MathJax wraps the SVG in an <mjx-container> element; extract the inner SVG
    const svgMatch = html.match(/<svg[\s\S]*<\/svg>/i);
    if (!svgMatch) throw new Error('MathJax returned no SVG element');

    let svg = svgMatch[0];

    // Make sure xmlns is present so Affinity's SVG parser is happy
    if (!svg.includes('xmlns=')) {
        svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    return svg;
}

// ── Look the drawing over before sending it ──────────────────────────────────
// A bad formula still comes back as a valid SVG — a picture of an error
// message. Spotting that here means the log says what actually went wrong
// instead of "200 OK".
function inspect(svg) {
    const err = svg.match(/data-mjx-error\s*=\s*("|')([\s\S]*?)\1/);
    const vb  = svg.match(/viewBox\s*=\s*["']([^"']*)["']/);
    const box = vb ? vb[1].split(/[\s,]+/).map(Number) : null;
    return {
        error:  err ? err[2].replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&') : null,
        paths:  (svg.match(/<path/g) || []).length,
        rects:  (svg.match(/<rect/g) || []).length,
        viewBox: vb ? vb[1] : null,
        // Height in ems tells you at a glance whether the shape looks sane:
        // MathJax draws 1000 viewBox units to one em.
        ems:    box && box[3] ? +(box[3] / 1000).toFixed(2) : null,
        bytes:  svg.length,
    };
}

// ── Server ────────────────────────────────────────────────────────────────────
(async () => {
    let ctx;
    try {
        process.stdout.write('Loading MathJax 3… ');
        ctx = await bootMathJax();
        try {
            const pkg = require('mathjax-full/package.json');
            stats.engine = 'mathjax ' + pkg.version;
        } catch (_) { stats.engine = 'mathjax3'; }
        console.log('ready.  (' + stats.engine + ', node ' + process.version + ')');
        debugLog('packages loaded:', ctx.packageCount);
    } catch (e) {
        console.error('\n\nFailed to load MathJax:', e.message);
        console.error('Run:  npm install mathjax-full');
        if (TRACE && e.stack) console.error(e.stack);
        process.exit(1);
    }

    const server = http.createServer((req, res) => {
        const url = new URL(req.url, `http://localhost:${PORT}`);

        // Health check
        if (url.pathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'ok', engine: stats.engine || 'mathjax3',
                debug: DEBUG, port: PORT,
                rendered: stats.ok, failed: stats.failed, since: stats.started,
            }));
            return;
        }

        // Everything the server has drawn, and everything that went wrong.
        if (url.pathname === '/debug') {
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(debugReport());
            return;
        }

        const latex   = url.searchParams.get('from') || '';
        const display = url.searchParams.get('display') !== 'false'; // default true

        if (!latex.trim()) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Missing ?from= parameter');
            return;
        }

        const started = Date.now();
        try {
            const svg  = renderSVG(ctx, latex, display);
            const info = inspect(svg);
            const ms   = Date.now() - started;

            record({ at: new Date().toISOString(), latex, ms, error: info.error, info });

            res.writeHead(200, {
                'Content-Type':                'image/svg+xml; charset=utf-8',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control':               'no-store',
                // Handy from curl, and harmless to Affinity.
                'X-Eq-Render-Ms':              String(ms),
                'X-Eq-Paths':                  String(info.paths),
                'X-Eq-Error':                  info.error ? encodeURIComponent(info.error) : '',
            });
            res.end(svg);

            const short = latex.length > 60 ? latex.slice(0, 60) + '…' : latex;
            if (info.error) {
                // A 200 that is really a picture of an error message. Say so.
                console.log('[BAD MATHS] ' + short);
                console.log('            ' + info.error);
                if (TRACE) console.log('            ' + svg.replace(/\s+/g, ' ').slice(0, 800));
            } else if (DEBUG) {
                console.log('[render] ' + short);
                console.log('         ' + ms + 'ms  ' + info.paths + ' paths  ' + info.rects +
                            ' rects  ' + info.ems + ' em tall  ' + info.bytes + ' bytes');
            } else {
                console.log('[render] ' + short);
            }
        } catch (e) {
            const ms = Date.now() - started;
            record({ at: new Date().toISOString(), latex, ms, error: e.message, info: null });
            res.writeHead(422, { 'Content-Type': 'text/plain' });
            res.end('Render error: ' + e.message);
            console.error('[error] ' + e.message);
            if (TRACE && e.stack) console.error(e.stack);
        }
    });

    server.listen(PORT, '127.0.0.1', () => {
        console.log('\nListening on http://localhost:' + PORT);
        if (DEBUG) {
            console.log('Debug logging is ON' + (TRACE ? ' (with --trace)' : '') + '.');
        } else {
            console.log('Tip: restart with  --debug  to log every render in detail.');
        }
        console.log('Recent renders and failures: http://localhost:' + PORT + '/debug');
        console.log('Press Ctrl+C to stop.\n');
    });

    server.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
            console.error('\nPort ' + PORT + ' is already being used.');
            console.error('Another copy of this server is probably already running.');
            console.error('Check it with:  curl http://localhost:' + PORT + '/health');
            console.error('Or start this one elsewhere:  node katex_server.js --port 3738\n');
        } else {
            console.error('\nServer error: ' + e.message + '\n');
        }
        process.exit(1);
    });
})();

// ── The /debug page ───────────────────────────────────────────────────────────
function debugReport() {
    const L = [];
    L.push('Affinity Equation Renderer — debug report');
    L.push('='.repeat(60));
    L.push('');
    L.push('Engine        : ' + (stats.engine || 'mathjax3'));
    L.push('Port          : ' + PORT);
    L.push('Debug logging : ' + (DEBUG ? (TRACE ? 'on (--trace)' : 'on (--debug)') : 'off'));
    L.push('Running since : ' + stats.started);
    L.push('Node          : ' + process.version);
    L.push('Drawn OK      : ' + stats.ok);
    L.push('Failed        : ' + stats.failed);
    L.push('');

    if (!history.length) {
        L.push('Nothing has been drawn yet.');
        L.push('');
        L.push('Make an equation in Affinity, then reload this page.');
        return L.join('\n');
    }

    if (failures.length) {
        L.push('-'.repeat(60));
        L.push('FORMULAS THAT DID NOT WORK  (newest first)');
        L.push('-'.repeat(60));
        failures.forEach((f, i) => {
            L.push('');
            L.push((i + 1) + '.  ' + f.at);
            L.push('    you typed : ' + f.latex);
            L.push('    problem   : ' + f.error);
        });
        L.push('');
    }

    L.push('-'.repeat(60));
    L.push('EVERY RENDER  (newest first, last ' + MAX_LOG + ')');
    L.push('-'.repeat(60));
    history.forEach((h, i) => {
        const tag = h.error ? 'FAILED' : 'ok    ';
        const size = h.info ? (h.info.paths + ' paths, ' + h.info.ems + ' em') : '';
        L.push('');
        L.push((i + 1) + '.  ' + tag + '  ' + h.ms + 'ms  ' + size);
        L.push('    ' + h.latex);
        if (h.error) L.push('    → ' + h.error);
    });

    return L.join('\n');
}
