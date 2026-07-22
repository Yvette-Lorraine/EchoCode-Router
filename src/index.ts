/**
 * EchoCode Router — 公共 API
 *
 * 一个 OpenAI 兼容 AI 网关的智能路由层。
 * - 0 业务依赖（不绑 Prisma / Next.js / 任何 ORM）
 * - 可独立嵌入 Express / Next.js / Hono / Fastify / Bun / Deno
 * - 算法纯函数：score / strategy / cascade / key-pool / errors / rate-limit / cache / alerts
 *
 * 集成步骤（详见 README）：
 *  1. 实现 RouterStorage 接口（10 个方法，绑定你的 ORM）
 *  2. 实现 KeyStore / DecisionStore / HealthStorage / AdminAuthHooks
 *  3. import { resolveRoute, runCascade, getAdapter } from "echocode-router"
 */

export * from "./router/types";
export * from "./router/score";
export * from "./router/strategies";
export * from "./router/errors";
export * from "./router/key-pool";
export * from "./router/cascade";
export * from "./router/cache";
export * from "./router/rate-limit";
export * from "./router/decision";
export * from "./router/alerts";
export * from "./router/admin-auth";
export * from "./router/logger";
export * from "./router/health-probe";

export * from "./providers/types";
export * from "./providers/openai";
export * from "./providers/mock";
export * from "./providers/index";

export {
  resolveRoute,
  type ResolveRouteCtx,
  type RouterStorage,
  type ResolvedModel,
} from "./core/resolve";
