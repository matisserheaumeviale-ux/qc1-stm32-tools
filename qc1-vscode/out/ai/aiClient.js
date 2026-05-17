"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LiixAiClient = void 0;
const aiModels_1 = require("./aiModels");
class LiixAiClient {
    async sendMessage(request) {
        return this.sendMockResponse(request);
    }
    async sendMockResponse(request) {
        const modelLabel = (0, aiModels_1.getAiModelLabel)(request.modelId);
        const contextNote = request.context
            ? "\n\nContexte recu par le mode dev. Le futur serveur Liix pourra l'utiliser pour une analyse reelle."
            : "";
        return {
            modelId: request.modelId,
            simulated: true,
            content: `[${modelLabel}] Reponse simulee en mode mock/dev.\n\n` +
                "Les modeles Liix Code sont encore en entrainement. " +
                "Cette architecture est prete pour brancher plus tard le serveur distant Liix sans changer l'interface VSCode." +
                `${contextNote}\n\nMessage: ${request.message}`
        };
    }
}
exports.LiixAiClient = LiixAiClient;
//# sourceMappingURL=aiClient.js.map