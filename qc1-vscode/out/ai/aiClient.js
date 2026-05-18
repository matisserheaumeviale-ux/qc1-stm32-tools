"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LiixAiClient = void 0;
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
async function sendLiixChat(request) {
    const model = (0, aiModels_1.getBackendModelId)(request.model);
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