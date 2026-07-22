/**
 * 单家 provider 的健康探测。
 * - 通过 HTTP GET {baseUrl}/v1/models 验证可达性与响应延迟
 * - 凭据优先级：env `ECHO_PROBE_KEY_{PROVIDER}` → storage.loadProbeKey(providerId)
 * - 单次超时 3s（env ECHO_PROBE_TIMEOUT_MS 可调）
 * - 连续失败 N=3 次后置 status=DOWN
 * - 结果通过 storage.saveHealth() 落库，router-core 不直接绑 Prisma
 */

export interface HealthRecord {
  providerId: string;
  status: "HEALTHY" | "DEGRADED" | "DOWN" | "UNKNOWN";
  successRate: number; // 0..1
  score: number; // 0..1
  p95Ms: number;
  consecutiveFailures: number;
  windowMs: number;
  errorMessage: string | null;
  checkedAt?: Date;
}

/**
 * 由调用方实现：负责取活跃 provider / 读历史 / 写新结果。
 * 可以接 Prisma、MongoDB、内存、SQLite、文件 — router-core 不耦合。
 */
export interface HealthStorage {
  loadActiveProviders(): Promise<Array<{ id: string; baseUrl: string }>>;
  loadLatestHealth(providerId: string): Promise<{ status: string; consecutiveFailures: number } | null>;
  loadRecentHealth(
    providerId: string,
    take: number
  ): Promise<Array<{ status: string }>>;
  saveHealth(record: HealthRecord): Promise<void>;
}

export interface ProbeOpts {
  signal?: AbortSignal;
  storage: HealthStorage;
  /** Optional provider id override. If absent, probes every active provider. */
  onlyProviderId?: string;
  /** Timeout per probe in ms. Default 3000. */
  timeoutMs?: number;
}

export async function probeProvider(opts: ProbeOpts): Promise<void> {
  const providers = opts.onlyProviderId
    ? [await lookupOne(opts.storage, opts.onlyProviderId)].filter(Boolean) as Array<{ id: string; baseUrl: string }>
    : await opts.storage.loadActiveProviders();
  await Promise.allSettled(providers.map((p) => probeOne(p, opts)));
}

export async function probeOne(
  provider: { id: string; baseUrl: string },
  opts: ProbeOpts
): Promise<void> {
  const providerId = provider.id;
  const envKey = process.env[`ECHO_PROBE_KEY_${providerId.toUpperCase()}`];
  let apiKey = envKey ?? "";
  if (!apiKey && "loadProbeKey" in opts.storage) {
    apiKey = await (opts.storage as any).loadProbeKey(providerId).catch(() => "");
  }

  if (!apiKey) {
    // 没有探针凭据也写一行（UNKNOWN），便于运维发现
    await opts.storage.saveHealth({
      providerId,
      status: "UNKNOWN",
      successRate: 0,
      score: 0,
      consecutiveFailures: 1,
      windowMs: 3_600_000,
      p95Ms: 0,
      errorMessage: "no probe credential configured",
      checkedAt: new Date(),
    });
    return;
  }

  const base = provider.baseUrl.replace(/\/+$/, "");
  const url = base.endsWith("/v1") ? `${base}/models` : `${base}/v1/models`;
  const t0 = Date.now();
  let ok = false;
  let errorMessage: string | null = null;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, "User-Agent": "echo-code-router-probe/0.1" },
      signal:
        opts.signal ??
        (AbortSignal.timeout(opts.timeoutMs ?? parseInt(process.env.ECHO_PROBE_TIMEOUT_MS ?? "3000", 10))),
    });
    ok = res.ok;
    if (!ok) errorMessage = `HTTP ${res.status}`;
  } catch (e) {
    ok = false;
    errorMessage = (e as Error).message || "fetch failed";
  }
  const latencyMs = Date.now() - t0;

  const prev = await opts.storage.loadLatestHealth(providerId);
  const consecutiveFailures = ok ? 0 : (prev?.consecutiveFailures ?? 0) + 1;
  let status: HealthRecord["status"] = "HEALTHY";
  if (!ok) {
    status = consecutiveFailures >= 3 ? "DOWN" : "DEGRADED";
  }

  // 滚动成功率（最近 30 次 + 本次）
  const recent = await opts.storage.loadRecentHealth(providerId, 30);
  const window = recent.length || 1;
  const okCount = recent.filter((r) => r.status === "HEALTHY").length + (ok ? 1 : 0);
  const successRate = okCount / Math.min(window + 1, 30);
  const score = Math.max(0, Math.min(1, successRate * Math.max(0, 1 - latencyMs / 5000)));

  await opts.storage.saveHealth({
    providerId,
    status,
    successRate,
    score,
    consecutiveFailures,
    windowMs: 3_600_000,
    p95Ms: latencyMs,
    errorMessage,
    checkedAt: new Date(),
  });
}

async function lookupOne(storage: HealthStorage, providerId: string) {
  const list = await storage.loadActiveProviders();
  return list.find((p) => p.id === providerId);
}
