const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildDiagnosticReport,
  sanitizeDiagnosticText
} = require("../out/qc1/diagnosticReport");

test("redacts roots and common credential formats", () => {
  const input = [
    "/Users/alice/course/firmware/Src/main.c",
    "apiKey=very-secret-value",
    "Authorization: Bearer abcdefghijklmnop",
    "https://alice:password@example.test/path",
    "token=https-token-value"
  ].join("\n");
  const sanitized = sanitizeDiagnosticText(input, [
    { value: "/Users/alice/course/firmware", replacement: "<PROJECT>" },
    { value: "/Users/alice", replacement: "<HOME>" }
  ]);

  assert.match(sanitized, /<PROJECT>\/Src\/main\.c/);
  assert.doesNotMatch(sanitized, /alice\/course/);
  assert.doesNotMatch(sanitized, /very-secret-value|abcdefghijklmnop|https-token-value/);
  assert.match(sanitized, /apiKey=<REDACTED>/);
  assert.match(sanitized, /Authorization: Bearer <REDACTED>/);
  assert.match(sanitized, /https:\/\/<REDACTED>@example\.test/);
});

test("builds a complete shareable Markdown report without source contents", () => {
  const report = buildDiagnosticReport({
    generatedAt: "2026-09-02T12:00:00.000Z",
    issueDescription: "Le build échoue.",
    extension: { version: "0.3.1" },
    runtime: { platform: "darwin" },
    workspace: { folders: ["/Users/alice/project"] },
    project: { layout: "native-cmake" },
    configuration: { buildType: "Debug" },
    dashboard: { diagnostic: "QC1-CMD-001" },
    artifacts: { elf: false },
    hardware: { stlink: "non détecté" },
    tools: [{ name: "CMake", detected: true, source: "PATH", path: "/usr/bin/cmake", version: "cmake 4.1" }],
    vscodeProblems: ["[Erreur] /Users/alice/project/Src/main.c:4:2 — symbole inconnu"],
    gitSnapshot: "## main\n M Src/main.c",
    projectTree: "./\n  Src/\n    Src/main.c",
    logs: "$ cmake /Users/alice/project"
  }, [{ value: "/Users/alice/project", replacement: "<PROJECT>" }]);

  assert.match(report, /^# Rapport de diagnostic QC1 STM32/m);
  assert.match(report, /## Outils détectés/);
  assert.match(report, /## Problèmes signalés par VS Code/);
  assert.match(report, /<PROJECT>\/Src\/main\.c/);
  assert.doesNotMatch(report, /\/Users\/alice\/project/);
  assert.match(report, /ne lit pas directement le contenu des fichiers source/);
});
