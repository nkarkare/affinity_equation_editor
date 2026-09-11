#!/usr/bin/env node
/**
 * Stamps today's date into equation_editor.js.
 *
 * The script shows its publish date in the dialog title, because Affinity
 * keeps its own copy of a script and gives you no other way to tell whether
 * that copy is current. A date nobody remembers to update is worse than no
 * date at all — it lies — so the pre-commit hook runs this automatically
 * whenever equation_editor.js is staged.
 *
 *   node tools/stamp-version.js                  stamp today's date
 *   node tools/stamp-version.js --version 6.2.0  also set the version
 *   node tools/stamp-version.js --check          fail if the date is stale
 *   node tools/stamp-version.js --quiet          say nothing unless it changed
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function today() {
    const d = new Date();
    // Deliberately "11 Sep 2026" — 09/11 vs 11/09 is ambiguous across regions.
    return String(d.getDate()).padStart(2, '0') + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
}

const args    = process.argv.slice(2);
const quiet   = args.includes('--quiet');
const check   = args.includes('--check');
const verIdx  = args.indexOf('--version');
const newVer  = verIdx >= 0 ? args[verIdx + 1] : null;

if (verIdx >= 0 && !/^\d+\.\d+\.\d+$/.test(newVer || '')) {
    console.error('stamp-version: --version needs a number like 6.2.0');
    process.exit(1);
}

const file = path.join(__dirname, '..', 'equation_editor.js');
let src;
try {
    src = fs.readFileSync(file, 'utf8');
} catch (e) {
    console.error('stamp-version: cannot read ' + file + ' (' + e.message + ')');
    process.exit(1);
}

const date = today();

const curVerMatch  = src.match(/const VERSION\s*=\s*'([^']*)'/);
const curDateMatch = src.match(/const PUBLISHED\s*=\s*'([^']*)'/);

if (!curVerMatch || !curDateMatch) {
    console.error('stamp-version: could not find the VERSION and PUBLISHED lines.');
    console.error('               Has equation_editor.js been restructured?');
    process.exit(1);
}

const version = newVer || curVerMatch[1];
const wasDate = curDateMatch[1];
const wasVer  = curVerMatch[1];

if (check) {
    if (wasDate !== date) {
        console.error('stamp-version: the date says "' + wasDate + '" but today is "' + date + '".');
        console.error('               Run:  node tools/stamp-version.js');
        process.exit(1);
    }
    if (!quiet) console.log('stamp-version: date is current (' + date + ')');
    process.exit(0);
}

let out = src
    .replace(/const VERSION\s*=\s*'[^']*'/,   "const VERSION   = '" + version + "'")
    .replace(/const PUBLISHED\s*=\s*'[^']*'/, "const PUBLISHED = '" + date + "'")
    // The header's version field is what Script Manager reads and shows. The
    // name field is deliberately left alone: Script Manager matches the
    // installed title against the filename to decide whether it may auto-update
    // a script, and a name that changes every release would break that.
    .replace(/^(\s\*\sversion:\s*).*$/m, '$1' + version + ' (' + date + ')')
    // The description leads with the same stamp, because that is the one other
    // field Affinity stores alongside the title.
    .replace(/^(\s\*\sdescription:\s*)v[\d.]+\s·\s.*?—/m,
             '$1v' + version + ' · ' + date + ' —');

if (out === src) {
    if (!quiet) console.log('stamp-version: already up to date (v' + version + ', ' + date + ')');
    process.exit(0);
}

fs.writeFileSync(file, out);
console.log('stamp-version: v' + wasVer + ' ' + wasDate + '  ->  v' + version + ' ' + date);
