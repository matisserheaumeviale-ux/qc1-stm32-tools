"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LiixAiClient = void 0;
exports.getLiixProvider = getLiixProvider;
exports.getLiixLocalApiUrl = getLiixLocalApiUrl;
exports.getLiixLocalApiType = getLiixLocalApiType;
exports.getLiixLocalModel = getLiixLocalModel;
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
        return sendLocalLiixChat(message);
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
async function sendLocalLiixChat(message) {
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