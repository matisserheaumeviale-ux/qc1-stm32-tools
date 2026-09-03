/**
 * RÉSUMÉ — CLIENT IA LIIX, LM STUDIO ET STREAMING
 *
 * Cette couche parle aux providers sans accéder au workspace. Pour LM Studio elle
 * utilise l'API OpenAI-compatible `/v1/models` et `/v1/chat/completions`, conserve
 * tous les rôles de conversation, transmet les tools et décode le vrai flux SSE.
 * Un fallback `<tool_call>{...}</tool_call>` reste disponible pour les modèles qui
 * ne savent pas produire de function calling natif.
 */

import * as vscode from "vscode";
import { getBackendModelId, liixAiModels } from "./aiModels";
import {
  finalizeToolCallDeltas,
  LiixConversationMessage,
  LiixModelTurn,
  LiixToolDefinition,
  LiixUsage,
  mergeToolCallDeltas,
  OpenAiToolCallAccumulator,
  parseFallbackToolCalls,
  parseOpenAiTurn,
  splitSseEvents
} from "./aiProtocol";

export type LiixProvider = "liix" | "local";
export type LiixRuntimeMode = "local" | "cloud" | "hybrid";
export type LiixLocalApiType = "ollama" | "openai-compatible";
export type LiixToolCallingMode = "auto" | "native" | "fallback";

export interface LiixAvailableModel {
  id: string;
  label: string;
  provider: LiixProvider;
  source: "liix" | "ollama" | "openai-compatible";
}

export interface LiixRuntimeConfig {
  provider: LiixProvider;
  mode: LiixRuntimeMode;
  endpoint: string;
  model: string;
  localApiType: LiixLocalApiType;
  localModel: string;
  toolCallingMode: LiixToolCallingMode;
  models: LiixAvailableModel[];
}

export interface LiixConnectionTest {
  connected: boolean;
  endpoint: string;
  apiType: LiixLocalApiType;
  models: LiixAvailableModel[];
  latencyMs: number;
  error?: string;
}

export interface LiixModelRequest {
  model: string;
  messages: LiixConversationMessage[];
  tools?: LiixToolDefinition[];
  signal?: AbortSignal;
  onToken?: (token: string) => void;
}

export interface AiClientRequest {
  modelId: string;
  message: string;
  context?: string;
  contextMode?: string;
  workspace?: string;
  activeFile?: string;
  selectedText?: string;
  terminalOutput?: string;
  mode?: "chat" | "file" | "errors";
  permissions?: {
    fileWrite: "none" | "ask" | "auto";
    terminal: "none" | "ask" | "build";
  };
}

export interface AiClientResponse {
  modelId: string;
  content: string;
  simulated: boolean;
  usage?: LiixUsage;
  latencyMs?: number;
}

function configuration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration();
}

function getLiixApiUrl(): string {
  return configuration().get<string>("liix.apiUrl", "https://true-mega-shall-icq.trycloudflare.com");
}

function getLiixApiKey(): string {
  return configuration().get<string>("liix.apiKey", "");
}

export function getLiixProvider(): LiixProvider {
  return configuration().get<string>("liix.provider", "local") as LiixProvider;
}

export function getLiixLocalApiUrl(): string {
  return configuration().get<string>("liix.localApiUrl", "http://localhost:1234");
}

export function getLiixLocalApiType(): LiixLocalApiType {
  return configuration().get<string>("liix.localApiType", "openai-compatible") as LiixLocalApiType;
}

export function getLiixLocalModel(): string {
  return configuration().get<string>("liix.localModel", "");
}

export function getLiixToolCallingMode(): LiixToolCallingMode {
  return configuration().get<string>("liix.supportsToolCalling", "auto") as LiixToolCallingMode;
}

export function getActiveLiixEndpoint(): string {
  return getLiixProvider() === "local" ? getLiixLocalApiUrl() : getLiixApiUrl();
}

export function getActiveLiixModel(): string {
  return getLiixProvider() === "local"
    ? getLiixLocalModel()
    : configuration().get<string>("liix.defaultModel", liixAiModels[0].id);
}

