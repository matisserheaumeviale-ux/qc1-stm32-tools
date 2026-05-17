"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.summarizeDiagnostics = summarizeDiagnostics;
exports.parseBuildLog = parseBuildLog;
const vscode = require("vscode");
function summarizeDiagnostics(uri) {
    const diagnostics = uri
        ? vscode.languages.getDiagnostics(uri)
        : vscode.languages.getDiagnostics().flatMap((entry) => entry[1]);
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === vscode.DiagnosticSeverity.Error);
    const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === vscode.DiagnosticSeverity.Warning);
    return {
        errors: errors.length,
        warnings: warnings.length,
        diagnostics: diagnostics.slice(0, 20).map((diagnostic) => {
            const line = diagnostic.range.start.line + 1;
            return `L${line}: ${diagnostic.message}`;
        }),
        source: uri ? "fichier actif" : "workspace"
    };
}
function parseBuildLog(text) {
    const lines = text.split(/\r?\n/);
    const diagnostics = lines
        .filter((line) => /\berror:|\bwarning:/i.test(line))
        .slice(0, 20);
    return {
        errors: lines.filter((line) => /\berror:/i.test(line)).length,
        warnings: lines.filter((line) => /\bwarning:/i.test(line)).length,
        diagnostics,
        source: "log build QC1"
    };
}
//# sourceMappingURL=aiErrorParser.js.map