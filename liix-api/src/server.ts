import crypto from "crypto";
import fs from "fs";
import path from "path";
import express, {
  NextFunction,
  Request,
  Response
} from "express";

import "dotenv/config";

const app = express();

app.use(express.json({
  limit: "10mb"
}));

const PORT = Number(
  process.env.PORT || 4000
);

const HOST =
  process.env.HOST ||
  "127.0.0.1";

const LM_STUDIO_URL = (
  process.env.LM_STUDIO_URL ||
  "http://127.0.0.1:1234"
).replace(/\/+$/, "");

const LM_STUDIO_API_KEY =
  process.env.LM_STUDIO_API_KEY || "";

const KEYS_FILE =
  path.join(
    process.cwd(),
    "keys.json"
  );

const USAGE_FILE =
  path.join(
    process.cwd(),
    "usage.json"
  );

interface ApiKeyEntry {
  id: string;
  name: string;
  hash: string;
  enabled: boolean;
  tokenLimit: number;
  createdAt?: string;
}

interface UsageEntry {
  keyId: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  failedRequests: number;
  lastUsedAt?: string;
}

interface AuthenticatedRequest
  extends Request {
  liixApiKey?: ApiKeyEntry;
}

function loadKeys(): ApiKeyEntry[] {
  if (!fs.existsSync(KEYS_FILE)) {
    console.warn(
      "[Liix] keys.json absent."
    );

    return [];
  }

  try {
    const data = JSON.parse(
      fs.readFileSync(
        KEYS_FILE,
        "utf8"
      )
    );

    return Array.isArray(data.keys)
      ? data.keys
      : [];
  } catch (error) {
    console.error(
      "[Liix] Impossible de lire keys.json:",
      error
    );

    return [];
  }
}

function loadUsage():
  Record<string, UsageEntry> {

  if (!fs.existsSync(USAGE_FILE)) {
    return {};
  }

  try {
    return JSON.parse(
      fs.readFileSync(
        USAGE_FILE,
        "utf8"
      )
    );
  } catch {
    return {};
  }
}

let keys =
  loadKeys();

let usage =
  loadUsage();

function saveUsage(): void {
  fs.writeFileSync(
    USAGE_FILE,
    JSON.stringify(
      usage,
      null,
      2
    ) + "\n",
    "utf8"
  );
}

function sha256(
  value: string
): string {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");
}

function safeHashEqual(
  a: string,
  b: string
): boolean {

  try {
    const bufferA =
      Buffer.from(a, "hex");

    const bufferB =
      Buffer.from(b, "hex");

    if (
      bufferA.length === 0 ||
      bufferA.length !==
        bufferB.length
    ) {
      return false;
    }

    return crypto
      .timingSafeEqual(
        bufferA,
        bufferB
      );
  } catch {
    return false;
  }
}

function findApiKey(
  rawKey: string
): ApiKeyEntry | undefined {

  const hash =
    sha256(rawKey);

  return keys.find(
    (key) =>
      key.enabled &&
      safeHashEqual(
        key.hash,
        hash
      )
  );
}

function getUsage(
  key: ApiKeyEntry
): UsageEntry {

  if (!usage[key.id]) {
    usage[key.id] = {
      keyId: key.id,
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      failedRequests: 0
    };
  }

  return usage[key.id];
}

function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {

  const authorization =
    req.headers.authorization;

  if (
    !authorization ||
    !authorization.startsWith(
      "Bearer "
    )
  ) {
    res.status(401).json({
      error: {
        message:
          "Missing Liix API Key",
        type:
          "authentication_error",
        code: 401
      }
    });

    return;
  }

  const rawKey =
    authorization
      .slice(7)
      .trim();

  const apiKey =
    findApiKey(rawKey);

  if (!apiKey) {
    res.status(401).json({
      error: {
        message:
          "Invalid Liix API Key",
        type:
          "authentication_error",
        code: 401
      }
    });

    return;
  }

  req.liixApiKey =
    apiKey;

  next();
}

function lmStudioHeaders():
  Record<string, string> {

  const headers:
    Record<string, string> = {
      "Content-Type":
        "application/json"
    };

  if (
    LM_STUDIO_API_KEY &&
    LM_STUDIO_API_KEY !==
      "REMPLACE_MOI"
  ) {
    headers.Authorization =
      `Bearer ${LM_STUDIO_API_KEY}`;
  }

  return headers;
}

app.get(
  "/health",
  (_req, res) => {
    res.json({
      ok: true,
      service: "Liix API",
      version: "0.1.0",
      lmStudio:
        LM_STUDIO_URL,
      configuredKeys:
        keys.length
    });
  }
);

