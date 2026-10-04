import { useCallback, useEffect, useState } from "preact/hooks";
import { getLang, t, useLang } from "../i18n/index.js";
import { ExecutionResultSummary } from "../execution-result-summary.js";
import { type DeliveryResultSource, deliveryResult } from "../lib/execution-result.js";
import { api } from "../lib/api.js";
import { html } from "../lib/html.js";
import { usePoll } from "../lib/use-poll.js";

type StageStatus = "pending" | "active" | "passed" | "failed" | "awaiting_approval" | "rolled_back";

interface DeliveryStageRecord {
  stage: string;
  status: StageStatus;
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  evidenceIds?: string[];
}

interface DeliveryRun {
  id: string;
  title: string;
  requirement: string;
  status: string;
  currentStage: string;
  iteration: number;
  updatedAt: string;
  stages: Record<string, DeliveryStageRecord>;
  artifacts: Array<{ kind: string; path: string }>;
  acceptanceCriteria: Array<{
    id: string;
    description: string;
    verification: string;
    status: "pending" | "passed" | "failed";
    evidence?: string;
  }>;
  workspace?: { path: string; branch: string; baseRef: string };
  productionApproval: {
    status: "pending" | "approved" | "rejected";
    actor?: string;
    comment?: string;
  };
  newIssues: string[];
  evidence?: DeliveryResultSource["evidence"];
}

interface DeliveryListData {
  runs?: DeliveryRun[];
}

