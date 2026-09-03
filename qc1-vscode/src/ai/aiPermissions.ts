/**
 * RÉSUMÉ — POLITIQUE DE PERMISSIONS LIIX
 *
 * Cette classe décide si un outil est interdit, automatique ou soumis à confirmation.
 * Les autorisations de session sont liées au nom de l'outil et à ses arguments exacts;
 * une permission d'écriture ne devient donc jamais une permission terminal générale.
 */

import * as vscode from "vscode";
import { LiixAgentMode, LiixPermissionDecision, LiixPermissionRequest } from "./aiAgent";
import { getToolMetadata } from "./aiTools";
import { LiixToolCall } from "./aiProtocol";
import { classifyToolRisk } from "./aiSafety";

export type LiixPermissionVerdict = "allow" | "ask" | "deny";

export class LiixPermissionManager {
  private readonly sessionAllowed = new Set<string>();

  verdict(call: LiixToolCall, mode: LiixAgentMode): LiixPermissionVerdict {
    const metadata = getToolMetadata(call.name);
    if (!metadata || !metadata.modes.includes(mode)) return "deny";
    if (this.sessionAllowed.has(this.key(call))) return "allow";
    const risk = classifyToolRisk(call, metadata.risk);
    if (risk === "LOW") return "allow";
    if (mode === "chat") return "deny";

    const config = vscode.workspace.getConfiguration();
    if (risk === "HIGH") return "ask";
    if (["write_file", "create_file", "apply_patch"].includes(call.name)) {
      return this.settingVerdict(config.get<string>("liix.permissions.files", "ask"), mode);
    }
    if (call.name.startsWith("git_")) {
      return this.settingVerdict(config.get<string>("liix.permissions.git", "ask"), mode);
    }
    return this.settingVerdict(config.get<string>("liix.permissions.terminal", "ask"), mode);
  }

  remember(call: LiixToolCall, decision: LiixPermissionDecision): void {
    if (decision === "allowSession" || decision === "alwaysAllow") this.sessionAllowed.add(this.key(call));
  }

  createRequest(call: LiixToolCall): LiixPermissionRequest {
    const metadata = getToolMetadata(call.name);
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "--";
    const pathValue = typeof call.arguments.path === "string" ? call.arguments.path : undefined;
    return {
      id: call.id,
      action: call.name,
      command: typeof call.arguments.command === "string" ? call.arguments.command : undefined,
      files: pathValue ? [pathValue] : [],
      workspace,
      risk: classifyToolRisk(call, metadata?.risk || "HIGH"),
      reason: classifyToolRisk(call, metadata?.risk || "HIGH") === "HIGH" ? "Action sensible ou destructive." : "Cette action peut modifier le workspace ou lancer un processus."
    };
  }

  private settingVerdict(value: string, mode: LiixAgentMode): LiixPermissionVerdict {
    if (value === "none" || value === "read") return "deny";
    if (value === "allow" || mode === "full") return "allow";
    return "ask";
  }

  private key(call: LiixToolCall): string {
    return `${call.name}:${JSON.stringify(call.arguments)}`;
  }
}
