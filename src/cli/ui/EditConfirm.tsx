import { Box, Text } from "ink";
import React, { useMemo, useState } from "react";
import { type SplitDiffRow, formatEditBlockSplit } from "../../code/diff-preview.js";
import type { EditBlock } from "../../code/edit-blocks.js";
import { t } from "../../i18n/index.js";
import { DenyContextInput } from "./DenyContextInput.js";
import { SplitDiff } from "./SplitDiff.js";
import { ApprovalCard } from "./cards/ApprovalCard.js";
import { useKeystroke } from "./keystroke-context.js";
import { useReserveRows, useTotalRows } from "./layout/viewport-budget.js";
import { DIFF } from "./theme/tokens.js";

export type EditReviewChoice = "apply" | "reject" | "apply-rest-of-turn" | "flip-to-auto";

export interface EditConfirmProps {
  block?: EditBlock;
  blocks?: readonly EditBlock[];
  onChoose: (choice: EditReviewChoice, denyContext?: string) => void;
}

const MODAL_OVERHEAD_ROWS = 18;
const MIN_DIFF_ROWS = 8;

type ReviewRow =
  | { kind: "header"; key: string; text: string }
  | { kind: "diff"; key: string; row: SplitDiffRow };

export function EditConfirm({ block, blocks, onChoose }: EditConfirmProps) {
  const effectiveBlocks = useMemo(() => {
    if (blocks && blocks.length > 0) return [...blocks];
    return block ? [block] : [];
  }, [block, blocks]);
  const firstBlock = effectiveBlocks[0];

  const rows = useTotalRows();
  const allocated = useReserveRows("modal", {
    min: MODAL_OVERHEAD_ROWS + MIN_DIFF_ROWS,
    max: Math.max(MODAL_OVERHEAD_ROWS + MIN_DIFF_ROWS, rows - 4),
  });
  const budget = Math.max(MIN_DIFF_ROWS, allocated - MODAL_OVERHEAD_ROWS);

  const allRows = useMemo<ReviewRow[]>(() => {
    const multi = effectiveBlocks.length > 1;
    return effectiveBlocks.flatMap((b, index) => {
      const diffRows = formatEditBlockSplit(b, { contextLines: 2, maxLines: 100_000 }).map(
        (row): ReviewRow => ({
          kind: "diff",
          key: diffRowKey(b, row),
          row,
        }),
      );
      if (!multi) return diffRows;
      return [
        {
          kind: "header",
          key: `h:${b.path}:${b.search.length}:${b.replace.length}`,
          text: `${index + 1}. ${b.path}`,
        },
        ...diffRows,
      ];
    });
  }, [effectiveBlocks]);

  const [scroll, setScroll] = useState(0);
  const maxScroll = Math.max(0, allRows.length - budget);
  const effectiveScroll = Math.min(scroll, maxScroll);

  const [phase, setPhase] = useState<"review" | "context">("review");

  useKeystroke((ev) => {
    if (ev.paste) return;
    if (phase === "context") return;

    const input = ev.input;
    const key = ev;
    if (key.return || input === "y") {
      onChoose("apply");
      return;
    }
    if (input === "n") {
      setPhase("context");
      return;
    }
    if (input === "a") {
      onChoose("apply-rest-of-turn");
      return;
    }
    if (input === "A") {
      onChoose("flip-to-auto");
      return;
    }
    if (key.escape) {
      onChoose("reject");
      return;
    }
    if (key.downArrow || input === "j") {
      setScroll((s) => Math.min(maxScroll, s + 1));
      return;
    }
    if (key.upArrow || input === "k") {
      setScroll((s) => Math.max(0, s - 1));
      return;
    }
    if (key.pageDown || input === " " || input === "f") {
      setScroll((s) => Math.min(maxScroll, s + Math.max(1, budget - 2)));
      return;
    }
    if (key.pageUp || input === "b") {
      setScroll((s) => Math.max(0, s - Math.max(1, budget - 2)));
      return;
    }
    if (input === "g") {
      setScroll(0);
      return;
    }
    if (input === "G") {
      setScroll(maxScroll);
      return;
    }
  });

  if (!firstBlock) return <></>;

  const isNew = effectiveBlocks.every((b) => b.search === "");
  const removed = effectiveBlocks.reduce(
    (sum, b) => sum + (b.search === "" ? 0 : countLines(b.search)),
    0,
  );
  const added = effectiveBlocks.reduce(
    (sum, b) => sum + (b.replace === "" ? 0 : countLines(b.replace)),
    0,
  );
  const tag = isNew ? t("editConfirm.newTag") : t("editConfirm.editTag");
  const tone = isNew ? "ok" : "warn";
  const glyph = isNew ? "✚" : "✎";

  const visibleRows = allRows.slice(effectiveScroll, effectiveScroll + budget);
  const hiddenAbove = effectiveScroll;
  const hiddenBelow = Math.max(0, allRows.length - effectiveScroll - budget);
  const totalLines = allRows.length;
  const showScrollHud = hiddenAbove + hiddenBelow > 0;

  const metaParts = [t("editConfirm.linesCount", { removed, added })];
  if (showScrollHud) {
    metaParts.push(
      t("editConfirm.viewingRange", {
        start: effectiveScroll + 1,
        end: effectiveScroll + visibleRows.length,
        total: totalLines,
      }),
    );
  }

  if (phase === "context") {
    return (
      <ApprovalCard
        tone="error"
        glyph="✗"
        title={t("shellConfirm.denyTitle")}
        metaRight={t("shellConfirm.optional")}
        footerHint={t("editConfirm.denyFooter")}
      >
        <DenyContextInput
          onSubmit={(context) => onChoose("reject", context)}
          onCancel={() => setPhase("review")}
        />
      </ApprovalCard>
    );
  }

  return (
    <ApprovalCard
      tone={tone}
      glyph={glyph}
      title={
        effectiveBlocks.length === 1
          ? `${tag}  ${firstBlock.path}`
          : `${tag}  ${new Set(effectiveBlocks.map((b) => b.path)).size} files`
      }
      metaRight={metaParts.join("  ·  ")}
      footerHint={t("editConfirm.footer")}
    >
      {hiddenAbove > 0 ? (
        <Text dimColor>
          {t(hiddenAbove === 1 ? "editConfirm.linesAbove" : "editConfirm.linesAbovePlural", {
            count: hiddenAbove,
          })}
        </Text>
      ) : null}
      {visibleRows.map((row) =>
        row.kind === "header" ? (
          <Text key={row.key} bold>
            {row.text}
          </Text>
        ) : (
          <SplitDiff key={row.key} rows={[row.row]} />
        ),
      )}
      <Box>
        <Text color={DIFF.delFg} backgroundColor={DIFF.delBg}>
          {t("editConfirm.oldLabel")}
        </Text>
        <Text>{"  "}</Text>
        <Text color={DIFF.addFg} backgroundColor={DIFF.addBg}>
          {t("editConfirm.newLabel")}
        </Text>
        <Text dimColor>{t("editConfirm.sideBySide")}</Text>
      </Box>
      {hiddenBelow > 0 ? (
        <Text dimColor>
          {t(hiddenBelow === 1 ? "editConfirm.linesBelow" : "editConfirm.linesBelowPlural", {
            count: hiddenBelow,
          })}
        </Text>
      ) : null}
    </ApprovalCard>
  );
}

function countLines(text: string): number {
  return (text.match(/\n/g)?.length ?? 0) + 1;
}

function diffRowKey(block: EditBlock, row: SplitDiffRow): string {
  return [
    "d",
    block.path,
    row.left.num ?? "x",
    row.right.num ?? "x",
    row.left.kind,
    row.right.kind,
    row.left.text,
    row.right.text,
  ].join(":");
}
