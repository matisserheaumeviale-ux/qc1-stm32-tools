import * as vscode from "vscode";

export interface AiErrorSummary {
  errors: number;
  warnings: number;
  diagnostics: string[];
  source: string;
}

export function summarizeDiagnostics(uri?: vscode.Uri): AiErrorSummary {
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

export function parseBuildLog(text: string): AiErrorSummary {
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
