"use strict";
/**
 * RÉSUMÉ — CLIENT IA LIIX, LM STUDIO ET STREAMING
 *
 * Cette couche parle aux providers sans accéder au workspace. Pour LM Studio elle
 * utilise l'API OpenAI-compatible `/v1/models` et `/v1/chat/completions`, conserve
 * tous les rôles de conversation, transmet les tools et décode le vrai flux SSE.
 * Un fallback `<tool_call>{...}</tool_call>` reste disponible pour les modèles qui
 * ne savent pas produire de function calling natif.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LiixAiClient = void 0;
exports.getLiixProvider = getLiixProvider;
exports.getLiixLocalApiUrl = getLiixLocalApiUrl;
exports.getLiixLocalApiType = getLiixLocalApiType;
exports.getLiixLocalModel = getLiixLocalModel;
exports.getLiixToolCallingMode = getLiixToolCallingMode;
exports.getActiveLiixEndpoint = getActiveLiixEndpoint;
exports.getActiveLiixModel = getActiveLiixModel;
exports.updateLiixRuntimeConfig = updateLiixRuntimeConfig;
exports.setActiveLiixModel = setActiveLiixModel;
exports.getLiixRuntimeConfig = getLiixRuntimeConfig;
exports.getAvailableLiixModels = getAvailableLiixModels;
exports.testLiixConnection = testLiixConnection;
exports.sendLiixModelTurn = sendLiixModelTurn;
exports.sendLiixChat = sendLiixChat;
const vscode = require("vscode");
const aiModels_1 = require("./aiModels");
const aiProtocol_1 = require("./aiProtocol");
function configuration() {
    return vscode.workspace.getConfiguration();
}
function getLiixApiUrl() {
    return configuration().get("liix.apiUrl", "https://true-mega-shall-icq.trycloudflare.com");
}
function getLiixApiKey() {
    return configuration().get("liix.apiKey", "");
}
function getLiixProvider() {
    return configuration().get("liix.provider", "local");
}
function getLiixLocalApiUrl() {
    return configuration().get("liix.localApiUrl", "http://localhost:1234");
}
function getLiixLocalApiType() {
    return configuration().get("liix.localApiType", "openai-compatible");
}
function getLiixLocalModel() {
    return configuration().get("liix.localModel", "");
}
function getLiixToolCallingMode() {
    return configuration().get("liix.supportsToolCalling", "auto");
}
function getActiveLiixEndpoint() {
    return getLiixProvider() === "local" ? getLiixLocalApiUrl() : getLiixApiUrl();
}
function getActiveLiixModel() {
    return getLiixProvider() === "local"
        ? getLiixLocalModel()
        : configuration().get("liix.defaultModel", aiModels_1.liixAiModels[0].id);
}
async function updateLiixRuntimeConfig(update) {
    const config = configuration();
    const changes = [
        ["liix.provider", update.provider],
        ["liix.localApiType", update.localApiType],
        ["liix.localApiUrl", update.localApiUrl],
        ["liix.localModel", update.localModel],
        ["liix.defaultModel", update.defaultModel],
        ["liix.supportsToolCalling", update.toolCallingMode]
    ];
    for (const [key, value] of changes) {
        if (value !== undefined)
            await config.update(key, value, vscode.ConfigurationTarget.Workspace);
    }
}
async function setActiveLiixModel(modelId) {
    const configKey = getLiixProvider() === "local" ? "liix.localModel" : "liix.defaultModel";
    await configuration().update(configKey, modelId, vscode.ConfigurationTarget.Workspace);
}
async function getLiixRuntimeConfig() {
    const provider = getLiixProvider();
    const models = await getAvailableLiixModels();
    let model = provider === "local" ? getLiixLocalModel() : configuration().get("liix.defaultModel", aiModels_1.liixAiModels[0].id);
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
async function getAvailableLiixModels(signal) {
    if (getLiixProvider() === "liix") {
        return aiModels_1.liixAiModels.map((model) => ({ id: model.id, label: model.label, provider: "liix", source: "liix" }));
    }
    const apiType = getLiixLocalApiType();
    try {
        return await discoverLocalModels(apiType, signal);
    }
    catch {
        const fallback = getLiixLocalModel();
        return fallback ? [{ id: fallback, label: fallback, provider: "local", source: apiType === "ollama" ? "ollama" : "openai-compatible" }] : [];
    }
}
async function testLiixConnection(signal) {
    const startedAt = Date.now();
    const endpoint = normalizeApiUrl(getLiixLocalApiUrl());
    const apiType = getLiixLocalApiType();
    try {
        const models = await discoverLocalModels(apiType, signal);
        return { connected: true, endpoint, apiType, models, latencyMs: Date.now() - startedAt };
    }
    catch (error) {
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
async function discoverLocalModels(apiType, signal) {
    const url = normalizeApiUrl(getLiixLocalApiUrl());
    const data = apiType === "ollama"
        ? await getJson(`${url}/api/tags`, "API locale Ollama", signal, 5000)
        : await getJson(`${url}/v1/models`, "API locale LM Studio/OpenAI", signal, 5000);
    return apiType === "ollama" ? normalizeOllamaModels(data) : normalizeOpenAiModels(data);
}
/** Point d'entrée utilisé par la boucle agentique. */
async function sendLiixModelTurn(request) {
    if (!request.model)
        throw new Error("Aucun modèle actif. Démarre LM Studio, charge un modèle puis clique sur Refresh local models.");
    const timeoutMs = configuration().get("liix.aiTimeoutMs", 120000);
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
    }
    catch (error) {
        if (timedOut && !request.signal?.aborted)
            throw new Error(`La génération a dépassé le délai Liix de ${timeoutMs} ms.`);
        throw error;
    }
    finally {
        clearTimeout(timer);
        combined.cleanup();
    }
}
async function sendOpenAiCompatibleTurn(request) {
    const mode = getLiixToolCallingMode();
    const canUseNativeTools = mode !== "fallback" && Boolean(request.tools?.length);
    const effectiveRequest = mode === "fallback"
        ? { ...request, messages: withFallbackInstruction(request.messages, request.tools || []) }
        : request;
    try {
        return await requestOpenAiTurn(effectiveRequest, canUseNativeTools);
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (isAbort(error) || !/\b(400|404|422)\b/.test(detail))
            throw error;
        if (canUseNativeTools) {
            try {
                return await requestOpenAiNonStreaming(request, true);
            }
            catch (nativeError) {
                if (mode !== "auto")
                    throw nativeError;
                return requestOpenAiNonStreaming({ ...request, messages: withFallbackInstruction(request.messages, request.tools || []) }, false);
            }
        }
        return requestOpenAiNonStreaming(effectiveRequest, false);
    }
}
async function requestOpenAiTurn(request, nativeTools) {
    const startedAt = Date.now();
    const body = {
        model: request.model,
        messages: toOpenAiMessages(request.messages),
        stream: true,
        temperature: configuration().get("liix.temperature", 0.2),
        max_tokens: configuration().get("liix.maxTokens", 4096),
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
    if (!response.ok)
        throw await responseError(response, "LM Studio/OpenAI-compatible");
    if (!contentType.includes("text/event-stream") || !response.body)
        return (0, aiProtocol_1.parseOpenAiTurn)(await response.json(), Date.now() - startedAt);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const toolAccumulators = new Map();
    let buffer = "";
    let content = "";
    let usage;
    let model;
    while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const split = (0, aiProtocol_1.splitSseEvents)(done ? `${buffer}\n\n` : buffer);
        buffer = split.rest;
        for (const dataLine of split.data) {
            if (dataLine === "[DONE]")
                continue;
            let event;
            try {
                event = JSON.parse(dataLine);
            }
            catch {
                continue;
            }
            if (typeof event.model === "string")
                model = event.model;
            usage = readUsage(event.usage) || usage;
            const choices = event.choices;
            if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object")
                continue;
            const delta = choices[0].delta;
            if (!delta || typeof delta !== "object")
                continue;
            const deltaRecord = delta;
            if (typeof deltaRecord.content === "string" && deltaRecord.content) {
                content += deltaRecord.content;
                if (nativeTools || !request.tools?.length)
                    request.onToken?.(deltaRecord.content);
            }
            (0, aiProtocol_1.mergeToolCallDeltas)(toolAccumulators, deltaRecord.tool_calls);
        }
        if (done)
            break;
    }
    const nativeCalls = (0, aiProtocol_1.finalizeToolCallDeltas)(toolAccumulators);
    const fallback = nativeCalls.length ? { content, toolCalls: nativeCalls } : (0, aiProtocol_1.parseFallbackToolCalls)(content);
    return { content: fallback.content, toolCalls: fallback.toolCalls, usage, model, latencyMs: Date.now() - startedAt, streamed: true };
}
/** Repli explicite pour les serveurs OpenAI-compatible qui refusent `stream:true`. */
async function requestOpenAiNonStreaming(request, nativeTools) {
    const startedAt = Date.now();
    const body = {
        model: request.model,
        messages: toOpenAiMessages(request.messages),
        stream: false,
        temperature: configuration().get("liix.temperature", 0.2),
        max_tokens: configuration().get("liix.maxTokens", 4096)
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
    if (!response.ok)
        throw await responseError(response, "LM Studio/OpenAI-compatible");
    const turn = (0, aiProtocol_1.parseOpenAiTurn)(await response.json(), Date.now() - startedAt);
    if (turn.content && !turn.toolCalls.length)
        request.onToken?.(turn.content);
    return turn;
}
async function sendOllamaTurn(request) {
    const startedAt = Date.now();
    const response = await fetchWithTimeout(`${normalizeApiUrl(getLiixLocalApiUrl())}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: request.model, messages: toSimpleMessages(withFallbackInstruction(request.messages, request.tools || [])), stream: true }),
        signal: request.signal
    }, "API locale Ollama");
    if (!response.ok)
        throw await responseError(response, "API locale Ollama");
    if (!response.body)
        throw new Error("Ollama n'a retourné aucun flux.");
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
            if (!line.trim())
                continue;
            const item = JSON.parse(line);
            const message = item.message;
            const token = typeof message?.content === "string" ? message.content : "";
            content += token;
            if (token)
                request.onToken?.(token);
        }
        if (done)
            break;
    }
    const fallback = (0, aiProtocol_1.parseFallbackToolCalls)(content);
    return { ...fallback, latencyMs: Date.now() - startedAt, streamed: true, model: request.model };
}
async function sendCloudTurn(request) {
    const startedAt = Date.now();
    const lastUser = [...request.messages].reverse().find((message) => message.role === "user")?.content || "";
    const data = await postJson(`${normalizeApiUrl(getLiixApiUrl())}/v1/chat`, {
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${getLiixApiKey()}` },
        body: { model: (0, aiModels_1.getBackendModelId)(request.model), message: lastUser },
        errorPrefix: "Liix API",
        signal: request.signal
    });
    const record = asRecord(data);
    const content = [record.content, record.message, record.response, record.text].find((value) => typeof value === "string");
    if (!content)
        throw new Error("Réponse Liix Cloud invalide: contenu absent.");
    request.onToken?.(content);
    return { content, toolCalls: [], usage: readUsage(record.usage), model: request.model, latencyMs: Date.now() - startedAt, streamed: false };
}
/** Compatibilité avec les anciens appels simples du panneau et des raccourcis. */
async function sendLiixChat(request) {
    const messages = request.messages?.map((message) => ({
        id: `${Date.now()}-${Math.random()}`,
        role: (["system", "assistant", "tool"].includes(message.role) ? message.role : "user"),
        content: message.content,
        timestamp: Date.now()
    })) || [{ id: String(Date.now()), role: "user", content: request.message || "", timestamp: Date.now() }];
    const turn = await sendLiixModelTurn({ model: request.model, messages });
    return { content: turn.content, usage: turn.usage, latencyMs: turn.latencyMs };
}
class LiixAiClient {
    async sendMessage(request) {
        const context = request.context ? `\n\nContexte fourni:\n${request.context}` : "";
        const data = await sendLiixChat({ model: request.modelId, message: `${request.message}${context}` });
        return { modelId: request.modelId, simulated: false, content: data.content, usage: data.usage, latencyMs: data.latencyMs };
    }
}
exports.LiixAiClient = LiixAiClient;
function toOpenAiMessages(messages) {
    return messages.map((message) => {
        if (message.role === "tool")
            return { role: "tool", content: message.content, tool_call_id: message.toolCallId, name: message.toolName };
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
function toSimpleMessages(messages) {
    return messages.map((message) => ({ role: message.role === "tool" ? "user" : message.role, content: message.role === "tool" ? `[Résultat ${message.toolName}]\n${message.content}` : message.content }));
}
function withFallbackInstruction(messages, tools) {
    if (!tools.length)
        return messages;
    const definitions = tools.map((tool) => ({ name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters }));
    const instruction = {
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
async function fetchWithTimeout(url, init, label, timeoutOverride) {
    // Les générations possèdent déjà un signal couvrant tout le flux SSE. Le passer
    // directement évite de détacher l'annulation une fois les en-têtes reçus.
    if (init.signal && timeoutOverride === undefined) {
        try {
            return await fetch(url, init);
        }
        catch (error) {
            if (isAbort(error))
                throw error;
            throw new Error(`${label}: connexion impossible à ${url}. ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    const timeoutMs = timeoutOverride ?? configuration().get("liix.aiTimeoutMs", 120000);
    const timeoutController = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; timeoutController.abort(); }, timeoutMs);
    const combined = combineSignals(init.signal, timeoutController.signal);
    try {
        return await fetch(url, { ...init, signal: combined.signal });
    }
    catch (error) {
        if (timedOut && !init.signal?.aborted)
            throw new Error(`${label}: délai de ${timeoutMs} ms dépassé pour ${url}.`);
        if (isAbort(error))
            throw error;
        throw new Error(`${label}: connexion impossible à ${url}. ${error instanceof Error ? error.message : String(error)}`);
    }
    finally {
        clearTimeout(timer);
        combined.cleanup();
    }
}
function combineSignals(left, right) {
    if (!left)
        return { signal: right, cleanup: () => undefined };
    const controller = new AbortController();
    const abort = () => controller.abort();
    left.addEventListener("abort", abort, { once: true });
    right.addEventListener("abort", abort, { once: true });
    if (left.aborted || right.aborted)
        controller.abort();
    return {
        signal: controller.signal,
        cleanup: () => {
            left.removeEventListener("abort", abort);
            right.removeEventListener("abort", abort);
        }
    };
}
async function postJson(url, options) {
    const response = await fetchWithTimeout(url, { method: "POST", headers: options.headers, body: JSON.stringify(options.body), signal: options.signal }, options.errorPrefix);
    if (!response.ok)
        throw await responseError(response, options.errorPrefix);
    return parseJsonText(await response.text(), options.errorPrefix);
}
async function getJson(url, errorPrefix, signal, timeoutMs) {
    const response = await fetchWithTimeout(url, { method: "GET", headers: { "Content-Type": "application/json" }, signal }, errorPrefix, timeoutMs);
    if (!response.ok)
        throw await responseError(response, errorPrefix);
    return parseJsonText(await response.text(), errorPrefix);
}
async function responseError(response, prefix) {
    const text = await response.text();
    return new Error(`${prefix}: ${response.status} ${response.statusText}${text ? ` - ${text.slice(0, 500)}` : ""}`);
}
function parseJsonText(text, prefix) {
    try {
        return text ? JSON.parse(text) : {};
    }
    catch {
        throw new Error(`${prefix}: JSON invalide.`);
    }
}
function normalizeApiUrl(value) {
    return value.replace(/\/+$/, "");
}
function normalizeOllamaModels(data) {
    const models = asRecord(data).models;
    if (!Array.isArray(models))
        return [];
    return models.flatMap((value) => {
        const item = value && typeof value === "object" ? value : {};
        return typeof item.name === "string" ? [{ id: item.name, label: item.name, provider: "local", source: "ollama" }] : [];
    });
}
function normalizeOpenAiModels(data) {
    const models = asRecord(data).data;
    if (!Array.isArray(models))
        return [];
    return models.flatMap((value) => {
        const item = value && typeof value === "object" ? value : {};
        return typeof item.id === "string" ? [{ id: item.id, label: item.id, provider: "local", source: "openai-compatible" }] : [];
    });
}
function readUsage(value) {
    if (!value || typeof value !== "object")
        return undefined;
    const usage = value;
    const number = (input) => typeof input === "number" ? input : undefined;
    const result = { promptTokens: number(usage.prompt_tokens), completionTokens: number(usage.completion_tokens), totalTokens: number(usage.total_tokens) };
    return result.promptTokens === undefined && result.completionTokens === undefined && result.totalTokens === undefined ? undefined : result;
}
function asRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Réponse JSON invalide.");
    return value;
}
function isAbort(error) {
    return error instanceof Error && error.name === "AbortError";
}
//# sourceMappingURL=aiClient.js.map