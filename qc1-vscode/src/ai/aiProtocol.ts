/**
 * RÉSUMÉ — PROTOCOLE DE CONVERSATION ET TOOL CALLING LIIX
 *
 * Ce fichier ne dépend ni de VS Code ni du réseau. Il définit les messages conservés
 * dans une conversation, les appels d'outils demandés par un modèle et les fonctions
 * pures qui décodent les réponses OpenAI-compatible ou le fallback `<tool_call>`.
 */

export type LiixConversationRole = "system" | "user" | "assistant" | "tool";

export interface LiixToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LiixConversationMessage {
  id: string;
  role: LiixConversationRole;
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: LiixToolCall[];
  timestamp: number;
}

export interface LiixToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LiixUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface LiixModelTurn {
  content: string;
  toolCalls: LiixToolCall[];
  usage?: LiixUsage;
  model?: string;
  latencyMs: number;
  streamed: boolean;
}

export interface OpenAiToolCallAccumulator {
  id: string;
  name: string;
  argumentsText: string;
}

export function createMessage(
  role: LiixConversationRole,
  content: string,
  extras: Partial<Omit<LiixConversationMessage, "id" | "role" | "content" | "timestamp">> = {}
): LiixConversationMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content,
    timestamp: Date.now(),
    ...extras
  };
}

/** Convertit une réponse JSON non streamée de LM Studio en tour agentique. */
export function parseOpenAiTurn(data: unknown, latencyMs: number): LiixModelTurn {
  const response = asRecord(data, "Réponse OpenAI-compatible invalide.");
  const choices = response.choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") {
    throw new Error("Réponse OpenAI-compatible invalide: choices[0] absent.");
  }

  const message = asRecord((choices[0] as Record<string, unknown>).message, "Message OpenAI-compatible absent.");
  const content = typeof message.content === "string" ? message.content : "";
  const nativeCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls.map(parseNativeToolCall).filter((call): call is LiixToolCall => Boolean(call))
    : [];
  const fallback = nativeCalls.length ? { content, toolCalls: nativeCalls } : parseFallbackToolCalls(content);

  return {
    content: fallback.content,
    toolCalls: fallback.toolCalls,
    usage: normalizeUsage(response.usage),
    model: typeof response.model === "string" ? response.model : undefined,
    latencyMs,
    streamed: false
  };
}

/**
 * Découpe uniquement les événements SSE complets. `rest` doit être préfixé au
 * prochain morceau reçu, car une ligne JSON peut être coupée entre deux chunks.
 */
export function splitSseEvents(buffer: string): { data: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const events = normalized.split("\n\n");
  const rest = events.pop() || "";
  const data = events.flatMap((event) => event
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean));
  return { data, rest };
}

/** Accumule les fragments `delta.tool_calls` produits par le streaming OpenAI. */
export function mergeToolCallDeltas(
  accumulators: Map<number, OpenAiToolCallAccumulator>,
  deltas: unknown
): void {
  if (!Array.isArray(deltas)) return;

  for (const raw of deltas) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const index = typeof item.index === "number" ? item.index : 0;
    const current = accumulators.get(index) || { id: "", name: "", argumentsText: "" };
    if (typeof item.id === "string") current.id = item.id;
    if (item.function && typeof item.function === "object") {
      const fn = item.function as Record<string, unknown>;
      if (typeof fn.name === "string") current.name += fn.name;
      if (typeof fn.arguments === "string") current.argumentsText += fn.arguments;
    }
    accumulators.set(index, current);
  }
}

export function finalizeToolCallDeltas(accumulators: Map<number, OpenAiToolCallAccumulator>): LiixToolCall[] {
  return [...accumulators.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, item]) => ({
      id: item.id || `tool-${Date.now()}-${index}`,
      name: item.name,
      arguments: parseArguments(item.argumentsText)
    }))
    .filter((call) => Boolean(call.name));
}

/** Support contrôlé pour les modèles qui écrivent un appel au lieu de tool_calls. */
export function parseFallbackToolCalls(content: string): { content: string; toolCalls: LiixToolCall[] } {
  const calls: LiixToolCall[] = [];
  const cleaned = content.replace(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi, (_match, json: string) => {
    try {
      const parsed = JSON.parse(json) as Record<string, unknown>;
      if (typeof parsed.name !== "string" || !parsed.name) return _match;
      calls.push({
        id: `fallback-${Date.now()}-${calls.length}`,
        name: parsed.name,
        arguments: parsed.arguments && typeof parsed.arguments === "object" && !Array.isArray(parsed.arguments)
          ? parsed.arguments as Record<string, unknown>
          : {}
      });
      return "";
    } catch {
      return _match;
    }
  }).trim();
  return { content: cleaned, toolCalls: calls };
}

function parseNativeToolCall(value: unknown): LiixToolCall | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  const fn = item.function;
  if (!fn || typeof fn !== "object") return undefined;
  const functionData = fn as Record<string, unknown>;
  if (typeof functionData.name !== "string" || !functionData.name) return undefined;
  return {
    id: typeof item.id === "string" ? item.id : `tool-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: functionData.name,
    arguments: parseArguments(functionData.arguments)
  };
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return { _parseError: "Arguments JSON invalides", _raw: value.slice(0, 2000) };
  }
}

function normalizeUsage(value: unknown): LiixUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  const promptTokens = numberField(usage.prompt_tokens);
  const completionTokens = numberField(usage.completion_tokens);
  const totalTokens = numberField(usage.total_tokens);
  return promptTokens === undefined && completionTokens === undefined && totalTokens === undefined
    ? undefined
    : { promptTokens, completionTokens, totalTokens };
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}