export async function updateLiixRuntimeConfig(update: Partial<{
  provider: LiixProvider;
  localApiType: LiixLocalApiType;
  localApiUrl: string;
  localModel: string;
  defaultModel: string;
  toolCallingMode: LiixToolCallingMode;
}>): Promise<void> {
  const config = configuration();
  const changes: Array<[string, unknown]> = [
    ["liix.provider", update.provider],
    ["liix.localApiType", update.localApiType],
    ["liix.localApiUrl", update.localApiUrl],
    ["liix.localModel", update.localModel],
    ["liix.defaultModel", update.defaultModel],
    ["liix.supportsToolCalling", update.toolCallingMode]
  ];
  for (const [key, value] of changes) {
    if (value !== undefined) await config.update(key, value, vscode.ConfigurationTarget.Workspace);
  }
}

export async function setActiveLiixModel(modelId: string): Promise<void> {
  const configKey = getLiixProvider() === "local" ? "liix.localModel" : "liix.defaultModel";
  await configuration().update(configKey, modelId, vscode.ConfigurationTarget.Workspace);
}

export async function getLiixRuntimeConfig(): Promise<LiixRuntimeConfig> {
  const provider = getLiixProvider();
  const models = await getAvailableLiixModels();
  let model = provider === "local" ? getLiixLocalModel() : configuration().get<string>("liix.defaultModel", liixAiModels[0].id);
  if ((!model || !models.some((item) => item.id === model)) && models[0]) {
    model = models[0].id;
    await setActiveLiixModel(model);
  }
  return {
    provider,
    mode: provider === "local" ? "local" : "cloud",
    endpoint: provider === "local" ? getLiixLocalApiUrl() : getLiixApiUrl(),
    model,
    localApiType: getLiixLocalApiType(),
    localModel: model,
    toolCallingMode: getLiixToolCallingMode(),
    models
  };
}

export async function getAvailableLiixModels(signal?: AbortSignal): Promise<LiixAvailableModel[]> {
  if (getLiixProvider() === "liix") {
    return liixAiModels.map((model) => ({ id: model.id, label: model.label, provider: "liix", source: "liix" }));
  }
  const apiType = getLiixLocalApiType();
  try {
    return await discoverLocalModels(apiType, signal);
  } catch {
    const fallback = getLiixLocalModel();
    return fallback ? [{ id: fallback, label: fallback, provider: "local", source: apiType === "ollama" ? "ollama" : "openai-compatible" }] : [];
  }
}

