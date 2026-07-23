/**
 * EchoCode Router — 独立可运行示例
 *
 * 一个 100 行的 Node HTTP server：
 *   POST /v1/chat/completions  →  OpenAI 兼容 + EchoCode Router 调度
 *
 * 不依赖任何 ORM / Next.js / Express。
 * 数据全部存内存（见 data.ts）。
 *
 * 运行：
 *   npm install echocode-router
 *   node examples/standalone-server.js
 *   curl -X POST http://localhost:8787/v1/chat/completions \
 *     -H "Content-Type: application/json" \
 *     -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"你好"}]}'
 */

import { createServer } from "node:http";
import {
  resolveRoute,
  runCascade,
  getAdapter,
} from "echocode-router";
import { inMemoryStorage, demoData } from "./data.js";

/** 从内存数据创建 RouterStorage */
const storage = inMemoryStorage(demoData);

/** 简易 KeyStore 实现（Demo 无副作用） */
const keyStore = {
  async markSuccess(_byokId: string) {},
  async markFailure(_byokId: string, _status?: number) {},
  async markInvalid(_byokId: string) {},
};

/* ========== HTTP server ========== */
const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  // 读请求体
  let body = "";
  for await (const chunk of req) body += chunk;
  let reqJson: any;
  try {
    reqJson = JSON.parse(body);
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "INVALID_JSON" } }));
    return;
  }

  const { model, messages } = reqJson;
  if (!model || !Array.isArray(messages) || messages.length === 0) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "INVALID_REQUEST" } }));
    return;
  }

  // 1) 路由评分
  let ranked: any[], decision: any;
  try {
    const out = await resolveRoute("org-demo", model, { allowMockFallback: true }, storage);
    ranked = out.ranked;
    decision = out.decision;
  } catch (e: any) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "UNKNOWN_MODEL", message: e.message } }));
    return;
  }

  // 2) cascade 顺位重试
  const cascade = await runCascade(
    ranked,
    async (providerId, modelId, byokId) => {
      try {
        const adapter = getAdapter(providerId);
        const out = await adapter.completeChat(
          { model: modelId, messages, stream: false },
          { apiKey: "demo-key", orgId: "org-demo", keyId: byokId ?? "demo" }
        );
        return { ok: true, data: out };
      } catch (e: any) {
        return { ok: false, status: e?.status, bodyText: e?.message, error: e };
      }
    },
    { keyStore } as any
  );

  // 3) 返回结果
  if (!cascade.ok || !cascade.chosen) {
    const last = cascade.finalError;
    res.writeHead(502, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: { code: "ALL_ATTEMPTS_FAILED", message: (last as any)?.message ?? "无可用候选" },
        routeDecision: {
          ...decision,
          chosen: null,
          fallbackChain: cascade.attempts.map(
            (a) => `${a.providerId}:${a.byokId ?? "no-key"}=${a.errorClass ?? "ok"}`
          ),
        },
      })
    );
    return;
  }

  res.writeHead(200, { "content-type": "application/json" });
  const responseData = cascade.attempts[cascade.attempts.length - 1].response as any;
  res.end(
    JSON.stringify({
      ...responseData,
      _echo: {
        alias: decision.alias,
        strategy: decision.strategy,
        chosen: cascade.chosen,
        totalRouterMs: decision.totalRouterMs,
      },
    })
  );
});

const PORT = Number(process.env.PORT ?? 8787);
server.listen(PORT, () => {
  console.log(`🚀 EchoCode Router 已启动 → http://localhost:${PORT}`);
  console.log(`   试试: curl -X POST http://localhost:${PORT}/v1/chat/completions -H "Content-Type: application/json" -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"你好"}]}'`);
});