interface DeliveryRunnerState {
  status: "running" | "stopped" | "failed";
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

const STAGE_ORDER = [
  "intake",
  "acceptance",
  "workspace",
  "development",
  "validation",
  "audit",
  "acceptance_gate",
  "staging_deploy",
  "staging_verify",
  "production_approval",
  "canary_deploy",
  "observation",
  "iteration_review",
];

function tone(status: StageStatus): string {
  if (status === "passed") return "ok";
  if (status === "failed" || status === "rolled_back") return "err";
  if (status === "active" || status === "awaiting_approval") return "warn";
  return "";
}

function stageLabel(stage: string): string {
  const label = t(`delivery.stageLabels.${stage}`);
  return label === `delivery.stageLabels.${stage}` ? stage : label;
}

function RunDetail(props: {
  run: DeliveryRun;
  runner: DeliveryRunnerState | null;
  onAction: (action: string, body: Record<string, unknown>) => Promise<void>;
  busy: boolean;
  error: string;
}) {
  const { run, runner, onAction, busy, error } = props;
  const [actor, setActor] = useState("");
  const [comment, setComment] = useState("");
  const [baseRef, setBaseRef] = useState("HEAD");
  const [rollbackSummary, setRollbackSummary] = useState("");
  const [unattended, setUnattended] = useState(false);
  const canRun =
    !["workspace", "production_approval"].includes(run.currentStage) &&
    !["completed", "failed", "rolled_back"].includes(run.status);
  return html`
    <div class="sessions-detail" style="overflow-y:auto">
      <div class="sessions-detail-h">
        <span class="name">${run.title}</span>
        <span class="ws">${run.id} · ${t("delivery.iteration", { n: run.iteration })}</span>
        <span class=${`pill ${run.status === "completed" ? "ok" : run.status.includes("failed") || run.status === "rolled_back" ? "err" : "info"}`}>${run.status}</span>
      </div>
      ${error ? html`<div class="card accent-err" style="margin-bottom:12px">${error}</div>` : null}
      <${ExecutionResultSummary} result=${deliveryResult(run)} language=${getLang()} />
      <div class="card accent-brand" style="margin-bottom:12px">
        <div class="card-h"><span class="title">${t("delivery.requirement")}</span></div>
        <div class="card-b" style="white-space:pre-wrap">${run.requirement}</div>
      </div>
      ${
        canRun
          ? html`<div class="card accent-warn" style="margin-bottom:12px">
            <div class="card-h">
              <span class="title">${t("delivery.runnerTitle")}</span>
              ${runner ? html`<span class=${`pill ${runner.status === "failed" ? "err" : runner.status === "running" ? "warn" : "ok"}`}>${runner.status}</span>` : null}
            </div>
            <label style="display:flex;gap:8px;align-items:flex-start;margin:8px 0">
              <input type="checkbox" checked=${unattended} onChange=${(e: Event) => setUnattended((e.target as HTMLInputElement).checked)} />
              <span>${t("delivery.runnerConsent")}</span>
            </label>
            ${runner?.error ? html`<div style="color:var(--c-err);margin-bottom:8px">${runner.error}</div>` : null}
            <button class="btn primary" disabled=${busy || runner?.status === "running" || !unattended} onClick=${() => onAction("run", { confirmUnattended: true })}>${t("delivery.runUntilGate")}</button>
          </div>`
          : null
      }
      <div class="card" style="margin-bottom:12px">
        <div class="card-h"><span class="title">${t("delivery.timeline")}</span></div>
        <div class="plan-timeline">
          ${STAGE_ORDER.map((stage) => {
            const record = run.stages[stage];
            if (!record) return null;
            return html`
              <div class=${`plan-step ${record.status === "passed" ? "done" : record.status === "active" || record.status === "awaiting_approval" ? "active" : ""}`}>
                <span class="name">${stageLabel(stage)}</span>
                <span class=${`pill ${tone(record.status)}`}>${record.status}</span>
                ${record.attempts > 0 ? html`<span class="meta">${t("delivery.attempts", { n: record.attempts, max: record.maxAttempts })}</span>` : null}
                ${record.lastError ? html`<span class="meta" style="color:var(--c-err)">${record.lastError}</span>` : null}
              </div>
            `;
          })}
        </div>
      </div>

      ${
        run.currentStage === "intake" || run.currentStage === "acceptance"
          ? html`<div class="card accent-warn" style="margin-bottom:12px">
              <div class="card-h"><span class="title">${t("delivery.prdAction")}</span></div>
              <div class="card-b"><code>/skill prd-agent delivery run ${run.id}</code></div>
            </div>`
          : null
      }
      ${
        run.currentStage === "workspace"
          ? html`<div class="card accent-warn" style="margin-bottom:12px">
              <div class="card-h"><span class="title">${t("delivery.workspaceAction")}</span></div>
              <div class="form-row">
                <span class="lbl">${t("delivery.baseRef")}</span>
                <input class="input" value=${baseRef} onInput=${(e: Event) => setBaseRef((e.target as HTMLInputElement).value)} />
              </div>
              <button class="btn primary" disabled=${busy} onClick=${() => onAction("workspace", { baseRef, actor: "web-user" })}>${t("delivery.createWorkspace")}</button>
            </div>`
          : null
      }
      ${
        run.workspace
          ? html`<div class="card" style="margin-bottom:12px">
              <div class="card-h"><span class="title">${t("delivery.workspace")}</span></div>
              <div class="card-b"><code>${run.workspace.branch}</code><br /><code>${run.workspace.path}</code></div>
            </div>`
          : null
      }
      ${
        run.currentStage === "production_approval"
          ? html`<div class="card accent-warn" style="margin-bottom:12px">
              <div class="card-h"><span class="title">${t("delivery.productionGate")}</span></div>
              <div class="form-row">
                <span class="lbl">${t("delivery.actor")}</span>
                <input class="input" value=${actor} onInput=${(e: Event) => setActor((e.target as HTMLInputElement).value)} />
              </div>
              <div class="form-row">
                <span class="lbl">${t("delivery.comment")}</span>
                <textarea class="textarea" value=${comment} onInput=${(e: Event) => setComment((e.target as HTMLTextAreaElement).value)}></textarea>
              </div>
              <div style="display:flex;gap:8px">
                <button class="btn primary" disabled=${busy || !actor.trim()} onClick=${() => onAction("approve-production", { actor, comment })}>${t("delivery.approveProduction")}</button>
                <button class="btn" disabled=${busy || !actor.trim() || !comment.trim()} onClick=${() => onAction("reject-production", { actor, comment })}>${t("delivery.rejectProduction")}</button>
              </div>
            </div>`
          : null
      }
      ${
        run.status === "rolling_back"
          ? html`<div class="card accent-err" style="margin-bottom:12px">
              <div class="card-h"><span class="title">${t("delivery.rollbackRequired")}</span></div>
              <div class="form-row">
                <span class="lbl">${t("delivery.actor")}</span>
                <input class="input" value=${actor} onInput=${(e: Event) => setActor((e.target as HTMLInputElement).value)} />
              </div>
              <div class="form-row">
                <span class="lbl">${t("delivery.rollbackEvidence")}</span>
                <textarea class="textarea" value=${rollbackSummary} onInput=${(e: Event) => setRollbackSummary((e.target as HTMLTextAreaElement).value)}></textarea>
              </div>
              <button class="btn primary" disabled=${busy || !actor.trim() || !rollbackSummary.trim()} onClick=${() => onAction("rollback-complete", { actor, summary: rollbackSummary })}>${t("delivery.confirmRollback")}</button>
            </div>`
          : null
      }
      ${
        run.acceptanceCriteria.length > 0
          ? html`<div class="card">
              <div class="card-h"><span class="title">${t("delivery.acceptance")}</span><span class="meta">${run.acceptanceCriteria.length}</span></div>
              ${run.acceptanceCriteria.map(
                (criterion) => html`<div style="padding:8px 0;border-top:1px solid var(--bd)">
                  <div style="display:flex;gap:8px"><code>${criterion.id}</code><span class=${`pill ${criterion.status === "passed" ? "ok" : criterion.status === "failed" ? "err" : ""}`}>${criterion.status}</span></div>
                  <div style="margin-top:4px">${criterion.description}</div>
                  <div style="color:var(--fg-3);font-size:11px;margin-top:3px">${criterion.verification}</div>
                </div>`,
              )}
            </div>`
          : null
      }
    </div>
  `;
}

export function DeliveryPanel() {
  useLang();
  const { data, error, loading, refresh } = usePoll<DeliveryListData>("/delivery", 3000);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DeliveryRun | null>(null);
  const [runner, setRunner] = useState<DeliveryRunnerState | null>(null);
  const [title, setTitle] = useState("");
  const [requirement, setRequirement] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const runs = data?.runs ?? [];

  const loadDetail = useCallback(async (id: string) => {
    try {
      const result = await api<{ run: DeliveryRun; runner: DeliveryRunnerState | null }>(
        `/delivery/${encodeURIComponent(id)}`,
      );
      setDetail(result.run);
      setRunner(result.runner);
      setActionError("");
    } catch (err) {
      setActionError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    void loadDetail(selectedId);
    const timer = window.setInterval(() => void loadDetail(selectedId), 3000);
    return () => window.clearInterval(timer);
  }, [selectedId, loadDetail]);

  const create = useCallback(async () => {
    if (!title.trim() || !requirement.trim()) return;
    setBusy(true);
    setActionError("");
    try {
      const result = await api<{ run: DeliveryRun }>("/delivery", {
        method: "POST",
        body: { title: title.trim(), requirement: requirement.trim() },
      });
      setTitle("");
      setRequirement("");
      setSelectedId(result.run.id);
      setDetail(result.run);
      setRunner(null);
      await refresh();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [title, requirement, refresh]);

  const action = useCallback(
    async (name: string, body: Record<string, unknown>) => {
      if (!selectedId) return;
      setBusy(true);
      setActionError("");
      try {
        const result = await api<{ run: DeliveryRun; runner?: DeliveryRunnerState }>(
          `/delivery/${encodeURIComponent(selectedId)}/${name}`,
          { method: "POST", body },
        );
        setDetail(result.run);
        if (result.runner) setRunner(result.runner);
        await refresh();
      } catch (err) {
        setActionError((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [selectedId, refresh],
  );

  if (loading && !data) return html`<div class="card">${t("common.loading")}</div>`;
  if (error) return html`<div class="card accent-err">${error.message}</div>`;

  return html`
    <div class="sessions-grid">
      <div class="sessions-list">
        <div style="padding:12px;border-bottom:1px solid var(--bd)">
          <div class="form-row">
            <span class="lbl">${t("delivery.title")}</span>
            <input class="input" value=${title} onInput=${(e: Event) => setTitle((e.target as HTMLInputElement).value)} />
          </div>
          <div class="form-row">
            <span class="lbl">${t("delivery.requirement")}</span>
            <textarea class="textarea" rows="4" value=${requirement} onInput=${(e: Event) => setRequirement((e.target as HTMLTextAreaElement).value)}></textarea>
          </div>
          <button class="btn primary" disabled=${busy || !title.trim() || !requirement.trim()} onClick=${create}>${t("delivery.create")}</button>
        </div>
        <div class="ssl-rows">
          ${runs.length === 0 ? html`<div style="padding:20px;color:var(--fg-3)">${t("delivery.empty")}</div>` : null}
          ${runs.map(
            (
              run,
            ) => html`<div class=${`ssl-row ${selectedId === run.id ? "sel" : ""}`} onClick=${() => setSelectedId(run.id)}>
              <span class="name">${run.title}</span>
              <span class="preview">${stageLabel(run.currentStage)}</span>
              <span class="meta"><span class="v">${run.status}</span><span>${t("delivery.iteration", { n: run.iteration })}</span></span>
            </div>`,
          )}
        </div>
      </div>
      ${detail ? html`<${RunDetail} run=${detail} runner=${runner} onAction=${action} busy=${busy} error=${actionError} />` : html`<div class="sessions-detail" style="display:grid;place-items:center;color:var(--fg-3)">${t("delivery.pick")}</div>`}
    </div>
  `;
}