app.get(
  "/v1/models",
  authenticate,
  async (
    req: AuthenticatedRequest,
    res
  ) => {

    try {
      const response =
        await fetch(
          `${LM_STUDIO_URL}/v1/models`,
          {
            headers:
              lmStudioHeaders()
          }
        );

      const text =
        await response.text();

      res.status(
        response.status
      );

      res.type(
        "application/json"
      );

      res.send(text);

    } catch (error) {
      console.error(
        "[Liix] LM Studio /models error:",
        error
      );

      res.status(502).json({
        error: {
          message:
            "LM Studio indisponible",
          type:
            "upstream_error",
          code: 502
        }
      });
    }
  }
);

app.get(
  "/v1/usage",
  authenticate,
  (
    req: AuthenticatedRequest,
    res
  ) => {

    const key =
      req.liixApiKey!;

    const currentUsage =
      getUsage(key);

    res.json({
      key: {
        id: key.id,
        name: key.name
      },

      usage:
        currentUsage,

      quota: {
        limit:
          key.tokenLimit,

        used:
          currentUsage
            .totalTokens,

        remaining:
          Math.max(
            0,
            key.tokenLimit -
              currentUsage
                .totalTokens
          )
      }
    });
  }
);

app.post(
  "/v1/chat/completions",
  authenticate,
  async (
    req: AuthenticatedRequest,
    res
  ) => {

    const startedAt =
      Date.now();

    const key =
      req.liixApiKey!;

    const currentUsage =
      getUsage(key);

    if (
      currentUsage.totalTokens >=
      key.tokenLimit
    ) {
      res.status(429).json({
        error: {
          message:
            "Liix token quota exceeded",
          type:
            "quota_error",
          code: 429
        }
      });

      return;
    }

    try {
      /*
       * Pour cette première version,
       * on force stream=false afin
       * de récupérer facilement
       * usage.prompt_tokens /
       * completion_tokens.
       *
       * On remettra ensuite le
       * streaming SSE.
       */
      const body = {
        ...req.body,
        stream: false
      };

      const response =
        await fetch(
          `${LM_STUDIO_URL}/v1/chat/completions`,
          {
            method: "POST",

            headers:
              lmStudioHeaders(),

            body:
              JSON.stringify(body)
          }
        );

      const responseText =
        await response.text();

      if (!response.ok) {

        currentUsage
          .failedRequests++;

        saveUsage();

        res.status(
          response.status
        );

        res.type(
          "application/json"
        );

        res.send(
          responseText
        );

        return;
      }

      let data: any;

      try {
        data =
          JSON.parse(
            responseText
          );
      } catch {
        throw new Error(
          "Réponse JSON LM Studio invalide."
        );
      }

      const upstreamUsage =
        data.usage || {};

      const promptTokens =
        Number(
          upstreamUsage
            .prompt_tokens || 0
        );

      const completionTokens =
        Number(
          upstreamUsage
            .completion_tokens || 0
        );

      const totalTokens =
        Number(
          upstreamUsage
            .total_tokens ??
          (
            promptTokens +
            completionTokens
          )
        );

      currentUsage.requests++;

      currentUsage.promptTokens +=
        promptTokens;

      currentUsage.completionTokens +=
        completionTokens;

      currentUsage.totalTokens +=
        totalTokens;

      currentUsage.lastUsedAt =
        new Date()
          .toISOString();

      saveUsage();

      console.log(
        [
          "[Liix]",
          key.id,
          key.name,
          `${totalTokens} tokens`,
          `${Date.now() - startedAt} ms`
        ].join(" | ")
      );

      res.json(data);

    } catch (error) {

      currentUsage
        .failedRequests++;

      saveUsage();

      console.error(
        "[Liix] Chat error:",
        error
      );

      res.status(502).json({
        error: {
          message:
            "LM Studio indisponible",
          type:
            "upstream_error",
          code: 502
        }
      });
    }
  }
);

app.listen(
  PORT,
  HOST,
  () => {

    console.log("");
    console.log(
      "============================="
    );
    console.log(
      "        LIIX API"
    );
    console.log(
      "============================="
    );

    console.log(
      `Gateway: http://${HOST}:${PORT}`
    );

    console.log(
      `LM Studio: ${LM_STUDIO_URL}`
    );

    console.log(
      `API Keys: ${keys.length}`
    );

    console.log(
      "============================="
    );
    console.log("");
  }
);
