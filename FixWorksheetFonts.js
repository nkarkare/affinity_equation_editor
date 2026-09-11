/**
 * name: FixWorksheetFonts
 */

'use strict';

/**
 * Fix Worksheet Fonts
 * Converts all PrintClearly text to PrintClearly-Bold.
 * PrintBold text is left untouched.
 */

var app           = require('/application.js').app;
var Commands      = require('/commands.js');
var Font          = require('/fonts.js').Font;
var StoryDelta    = require('/storydelta.js').StoryDelta;
var Selection     = require('/selections.js').Selection;
var TextSelection = require('/selections.js').TextSelection;
var DocumentCommand = Commands.DocumentCommand;

var doc = app.documents.current;
if (!doc) {
    app.alert('No document is open.', 'Fix Worksheet Fonts');
} else {

    var boldDelta = StoryDelta.createPostscriptName('PrintClearly-Bold');
    var runs = 0, frames = 0;

    for (var sp of doc.spreads) {
        try { doc.executeCommand(DocumentCommand.createSetCurrentSpread(sp)); } catch (e) {}
        (function walk(parent) {
            for (var node of parent.children) {
                try {
                    var si = node.storyInterface;
                    if (si) {
                        var rng = si.storyRange;
                        if (rng && rng.end > rng.begin) {
                            frames++;
                            var start = -1;
                            for (var pos = rng.begin; pos < rng.end; pos++) {
                                var ps = '';
                                try {
                                    var ga = si.story.getGlyphAtts(pos);
                                    if (ga && ga.font) ps = ga.font.postscriptName || '';
                                } catch (e) {
                                    if (start !== -1) {
                                        applyBold(node, start, pos);
                                        start = -1;
                                    }
                                    break;
                                }
                                if (ps === 'PrintClearly') {
                                    if (start === -1) start = pos;
                                } else {
                                    if (start !== -1) { applyBold(node, start, pos); start = -1; }
                                }
                            }
                            if (start !== -1) applyBold(node, start, rng.end);
                        }
                    }
                } catch (e) {}
                try { walk(node); } catch (e) {}
            }
        })(sp);
    }

    function applyBold(node, begin, end) {
        if (begin >= end) return;
        var sel = Selection.createEmpty(doc);
        sel.addNode(node);
        sel.addSubSelectionForNode(node, TextSelection.create([{ begin: begin, end: end }]));
        doc.formatText(boldDelta, sel);
        runs++;
    }

    app.alert('Done!\n\nPrintClearly → PrintClearly-Bold: ' + runs + ' run(s)\nFrames scanned: ' + frames + '\n\nCtrl+Z to undo.', 'Fix Worksheet Fonts');
}