export async function testLiixConnection(signal?: AbortSignal): Promise<LiixConnectionTest> {
  const startedAt = Date.now();
  const endpoint = normalizeApiUrl(getLiixLocalApiUrl());
  const apiType = getLiixLocalApiType();
  try {
    const models = await discoverLocalModels(apiType, signal);
    return { connected: true, endpoint, apiType, models, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      connected: false,
      endpoint,
      apiType,
      models: [],
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function discoverLocalModels(apiType: LiixLocalApiType, signal?: AbortSignal): Promise<LiixAvailableModel[]> {
  const url = normalizeApiUrl(getLiixLocalApiUrl());
  const data = apiType === "ollama"
    ? await getJson(`${url}/api/tags`, "API locale Ollama", signal, 5_000)
    : await getJson(`${url}/v1/models`, "API locale LM Studio/OpenAI", signal, 5_000);
  return apiType === "ollama" ? normalizeOllamaModels(data) : normalizeOpenAiModels(data);
}

/** Point d'entrée utilisé par la boucle agentique. */
export async function sendLiixModelTurn(request: LiixModelRequest): Promise<LiixModelTurn> {
  if (!request.model) throw new Error("Aucun modèle actif. Démarre LM Studio, charge un modèle puis clique sur Refresh local models.");
  const timeoutMs = configuration().get<number>("liix.aiTimeoutMs", 120_000);
  const timeoutController = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; timeoutController.abort(); }, timeoutMs);
  const combined = combineSignals(request.signal, timeoutController.signal);
  try {
    const timedRequest = { ...request, signal: combined.signal };
    const provider = getLiixProvider();
    if (provider === "local") {
      return getLiixLocalApiType() === "openai-compatible"
        ? await sendOpenAiCompatibleTurn(timedRequest)
        : await sendOllamaTurn(timedRequest);
    }
    return await sendCloudTurn(timedRequest);
  } catch (error) {
    if (timedOut && !request.signal?.aborted) throw new Error(`La génération a dépassé le délai Liix de ${timeoutMs} ms.`);
    throw error;
  } finally {
    clearTimeout(timer);
    combined.cleanup();
  }
}

async function sendOpenAiCompatibleTurn(request: LiixModelRequest): Promise<LiixModelTurn> {
  const mode = getLiixToolCallingMode();
  const canUseNativeTools = mode !== "fallback" && Boolean(request.tools?.length);
  const effectiveRequest = mode === "fallback"
    ? { ...request, messages: withFallbackInstruction(request.messages, request.tools || []) }
    : request;
  try {
    return await requestOpenAiTurn(effectiveRequest, canUseNativeTools);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (isAbort(error) || !/\b(400|404|422)\b/.test(detail)) throw error;
    if (canUseNativeTools) {
      try {
        return await requestOpenAiNonStreaming(request, true);
      } catch (nativeError) {
        if (mode !== "auto") throw nativeError;
        return requestOpenAiNonStreaming({ ...request, messages: withFallbackInstruction(request.messages, request.tools || []) }, false);
      }
    }
    return requestOpenAiNonStreaming(effectiveRequest, false);
  }
}

async function requestOpenAiTurn(request: LiixModelRequest, nativeTools: boolean): Promise<LiixModelTurn> {
  const startedAt = Date.now();
  const body: Record<string, unknown> = {
    model: request.model,
    messages: toOpenAiMessages(request.messages),
    stream: true,
    temperature: configuration().get<number>("liix.temperature", 0.2),
    max_tokens: configuration().get<number>("liix.maxTokens", 4096),
    stream_options: { include_usage: true }
  };
  if (nativeTools && request.tools?.length) {
    body.tools = request.tools;
    body.tool_choice = "auto";
  }
  const response = await fetchWithTimeout(`${normalizeApiUrl(getLiixLocalApiUrl())}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
    body: JSON.stringify(body),
    signal: request.signal
  }, "LM Studio/OpenAI-compatible");
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) throw await responseError(response, "LM Studio/OpenAI-compatible");
  if (!contentType.includes("text/event-stream") || !response.body) return parseOpenAiTurn(await response.json(), Date.now() - startedAt);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const toolAccumulators = new Map<number, OpenAiToolCallAccumulator>();
  let buffer = "";
  let content = "";
  let usage: LiixUsage | undefined;
  let model: string | undefined;
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const split = splitSseEvents(done ? `${buffer}\n\n` : buffer);
    buffer = split.rest;
    for (const dataLine of split.data) {
      if (dataLine === "[DONE]") continue;
      let event: Record<string, unknown>;
      try { event = JSON.parse(dataLine) as Record<string, unknown>; } catch { continue; }
      if (typeof event.model === "string") model = event.model;
      usage = readUsage(event.usage) || usage;
      const choices = event.choices;
      if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") continue;
      const delta = (choices[0] as Record<string, unknown>).delta;
      if (!delta || typeof delta !== "object") continue;
      const deltaRecord = delta as Record<string, unknown>;
      if (typeof deltaRecord.content === "string" && deltaRecord.content) {
        content += deltaRecord.content;
        if (nativeTools || !request.tools?.length) request.onToken?.(deltaRecord.content);
      }
      mergeToolCallDeltas(toolAccumulators, deltaRecord.tool_calls);
    }
    if (done) break;
  }
  const nativeCalls = finalizeToolCallDeltas(toolAccumulators);
  const fallback = nativeCalls.length ? { content, toolCalls: nativeCalls } : parseFallbackToolCalls(content);
  return { content: fallback.content, toolCalls: fallback.toolCalls, usage, model, latencyMs: Date.now() - startedAt, streamed: true };
}

/** Repli explicite pour les serveurs OpenAI-compatible qui refusent `stream:true`. */
async function requestOpenAiNonStreaming(request: LiixModelRequest, nativeTools: boolean): Promise<LiixModelTurn> {
  const startedAt = Date.now();
  const body: Record<string, unknown> = {
    model: request.model,
    messages: toOpenAiMessages(request.messages),
    stream: false,
    temperature: configuration().get<number>("liix.temperature", 0.2),
    max_tokens: configuration().get<number>("liix.maxTokens", 4096)
  };
  if (nativeTools && request.tools?.length) {
    body.tools = request.tools;
    body.tool_choice = "auto";
  }
  const response = await fetchWithTimeout(`${normalizeApiUrl(getLiixLocalApiUrl())}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: request.signal
  }, "LM Studio/OpenAI-compatible");
  if (!response.ok) throw await responseError(response, "LM Studio/OpenAI-compatible");
  const turn = parseOpenAiTurn(await response.json(), Date.now() - startedAt);
  if (turn.content && !turn.toolCalls.length) request.onToken?.(turn.content);
  return turn;
}

