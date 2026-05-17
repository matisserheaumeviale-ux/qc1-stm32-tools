import * as vscode from "vscode";

export interface ActiveFileContext {
  fileName: string;
  languageId: string;
  lineCount: number;
  text: string;
  truncated: boolean;
}

const MAX_ACTIVE_FILE_CHARS = 12000;

export function getActiveFileContext(): ActiveFileContext | undefined {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    return undefined;
  }

  const document = editor.document;
  const text = document.getText();
  const truncated = text.length > MAX_ACTIVE_FILE_CHARS;

  return {
    fileName: document.fileName,
    languageId: document.languageId,
    lineCount: document.lineCount,
    text: truncated ? text.slice(0, MAX_ACTIVE_FILE_CHARS) : text,
    truncated
  };
}

export function formatActiveFileContext(context: ActiveFileContext): string {
  return [
    `Fichier: ${context.fileName}`,
    `Langage: ${context.languageId}`,
    `Lignes: ${context.lineCount}`,
    context.truncated ? "Note: contenu tronque pour le mode dev." : "Note: contenu complet transmis.",
    "",
    context.text
  ].join("\n");
}
