export interface DiagnosticRedaction {
  value: string;
  replacement: string;
}

export interface DiagnosticToolReport {
  name: string;
  detected: boolean;
  source: string;
  path: string;
  version: string;
}

export interface Qc1DiagnosticReportInput {
  generatedAt: string;
  issueDescription: string;
  extension: Record<string, unknown>;
  runtime: Record<string, unknown>;
  workspace: Record<string, unknown>;
  project: Record<string, unknown>;
  configuration: Record<string, unknown>;
  dashboard: Record<string, unknown>;
  artifacts: Record<string, unknown>;
  hardware: Record<string, unknown>;
  tools: DiagnosticToolReport[];
  vscodeProblems: string[];
  gitSnapshot: string;
  projectTree: string;
  logs: string;
}

function replaceAllLiteral(text: string, value: string, replacement: string): string {
  if (!value) return text;
  return text.split(value).join(replacement);
}

/**
 * Removes credentials and replaces machine-specific roots before a report is shared.
 * This intentionally runs over the complete final report so paths embedded in compiler
 * messages and commands receive the same treatment as structured fields.
 */
export function sanitizeDiagnosticText(
  input: string,
  redactions: DiagnosticRedaction[] = []
): string {
  let output = input;
  const orderedRedactions = [...redactions]
    .filter((entry) => Boolean(entry.value))
    .sort((left, right) => right.value.length - left.value.length);

  for (const entry of orderedRedactions) {
    output = replaceAllLiteral(output, entry.value, entry.replacement);

    const alternateSeparators = entry.value.includes("\\")
      ? entry.value.replace(/\\/g, "/")
      : entry.value.replace(/\//g, "\\");
    if (alternateSeparators !== entry.value) {
      output = replaceAllLiteral(output, alternateSeparators, entry.replacement);
    }
  }

  output = output
    .replace(
      /(\b(?:api[-_]?key|access[-_]?token|auth[-_]?token|token|password|passwd|secret|client[-_]?secret)\b\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}\]]+)/gi,
      "$1<REDACTED>"
    )
    .replace(/(authorization\s*[:=]\s*(?:bearer|basic)?\s*)[^\s,;]+/gi, "$1<REDACTED>")
    .replace(/(\b(?:bearer|basic)\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1<REDACTED>")
    .replace(/:\/\/[^/\s:@]+:[^/\s@]+@/g, "://<REDACTED>@")
    .replace(/([?&](?:api[-_]?key|token|access[-_]?token|secret)=)[^&#\s]+/gi, "$1<REDACTED>")
    .replace(/\b(?:sk-(?:proj-)?|gh[pousr]_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{8,}\b/g, "<REDACTED>");

  return output;
}

function codeBlock(content: string, language = "text"): string {
  const longestFence = Math.max(
    0,
    ...Array.from(content.matchAll(/~+/g), (match) => match[0].length)
  );
  const fence = "~".repeat(Math.max(4, longestFence + 1));
  return `${fence}${language}\n${content || "--"}\n${fence}`;
}

function jsonBlock(value: unknown): string {
  return codeBlock(JSON.stringify(value, null, 2), "json");
}

function toolTable(tools: DiagnosticToolReport[]): string {
  const rows = tools.map((tool) =>
    `| ${tool.name} | ${tool.detected ? "oui" : "non"} | ${tool.source || "--"} | ${tool.version || "--"} | ${tool.path || "--"} |`
  );

  return [
    "| Outil | Détecté | Source | Version | Chemin |",
    "| --- | --- | --- | --- | --- |",
    ...rows
  ].join("\n");
}

export function buildDiagnosticReport(
  input: Qc1DiagnosticReportInput,
  redactions: DiagnosticRedaction[] = []
): string {
  const problems = input.vscodeProblems.length > 0
    ? input.vscodeProblems.map((problem) => `- ${problem}`).join("\n")
    : "Aucun problème VS Code associé au projet.";
  const description = input.issueDescription.trim() || "Aucune description fournie.";
  const report = [
    "# Rapport de diagnostic QC1 STM32",
    "",
    `Généré le ${input.generatedAt}.`,
    "",
    "> Rapport créé localement. Les secrets connus et les chemins personnels ont été masqués automatiquement. Vérifier le contenu avant de le transmettre.",
    "",
    "## Description du problème",
    "",
    description,
    "",
    "## Résumé QC1",
    "",
    jsonBlock(input.dashboard),
    "",
    "## Extension et environnement d'exécution",
    "",
    jsonBlock({ extension: input.extension, runtime: input.runtime }),
    "",
    "## Workspace et projet détecté",
    "",
    jsonBlock({ workspace: input.workspace, project: input.project }),
    "",
    "## Configuration QC1 non sensible",
    "",
    jsonBlock(input.configuration),
    "",
    "## Outils détectés",
    "",
    toolTable(input.tools),
    "",
    "## Matériel et artefacts",
    "",
    jsonBlock({ hardware: input.hardware, artifacts: input.artifacts }),
    "",
    "## Problèmes signalés par VS Code",
    "",
    problems,
    "",
    "## État Git",
    "",
    codeBlock(input.gitSnapshot),
    "",
    "## Structure du projet",
    "",
    codeBlock(input.projectTree),
    "",
    "## Journal QC1 récent",
    "",
    codeBlock(input.logs),
    "",
    "## Portée et confidentialité",
    "",
    "QC1 ne lit pas directement le contenu des fichiers source. Le journal ou les problèmes VS Code peuvent toutefois contenir un extrait déjà produit par un compilateur. Le rapport exclut les variables d'environnement, les URL de dépôts Git et les réglages Liix. Les chemins racine sont remplacés par `<HOME>`, `<WORKSPACE>`, `<PROJECT>` et `<EXTENSION>`.",
    ""
  ].join("\n");

  return sanitizeDiagnosticText(report, redactions);
}