async function sendOllamaTurn(request: LiixModelRequest): Promise<LiixModelTurn> {
  const startedAt = Date.now();
  const response = await fetchWithTimeout(`${normalizeApiUrl(getLiixLocalApiUrl())}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: request.model, messages: toSimpleMessages(withFallbackInstruction(request.messages, request.tools || [])), stream: true }),
    signal: request.signal
  }, "API locale Ollama");
  if (!response.ok) throw await responseError(response, "API locale Ollama");
  if (!response.body) throw new Error("Ollama n'a retourné aucun flux.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = done ? "" : lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const item = JSON.parse(line) as Record<string, unknown>;
      const message = item.message as Record<string, unknown> | undefined;
      const token = typeof message?.content === "string" ? message.content : "";
      content += token;
      if (token) request.onToken?.(token);
    }
    if (done) break;
  }
  const fallback = parseFallbackToolCalls(content);
  return { ...fallback, latencyMs: Date.now() - startedAt, streamed: true, model: request.model };
}

async function sendCloudTurn(request: LiixModelRequest): Promise<LiixModelTurn> {
  const startedAt = Date.now();
  const lastUser = [...request.messages].reverse().find((message) => message.role === "user")?.content || "";
  const data = await postJson(`${normalizeApiUrl(getLiixApiUrl())}/v1/chat`, {
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${getLiixApiKey()}` },
    body: { model: getBackendModelId(request.model), message: lastUser },
    errorPrefix: "Liix API",
    signal: request.signal
  });
  const record = asRecord(data);
  const content = [record.content, record.message, record.response, record.text].find((value) => typeof value === "string") as string | undefined;
  if (!content) throw new Error("Réponse Liix Cloud invalide: contenu absent.");
  request.onToken?.(content);
  return { content, toolCalls: [], usage: readUsage(record.usage), model: request.model, latencyMs: Date.now() - startedAt, streamed: false };
}

/** Compatibilité avec les anciens appels simples du panneau et des raccourcis. */
export async function sendLiixChat(request: { model: string; message?: string; messages?: Array<{ role: string; content: string }> }): Promise<{ content: string; usage?: LiixUsage; latencyMs: number }> {
  const messages = request.messages?.map((message) => ({
    id: `${Date.now()}-${Math.random()}`,
    role: (["system", "assistant", "tool"].includes(message.role) ? message.role : "user") as LiixConversationMessage["role"],
    content: message.content,
    timestamp: Date.now()
  })) || [{ id: String(Date.now()), role: "user", content: request.message || "", timestamp: Date.now() } as LiixConversationMessage];
  const turn = await sendLiixModelTurn({ model: request.model, messages });
  return { content: turn.content, usage: turn.usage, latencyMs: turn.latencyMs };
}

export class LiixAiClient {
  async sendMessage(request: AiClientRequest): Promise<AiClientResponse> {
    const context = request.context ? `\n\nContexte fourni:\n${request.context}` : "";
    const data = await sendLiixChat({ model: request.modelId, message: `${request.message}${context}` });
    return { modelId: request.modelId, simulated: false, content: data.content, usage: data.usage, latencyMs: data.latencyMs };
  }
}

function toOpenAiMessages(messages: LiixConversationMessage[]): Record<string, unknown>[] {
  return messages.map((message) => {
    if (message.role === "tool") return { role: "tool", content: message.content, tool_call_id: message.toolCallId, name: message.toolName };
    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "assistant",
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } }))
      };
    }
    return { role: message.role, content: message.content };
  });
}

function toSimpleMessages(messages: LiixConversationMessage[]): Array<{ role: string; content: string }> {
  return messages.map((message) => ({ role: message.role === "tool" ? "user" : message.role, content: message.role === "tool" ? `[Résultat ${message.toolName}]\n${message.content}` : message.content }));
}

function withFallbackInstruction(messages: LiixConversationMessage[], tools: LiixToolDefinition[]): LiixConversationMessage[] {
  if (!tools.length) return messages;
  const definitions = tools.map((tool) => ({ name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters }));
  const instruction: LiixConversationMessage = {
    id: `fallback-${Date.now()}`,
    role: "system",
    timestamp: Date.now(),
    content: [
      "Ce modèle n'utilise pas le function calling natif. Pour appeler exactement un outil, réponds uniquement avec:",
      "<tool_call>",
      '{"name":"nom_outil","arguments":{}}',
      "</tool_call>",
      `Outils disponibles: ${JSON.stringify(definitions)}`
    ].join("\n")
  };
  return [messages[0], instruction, ...messages.slice(1)];
}

