/**
 * RÉSUMÉ — VALIDATIONS PURES DE SÉCURITÉ LIIX
 *
 * Ces fonctions sont séparées de VS Code pour être testées directement. Elles
 * empêchent l'évasion hors workspace et bloquent les commandes destructives qui
 * restent interdites même en mode Full.
 */

import * as path from "path";
import type { LiixRisk } from "./aiAgent";
import type { LiixToolCall } from "./aiProtocol";

export function resolveInsideWorkspace(root: string, input: string): string {
  if (!root) throw new Error("Aucun workspace ouvert.");
  const normalizedRoot = path.resolve(root);
  const absolute = path.resolve(normalizedRoot, input || ".");
  const relative = path.relative(normalizedRoot, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Chemin hors workspace bloqué: ${input}`);
  return absolute;
}

export function assertSafeCommand(command: string): void {
  const normalized = command.trim().toLowerCase();
  if (!normalized || /[\u0000\r\n]/.test(command)) throw new Error("Commande terminal vide ou invalide.");
  const blocked = [
    /(^|\s)sudo\b/,
    /\brm\s+[^\n]*-[^\n]*r[^\n]*f|\brm\s+[^\n]*-[^\n]*f[^\n]*r/,
    /\bgit\s+reset\s+--hard\b/,
    /\bgit\s+clean\s+[^\n]*-[^\n]*f/,
    /\bgit\s+push\s+[^\n]*--force\b/,
    /\b(mkfs|shutdown|reboot|halt|poweroff)\b/,
    /\bdd\s+[^\n]*\bof=\/dev\//,
    /(^|\s)(env|printenv|set)\s*($|[|;&])/,
    /(^|\s)(curl|wget|ssh|scp|nc|netcat)\b/,
    /\.\.\/|~\//,
    /(^|[\s'"=])\/[A-Za-z0-9_.-]/,
    /(^|[\s'"=])[A-Za-z]:\\/,
    /\$(?:HOME|USERPROFILE)|\$\{(?:HOME|USERPROFILE)\}/,
    /:\(\)\s*\{\s*:\|:&\s*\};:/
  ];
  if (blocked.some((pattern) => pattern.test(normalized))) throw new Error("Commande destructive bloquée par la politique Liix.");
}

export function classifyToolRisk(call: LiixToolCall, defaultRisk: LiixRisk): LiixRisk {
  const command = typeof call.arguments.command === "string" ? call.arguments.command.toLowerCase() : "";
  if (/\bgit\s+(add|commit|checkout|switch|reset|rebase|push|clean)\b/.test(command)) return "HIGH";
  if (/\b(rm|mv|chmod|chown|ln)\b/.test(command)) return "HIGH";
  if (/(^|\s)(python\d*|node|bash|sh|zsh|fish|powershell|pwsh|ruby|perl)\b/.test(command)) return "HIGH";
  if (/[;|<>]|\$\(|`/.test(command)) return "HIGH";
  return defaultRisk;
}
