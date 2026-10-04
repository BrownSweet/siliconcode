import type { ExecutionResult, ResultState } from "./lib/execution-result.js";
import { html } from "./lib/html.js";

const labels: Record<ResultState, { zh: string; en: string }> = {
  passed: { zh: "已通过", en: "Passed" },
  failed: { zh: "失败", en: "Failed" },
  pending: { zh: "未执行", en: "Pending" },
  unverified: { zh: "证据待核对", en: "Unverified" },
  waiting: { zh: "等待审批", en: "Awaiting approval" },
  running: { zh: "进行中", en: "Running" },
  interrupted: { zh: "已停止", en: "Interrupted" },
  rolled_back: { zh: "已回滚", en: "Rolled back" },
};
export function ExecutionResultSummary({
  result,
  language = "zh-CN",
}: { result: ExecutionResult; language?: string }) {
  const lang = language === "en" ? "en" : "zh";
  return html`<section class="execution-result-summary" aria-label=${lang === "zh" ? "执行结果摘要" : "Execution result summary"}>
    <h3>${result.scope[lang]} · ${labels[result.status][lang]}</h3>
    <dl>${result.rows.map((row) => html`<div><dt>${row.label[lang]}</dt><dd data-state=${row.status}>${labels[row.status][lang]}${row.detail ? ` · ${row.detail}` : ""}</dd></div>`)}</dl>
    <p>${result.note[lang]}</p>
  </section>`;
}