async function fetchWithTimeout(url: string, init: RequestInit, label: string, timeoutOverride?: number): Promise<Response> {
  // Les générations possèdent déjà un signal couvrant tout le flux SSE. Le passer
  // directement évite de détacher l'annulation une fois les en-têtes reçus.
  if (init.signal && timeoutOverride === undefined) {
    try {
      return await fetch(url, init);
    } catch (error) {
      if (isAbort(error)) throw error;
      throw new Error(`${label}: connexion impossible à ${url}. ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const timeoutMs = timeoutOverride ?? configuration().get<number>("liix.aiTimeoutMs", 120_000);
  const timeoutController = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; timeoutController.abort(); }, timeoutMs);
  const combined = combineSignals(init.signal, timeoutController.signal);
  try {
    return await fetch(url, { ...init, signal: combined.signal });
  } catch (error) {
    if (timedOut && !init.signal?.aborted) throw new Error(`${label}: délai de ${timeoutMs} ms dépassé pour ${url}.`);
    if (isAbort(error)) throw error;
    throw new Error(`${label}: connexion impossible à ${url}. ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
    combined.cleanup();
  }
}

function combineSignals(left: AbortSignal | null | undefined, right: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  if (!left) return { signal: right, cleanup: () => undefined };
  const controller = new AbortController();
  const abort = () => controller.abort();
  left.addEventListener("abort", abort, { once: true });
  right.addEventListener("abort", abort, { once: true });
  if (left.aborted || right.aborted) controller.abort();
  return {
    signal: controller.signal,
    cleanup: () => {
      left.removeEventListener("abort", abort);
      right.removeEventListener("abort", abort);
    }
  };
}

async function postJson(url: string, options: { headers: Record<string, string>; body: unknown; errorPrefix: string; signal?: AbortSignal }): Promise<unknown> {
  const response = await fetchWithTimeout(url, { method: "POST", headers: options.headers, body: JSON.stringify(options.body), signal: options.signal }, options.errorPrefix);
  if (!response.ok) throw await responseError(response, options.errorPrefix);
  return parseJsonText(await response.text(), options.errorPrefix);
}

async function getJson(url: string, errorPrefix: string, signal?: AbortSignal, timeoutMs?: number): Promise<unknown> {
  const response = await fetchWithTimeout(url, { method: "GET", headers: { "Content-Type": "application/json" }, signal }, errorPrefix, timeoutMs);
  if (!response.ok) throw await responseError(response, errorPrefix);
  return parseJsonText(await response.text(), errorPrefix);
}

async function responseError(response: Response, prefix: string): Promise<Error> {
  const text = await response.text();
  return new Error(`${prefix}: ${response.status} ${response.statusText}${text ? ` - ${text.slice(0, 500)}` : ""}`);
}

function parseJsonText(text: string, prefix: string): unknown {
  try { return text ? JSON.parse(text) : {}; }
  catch { throw new Error(`${prefix}: JSON invalide.`); }
}

function normalizeApiUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeOllamaModels(data: unknown): LiixAvailableModel[] {
  const models = asRecord(data).models;
  if (!Array.isArray(models)) return [];
  return models.flatMap((value) => {
    const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return typeof item.name === "string" ? [{ id: item.name, label: item.name, provider: "local" as const, source: "ollama" as const }] : [];
  });
}

function normalizeOpenAiModels(data: unknown): LiixAvailableModel[] {
  const models = asRecord(data).data;
  if (!Array.isArray(models)) return [];
  return models.flatMap((value) => {
    const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return typeof item.id === "string" ? [{ id: item.id, label: item.id, provider: "local" as const, source: "openai-compatible" as const }] : [];
  });
}

function readUsage(value: unknown): LiixUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  const number = (input: unknown): number | undefined => typeof input === "number" ? input : undefined;
  const result = { promptTokens: number(usage.prompt_tokens), completionTokens: number(usage.completion_tokens), totalTokens: number(usage.total_tokens) };
  return result.promptTokens === undefined && result.completionTokens === undefined && result.totalTokens === undefined ? undefined : result;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Réponse JSON invalide.");
  return value as Record<string, unknown>;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
