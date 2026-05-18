import * as vscode from "vscode";

import { getBackendModelId } from "./aiModels";

function getLiixApiUrl(): string {
  return vscode.workspace
    .getConfiguration()
    .get<string>("liix.apiUrl", "https://true-mega-shall-icq.trycloudflare.com");
}

function getLiixApiKey(): string {
  return vscode.workspace.getConfiguration().get<string>("liix.apiKey", "");
}

export interface AiClientRequest {
  modelId: string;
  message: string;
  context?: string;
  contextMode?: string;
  permissions?: {
    fileWrite: "none" | "ask" | "auto";
    terminal: "none" | "ask" | "build";
  };
  workspace?: string;
  activeFile?: string;
  selectedText?: string;
  terminalOutput?: string;
  mode?: "chat" | "file" | "errors";
}

export interface AiClientResponse {
  modelId: string;
  content: string;
  simulated: boolean;
}

export async function sendLiixChat(request: {
  model: string;
  message: string;
  contextMode?: string;
  permissions?: {
    fileWrite: "none" | "ask" | "auto";
    terminal: "none" | "ask" | "build";
  };
  workspace?: string;
  activeFile?: string;
  selectedText?: string;
  terminalOutput?: string;
}) {
  const model = getBackendModelId(request.model);
  const message = request.message;

  const response = await fetch(`${getLiixApiUrl()}/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${getLiixApiKey()}`
    },
    body: JSON.stringify({
      model,
      message
    })
  });

  if (!response.ok) {
    throw new Error(`Liix API error: ${response.status}`);
  }

  return await response.json();
}

export class LiixAiClient {
  public async sendMessage(request: AiClientRequest): Promise<AiClientResponse> {
    const data = await sendLiixChat({
      model: request.modelId,
      message: request.message,
      contextMode: request.contextMode ?? request.mode ?? "question",
      permissions: request.permissions,
      workspace: request.workspace,
      activeFile: request.activeFile,
      selectedText: request.selectedText ?? request.context,
      terminalOutput: request.terminalOutput
    });

    return {
      modelId: request.modelId,
      simulated: false,
      content: getLiixResponseContent(data)
    };
  }
}

function getLiixResponseContent(data: unknown): string {
  if (typeof data === "string") {
    return data;
  }

  if (!data || typeof data !== "object") {
    return "";
  }

  const response = data as Record<string, unknown>;
  const content = response.content ?? response.message ?? response.response ?? response.text;

  return typeof content === "string" ? content : JSON.stringify(response, null, 2);
}
