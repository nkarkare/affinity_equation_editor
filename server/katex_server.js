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
 *   node katex_server.js
 *
 * API:
 *   GET http://localhost:3737?from=\frac{a}{b}   → SVG text
 *   GET http://localhost:3737/health              → {"status":"ok"}
 *
 * The Affinity script calls this automatically before falling back to the cloud.
 */

'use strict';

const http = require('http');
const PORT = 3737;

// ── Boot MathJax ──────────────────────────────────────────────────────────────
// mathjax-full is ESM; use dynamic import() from CJS. Requires Node 14+.
async function bootMathJax() {
    const { mathjax }             = await import('mathjax-full/js/mathjax.js');
    const { TeX }                 = await import('mathjax-full/js/input/tex.js');
    const { SVG }                 = await import('mathjax-full/js/output/svg.js');
    const { liteAdaptor }         = await import('mathjax-full/js/adaptors/liteAdaptor.js');
    const { RegisterHTMLHandler } = await import('mathjax-full/js/handlers/html.js');

    const adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);

    const doc = mathjax.document('', {
        InputJax:  new TeX({
            packages: ['base', 'ams', 'boldsymbol', 'noerrors', 'noundefined'],
        }),
        OutputJax: new SVG({
            fontCache:  'none',   // inline all glyph paths — self-contained SVG
            displayAlign: 'center',
        }),
    });

    return { mathjax, adaptor, doc };
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

// ── Server ────────────────────────────────────────────────────────────────────
(async () => {
    let ctx;
    try {
        process.stdout.write('Loading MathJax 3… ');
        ctx = await bootMathJax();
        console.log('ready.');
    } catch (e) {
        console.error('\n\nFailed to load MathJax:', e.message);
        console.error('Run:  npm install mathjax-full');
        process.exit(1);
    }

    const server = http.createServer((req, res) => {
        const url = new URL(req.url, `http://localhost:${PORT}`);

        // Health check
        if (url.pathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', engine: 'mathjax3' }));
            return;
        }

        const latex   = url.searchParams.get('from') || '';
        const display = url.searchParams.get('display') !== 'false'; // default true

        if (!latex.trim()) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Missing ?from= parameter');
            return;
        }

        try {
            const svg = renderSVG(ctx, latex, display);
            res.writeHead(200, {
                'Content-Type':                'image/svg+xml; charset=utf-8',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control':               'no-store',
            });
            res.end(svg);
            console.log('[render] ' + latex.slice(0, 60) + (latex.length > 60 ? '…' : ''));
        } catch (e) {
            res.writeHead(422, { 'Content-Type': 'text/plain' });
            res.end('Render error: ' + e.message);
            console.error('[error] ' + e.message);
        }
    });

    server.listen(PORT, '127.0.0.1', () => {
        console.log(`\nListening on http://localhost:${PORT}`);
        console.log('Press Ctrl+C to stop.\n');
    });
})();
