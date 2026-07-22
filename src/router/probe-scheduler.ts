/**
 * 后台调度：每 60s 给所有 active provider 跑一次 probe。
 * - 与请求路径完全分离；probe 失败 / 超时不会影响真实请求
 * - 启动时间隔 5s（让 next server 先 warm up）
 * - 不可见 / 退出时优雅停止
 *
 * 调用方需提供 storage + alert hooks（0 业务依赖）。
 */
import type { HealthStorage, HealthRecord } from "./health-probe";
import { probeProvider } from "./health-probe";
import type { AlertHooks, AlertResult } from "./alerts";
import { evaluateHealthAlerts } from "./alerts";
import type { UsageStats } from "./alerts";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let bootPromise: Promise<void> | null = null;
let stopRequested = false;

export interface ProbeSchedulerHooks {
  storage: HealthStorage;
  load24hUsage: () => Promise<UsageStats>;
  /** Optional — 评估健康告警；不传则跳过 */
  alertHooks?: Omit<AlertHooks, "loadHealthSnapshots" | "load24hUsage">;
  /** Optional — 拉取最新 health 快照（告警评估用），不传则跳过 */
  loadHealthSnapshots?: () => Promise<HealthRecord[]>;
}

let hooks: ProbeSchedulerHooks | null = null;

export function configureProbeScheduler(h: ProbeSchedulerHooks) {
  hooks = h;
}

/** Lazy 启动：首次调用时启动；幂等。 */
export function startProbeScheduler(): void {
  if (timer || !hooks) return;
  if (bootPromise) return;
  bootPromise = (async () => {
    if (process.env.ECHO_ROUTER_PROBE_DISABLED === "true") {
      console.log("[router-probe] scheduler disabled by env");
      return;
    }
    // 立即跑一次（轻度延迟）
    await new Promise((r) => setTimeout(r, 3000));
    await tick(hooks!);
    if (stopRequested) return;
    // 周期循环
    timer = setInterval(() => {
      if (running || !hooks) return;
      running = true;
      tick(hooks).finally(() => (running = false));
    }, parseInt(process.env.ECHO_PROBE_INTERVAL_MS ?? "60000", 10));
    console.log("[router-probe] scheduler started");
  })();
}

export function stopProbeScheduler(): void {
  stopRequested = true;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  bootPromise = null;
}

async function tick(h: ProbeSchedulerHooks) {
  try {
    await probeProvider({ storage: h.storage });
    if (h.alertHooks && h.loadHealthSnapshots) {
      await evaluateHealthAlerts({
        loadHealthSnapshots: h.loadHealthSnapshots,
        load24hUsage: h.load24hUsage,
        emit: h.alertHooks.emit,
      });
    }
  } catch (e) {
    console.error("[router-probe]", e);
  }
}
