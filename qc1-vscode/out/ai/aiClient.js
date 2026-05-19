"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LiixAiClient = void 0;
exports.getLiixProvider = getLiixProvider;
exports.getLiixLocalApiUrl = getLiixLocalApiUrl;
exports.getLiixLocalApiType = getLiixLocalApiType;
exports.getLiixLocalModel = getLiixLocalModel;
exports.getActiveLiixEndpoint = getActiveLiixEndpoint;
exports.getActiveLiixModel = getActiveLiixModel;
exports.updateLiixRuntimeConfig = updateLiixRuntimeConfig;
exports.setActiveLiixModel = setActiveLiixModel;
exports.getLiixRuntimeConfig = getLiixRuntimeConfig;
exports.getAvailableLiixModels = getAvailableLiixModels;
exports.sendLiixChat = sendLiixChat;
const vscode = require("vscode");
const aiModels_1 = require("./aiModels");
function getLiixApiUrl() {
    return vscode.workspace
        .getConfiguration()
        .get("liix.apiUrl", "https://true-mega-shall-icq.trycloudflare.com");
}
function getLiixApiKey() {
    return vscode.workspace.getConfiguration().get("liix.apiKey", "");
}
function getLiixProvider() {
    return vscode.workspace.getConfiguration().get("liix.provider", "liix");
}
function getLiixLocalApiUrl() {
    return vscode.workspace.getConfiguration().get("liix.localApiUrl", "http://localhost:11434");
}
function getLiixLocalApiType() {
    return vscode.workspace.getConfiguration().get("liix.localApiType", "ollama");
}
function getLiixLocalModel() {
    return vscode.workspace.getConfiguration().get("liix.localModel", "qwen2.5-coder:7b-instruct");
}
function getActiveLiixEndpoint() {
    return getLiixProvider() === "local" ? getLiixLocalApiUrl() : getLiixApiUrl();
}
function getActiveLiixModel() {
    return getLiixProvider() === "local"
        ? getLiixLocalModel()
        : vscode.workspace.getConfiguration().get("liix.defaultModel", aiModels_1.liixAiModels[0].id);
}
async function updateLiixRuntimeConfig(update) {
    const config = vscode.workspace.getConfiguration();
    if (update.provider) {
        await config.update("liix.provider", update.provider, vscode.ConfigurationTarget.Workspace);
    }
    if (update.localApiType) {
        await config.update("liix.localApiType", update.localApiType, vscode.ConfigurationTarget.Workspace);
    }
    if (typeof update.localApiUrl === "string") {
        await config.update("liix.localApiUrl", update.localApiUrl, vscode.ConfigurationTarget.Workspace);
    }
    if (typeof update.localModel === "string") {
        await config.update("liix.localModel", update.localModel, vscode.ConfigurationTarget.Workspace);
    }
    if (typeof update.defaultModel === "string") {
        await config.update("liix.defaultModel", update.defaultModel, vscode.ConfigurationTarget.Workspace);
    }
}
async function setActiveLiixModel(modelId) {
    const configKey = getLiixProvider() === "local" ? "liix.localModel" : "liix.defaultModel";
    await vscode.workspace.getConfiguration().update(configKey, modelId, vscode.ConfigurationTarget.Workspace);
}
async function getLiixRuntimeConfig() {
    const provider = getLiixProvider();
    const localMode = provider === "local";
    const models = await getAvailableLiixModels();
    let model = localMode ? getLiixLocalModel() : vscode.workspace.getConfiguration().get("liix.defaultModel", aiModels_1.liixAiModels[0].id);
    if (!models.some((item) => item.id === model) && models[0]) {
        model = models[0].id;
        await setActiveLiixModel(model);
    }
    return {
        provider,
        mode: localMode ? "local" : "cloud",
        endpoint: localMode ? getLiixLocalApiUrl() : getLiixApiUrl(),
        model,
        localApiType: getLiixLocalApiType(),
        localModel: getLiixLocalModel(),
        models
    };
}
async function getAvailableLiixModels() {
    const provider = getLiixProvider();
    if (provider === "liix") {
        return aiModels_1.liixAiModels.map((model) => ({
            id: model.id,
            label: model.label,
            provider: "liix",
            source: "liix"
        }));
    }
    const localApiType = getLiixLocalApiType();
    const localApiUrl = normalizeApiUrl(getLiixLocalApiUrl());
    try {
        if (localApiType === "ollama") {
            return withLocalModelFallback(normalizeOllamaModels(await getJson(`${localApiUrl}/api/tags`, "Local Ollama API")), localApiType);
        }
        return withLocalModelFallback(normalizeOpenAiModels(await getJson(`${localApiUrl}/v1/models`, "Local OpenAI-compatible API")), localApiType);
    }
    catch {
        const fallback = getLiixLocalModel();
        return [{
                id: fallback,
                label: fallback,
                provider: "local",
                source: localApiType === "ollama" ? "ollama" : "openai-compatible"
            }];
    }
}
function withLocalModelFallback(models, localApiType) {
    if (models.length > 0) {
        return models;
    }
    const fallback = getLiixLocalModel();
    return [{
            id: fallback,
            label: fallback,
            provider: "local",
            source: localApiType === "ollama" ? "ollama" : "openai-compatible"
        }];
}
async function sendLiixChat(request) {
    const provider = getLiixProvider();
    const message = getLiixRequestMessage(request);
    if (provider === "liix") {
        const model = (0, aiModels_1.getBackendModelId)(request.model);
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
        return sendLocalLiixChat(message, request.model);
    }
    throw new Error(`Invalid Liix provider "${provider}". Expected "liix" or "local".`);
}
function getLiixRequestMessage(request) {
    if (typeof request.message === "string") {
        return request.message;
    }
    return request.messages
        ?.filter((message) => message.role === "user")
        .at(-1)?.content ?? "";
}
async function sendLocalLiixChat(message, modelOverride) {
    const localApiType = getLiixLocalApiType();
    const localApiUrl = normalizeApiUrl(getLiixLocalApiUrl());
    const localModel = modelOverride || getLiixLocalModel();
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
async function postJson(url, options) {
    let response;
    try {
        response = await fetch(url, {
            method: "POST",
            headers: options.headers,
            body: JSON.stringify(options.body)
        });
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`${options.errorPrefix} connection failed. Check that the server is running at ${url}. ${detail}`);
    }
    const responseText = await response.text();
    if (!response.ok) {
        throw new Error(`${options.errorPrefix} error: ${response.status} ${response.statusText}${formatResponseSnippet(responseText)}`);
    }
    try {
        return responseText ? JSON.parse(responseText) : {};
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`${options.errorPrefix} returned invalid JSON. ${detail}`);
    }
}
async function getJson(url, errorPrefix) {
    let response;
    try {
        response = await fetch(url, {
            method: "GET",
            headers: {
                "Content-Type": "application/json"
            }
        });
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`${errorPrefix} connection failed. Check that the server is running at ${url}. ${detail}`);
    }
    const responseText = await response.text();
    if (!response.ok) {
        throw new Error(`${errorPrefix} error: ${response.status} ${response.statusText}${formatResponseSnippet(responseText)}`);
    }
    try {
        return responseText ? JSON.parse(responseText) : {};
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`${errorPrefix} returned invalid JSON. ${detail}`);
    }
}
function normalizeApiUrl(apiUrl) {
    return apiUrl.replace(/\/+$/, "");
}
function normalizeLiixCloudResponse(data) {
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
function normalizeOllamaResponse(data) {
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
function normalizeOpenAiCompatibleResponse(data) {
    const response = getObjectResponse(data, "Local OpenAI-compatible response is invalid.");
    const choices = response.choices;
    if (!Array.isArray(choices)) {
        throw new Error("Local OpenAI-compatible response is invalid: missing choices.");
    }
    const firstChoice = choices[0];
    if (!firstChoice || typeof firstChoice !== "object") {
        throw new Error("Local OpenAI-compatible response is invalid: missing first choice.");
    }
    const message = firstChoice.message;
    if (!message || typeof message !== "object") {
        throw new Error("Local OpenAI-compatible response is invalid: missing choice message.");
    }
    const content = message.content;
    if (typeof content !== "string") {
        throw new Error("Local OpenAI-compatible response is invalid: missing message content.");
    }
    return {
        content,
        usage: response.usage,
        server: response.model
    };
}
function normalizeOllamaModels(data) {
    const response = getObjectResponse(data, "Local Ollama models response is invalid.");
    const models = response.models;
    if (!Array.isArray(models)) {
        return [];
    }
    return models
        .map((model) => {
        if (!model || typeof model !== "object") {
            return undefined;
        }
        const item = model;
        const id = typeof item.name === "string" ? item.name : undefined;
        return id ? {
            id,
            label: id,
            provider: "local",
            source: "ollama"
        } : undefined;
    })
        .filter((model) => model !== undefined);
}
function normalizeOpenAiModels(data) {
    const response = getObjectResponse(data, "Local OpenAI-compatible models response is invalid.");
    const models = response.data;
    if (!Array.isArray(models)) {
        return [];
    }
    return models
        .map((model) => {
        if (!model || typeof model !== "object") {
            return undefined;
        }
        const item = model;
        const id = typeof item.id === "string" ? item.id : undefined;
        return id ? {
            id,
            label: id,
            provider: "local",
            source: "openai-compatible"
        } : undefined;
    })
        .filter((model) => model !== undefined);
}
function getObjectResponse(data, invalidMessage) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error(invalidMessage);
    }
    return data;
}
function getStringField(response, fields) {
    for (const field of fields) {
        const value = response[field];
        if (typeof value === "string") {
            return value;
        }
    }
    return undefined;
}
function formatResponseSnippet(responseText) {
    if (!responseText) {
        return "";
    }
    const snippet = responseText.length > 300 ? `${responseText.slice(0, 300)}...` : responseText;
    return ` - ${snippet}`;
}
class LiixAiClient {
    async sendMessage(request) {
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
exports.LiixAiClient = LiixAiClient;
function getLiixResponseContent(data) {
    if (typeof data === "string") {
        return data;
    }
    if (!data || typeof data !== "object") {
        return "";
    }
    const response = data;
    const content = response.content ?? response.message ?? response.response ?? response.text;
    return typeof content === "string" ? content : JSON.stringify(response, null, 2);
}
//# sourceMappingURL=aiClient.js.map