import * as vscode from "vscode";

import { getBackendModelId } from "./aiModels";

type LiixProvider = "liix" | "local";
type LiixLocalApiType = "ollama" | "openai-compatible";

function getLiixApiUrl(): string {
  return vscode.workspace
    .getConfiguration()
    .get<string>("liix.apiUrl", "https://true-mega-shall-icq.trycloudflare.com");
}

function getLiixApiKey(): string {
  return vscode.workspace.getConfiguration().get<string>("liix.apiKey", "");
}

export function getLiixProvider(): LiixProvider {
  return vscode.workspace.getConfiguration().get<string>("liix.provider", "liix") as LiixProvider;
}

export function getLiixLocalApiUrl(): string {
  return vscode.workspace.getConfiguration().get<string>("liix.localApiUrl", "http://localhost:11434");
}

export function getLiixLocalApiType(): LiixLocalApiType {
  return vscode.workspace.getConfiguration().get<string>("liix.localApiType", "ollama") as LiixLocalApiType;
}

export function getLiixLocalModel(): string {
  return vscode.workspace.getConfiguration().get<string>("liix.localModel", "qwen2.5-coder:7b-instruct");
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

type ChatMessage = {
  role: string;
  content: string;
};

type LiixChatResponse = {
  content: string;
  usage?: unknown;
  server?: unknown;
};

export async function sendLiixChat(request: {
  model: string;
  message?: string;
  messages?: ChatMessage[];
  contextMode?: string;
  permissions?: {
    fileWrite: "none" | "ask" | "auto";
    terminal: "none" | "ask" | "build";
  };
  workspace?: string;
  activeFile?: string;
  selectedText?: string;
  terminalOutput?: string;
}): Promise<LiixChatResponse> {
  const provider = getLiixProvider();
  const message = getLiixRequestMessage(request);

  if (provider === "liix") {
    const model = getBackendModelId(request.model);

    console.log("[Liix] POST /v1/chat", {
      model,
      messageLength: message.length
    });

    const data = await postJson(`${normalizeApiUrl(getLiixApiUrl())}/v1/chat`, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${getLiixApiKey()}`
      },
      body: {
        model,
        message
      },
      errorPrefix: "Liix API"
    });

    return normalizeLiixCloudResponse(data);
  }

  if (provider === "local") {
    return sendLocalLiixChat(message);
  }

  throw new Error(`Invalid Liix provider "${provider}". Expected "liix" or "local".`);
}

function getLiixRequestMessage(request: {
  message?: string;
  messages?: ChatMessage[];
}): string {
  if (typeof request.message === "string") {
    return request.message;
  }

  return request.messages
    ?.filter((message) => message.role === "user")
    .at(-1)?.content ?? "";
}

async function sendLocalLiixChat(message: string): Promise<LiixChatResponse> {
  const localApiType = getLiixLocalApiType();
  const localApiUrl = normalizeApiUrl(getLiixLocalApiUrl());
  const localModel = getLiixLocalModel();

  if (localApiType === "ollama") {
    console.log("[Liix] POST local Ollama /api/generate", {
      model: localModel,
      messageLength: message.length
    });

    const data = await postJson(`${localApiUrl}/api/generate`, {
      headers: {
        "Content-Type": "application/json"
      },
      body: {
        model: localModel,
        prompt: message,
        stream: false
      },
      errorPrefix: "Local Ollama API"
    });

    return normalizeOllamaResponse(data);
  }

  if (localApiType === "openai-compatible") {
    console.log("[Liix] POST local OpenAI-compatible /v1/chat/completions", {
      model: localModel,
      messageLength: message.length
    });

    const data = await postJson(`${localApiUrl}/v1/chat/completions`, {
      headers: {
        "Content-Type": "application/json"
      },
      body: {
        model: localModel,
        messages: [
          {
            role: "user",
            content: message
          }
        ],
        stream: false
      },
      errorPrefix: "Local OpenAI-compatible API"
    });

    return normalizeOpenAiCompatibleResponse(data);
  }

  throw new Error(`Invalid local Liix API type "${localApiType}". Expected "ollama" or "openai-compatible".`);
}

async function postJson(url: string, options: {
  headers: Record<string, string>;
  body: unknown;
  errorPrefix: string;
}): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: options.headers,
      body: JSON.stringify(options.body)
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${options.errorPrefix} connection failed. Check that the server is running at ${url}. ${detail}`);
  }

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`${options.errorPrefix} error: ${response.status} ${response.statusText}${formatResponseSnippet(responseText)}`);
  }

  try {
    return responseText ? JSON.parse(responseText) : {};
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${options.errorPrefix} returned invalid JSON. ${detail}`);
  }
}

function normalizeApiUrl(apiUrl: string): string {
  return apiUrl.replace(/\/+$/, "");
}

function normalizeLiixCloudResponse(data: unknown): LiixChatResponse {
  const response = getObjectResponse(data, "Liix API response is invalid.");
  const content = getStringField(response, ["content", "message", "response", "text"]);

  if (!content) {
    throw new Error("Liix API response is invalid: missing content.");
  }

  return {
    content,
    usage: response.usage,
    server: response.server
  };
}

function normalizeOllamaResponse(data: unknown): LiixChatResponse {
  const response = getObjectResponse(data, "Local Ollama response is invalid.");
  const content = response.response;

  if (typeof content !== "string") {
    throw new Error("Local Ollama response is invalid: missing response text.");
  }

  return {
    content,
    usage: response.done === undefined ? undefined : { done: response.done },
    server: response.model
  };
}

function normalizeOpenAiCompatibleResponse(data: unknown): LiixChatResponse {
  const response = getObjectResponse(data, "Local OpenAI-compatible response is invalid.");
  const choices = response.choices;

  if (!Array.isArray(choices)) {
    throw new Error("Local OpenAI-compatible response is invalid: missing choices.");
  }

  const firstChoice = choices[0];

  if (!firstChoice || typeof firstChoice !== "object") {
    throw new Error("Local OpenAI-compatible response is invalid: missing first choice.");
  }

  const message = (firstChoice as Record<string, unknown>).message;

  if (!message || typeof message !== "object") {
    throw new Error("Local OpenAI-compatible response is invalid: missing choice message.");
  }

  const content = (message as Record<string, unknown>).content;

  if (typeof content !== "string") {
    throw new Error("Local OpenAI-compatible response is invalid: missing message content.");
  }

  return {
    content,
    usage: response.usage,
    server: response.model
  };
}

function getObjectResponse(data: unknown, invalidMessage: string): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(invalidMessage);
  }

  return data as Record<string, unknown>;
}

function getStringField(response: Record<string, unknown>, fields: string[]): string | undefined {
  for (const field of fields) {
    const value = response[field];

    if (typeof value === "string") {
      return value;
    }
  }

  return undefined;
}

function formatResponseSnippet(responseText: string): string {
  if (!responseText) {
    return "";
  }

  const snippet = responseText.length > 300 ? `${responseText.slice(0, 300)}...` : responseText;
  return ` - ${snippet}`;
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
