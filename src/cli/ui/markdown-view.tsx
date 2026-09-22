import { Box, Text, Transform } from "ink";
// biome-ignore lint/style/useImportType: tsconfig jsx=react needs React in value scope for JSX compilation
import React from "react";
import { type InlineSpan, type MdLine, markdownToLines } from "./markdown-lines.js";
import { GLYPH } from "./theme.js";
import { FG, SURFACE, TONE } from "./theme/tokens.js";

export function MarkdownView({ text }: { text: string }): React.ReactElement {
  return <MarkdownLines lines={markdownToLines(text)} />;
}

export function MarkdownLines({
  lines,
}: {
  lines: ReadonlyArray<MdLine>;
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <LineRow key={`md-${i}-${line.kind}`} line={line} />
      ))}
    </Box>
  );
}

function LineRow({ line }: { line: MdLine }): React.ReactElement | null {
  switch (line.kind) {
    case "blank":
      return <Text> </Text>;
    case "hr":
      return <Text color={FG.meta}>──────</Text>;
    case "heading":
      return (
        <Box>
          <Text bold color={FG.strong}>
            {`${"#".repeat(line.level)} `}
          </Text>
          <Spans spans={line.spans} bold strongColor />
        </Box>
      );
    case "paragraph":
      return (
        <Box>
          <Spans spans={line.spans} />
        </Box>
      );
    case "list": {
      const indent = " ".repeat(line.depth * 2);
      const marker =
        line.task === "done"
          ? GLYPH.todoDone
          : line.task === "todo"
            ? GLYPH.todoOpen
            : line.ordered
              ? `${line.index}.`
              : "·";
      const markerColor = line.task === "done" ? TONE.ok : line.task === "todo" ? FG.meta : FG.sub;
      return (
        <Box>
          <Text color={markerColor}>{`${indent}${marker} `}</Text>
          <Spans spans={line.spans} dim={line.task === "done"} strike={line.task === "done"} />
        </Box>
      );
    }
    case "code":
      return <CodeBlock lang={line.lang} text={line.text} />;
    case "blockquote":
      return (
        <Box>
          <Text color={TONE.brand}>{"▎ "}</Text>
          <Spans spans={line.spans} italic />
        </Box>
      );
  }
}

function spanKey(span: InlineSpan, i: number): string {
  return `${i}-${span.text.length}-${span.bold ? "b" : ""}${span.italic ? "i" : ""}${span.code ? "c" : ""}${span.strike ? "s" : ""}${span.link ? "l" : ""}`;
}

function CodeBlock({ lang, text }: { lang: string; text: string }): React.ReactElement {
  const lines = text.split("\n");
  return (
    <Box flexDirection="column">
      {lang.length > 0 ? <Text color={FG.sub}>{` ${lang}`}</Text> : null}
      {lines.map((ln, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: code lines are positional + stable per render
        <Text key={`code-${i}`} backgroundColor={SURFACE.bgElev}>
          {` ${ln} `}
        </Text>
      ))}
    </Box>
  );
}

interface SpansProps {
  readonly spans: ReadonlyArray<InlineSpan>;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly dim?: boolean;
  readonly strike?: boolean;
  readonly strongColor?: boolean;
}

function Spans({ spans, bold, italic, dim, strike, strongColor }: SpansProps): React.ReactElement {
  if (spans.length === 0) return <Text> </Text>;
  return (
    <>
      {spans.map((span, i) => (
        <SpanText
          key={spanKey(span, i)}
          span={span}
          ambientBold={bold}
          ambientItalic={italic}
          ambientDim={dim}
          ambientStrike={strike}
          strongColor={strongColor}
        />
      ))}
    </>
  );
}

function SpanText({
  span,
  ambientBold,
  ambientItalic,
  ambientDim,
  ambientStrike,
  strongColor,
}: {
  span: InlineSpan;
  ambientBold?: boolean;
  ambientItalic?: boolean;
  ambientDim?: boolean;
  ambientStrike?: boolean;
  strongColor?: boolean;
}): React.ReactElement {
  if (span.code) {
    return (
      <Text color={FG.strong} backgroundColor={SURFACE.bgElev}>
        {` ${span.text} `}
      </Text>
    );
  }
  const color = span.fileRef
    ? TONE.brand
    : span.link
      ? TONE.brand
      : strongColor
        ? FG.strong
        : FG.body;
  const inner = (
    <Text
      color={color}
      bold={!!(span.bold || ambientBold)}
      italic={!!(span.italic || ambientItalic)}
      dimColor={!!ambientDim}
      strikethrough={!!(span.strike || ambientStrike)}
      underline={!!(span.link || span.fileRef)}
    >
      {span.text}
    </Text>
  );
  const target = linkTarget(span);
  if (!target) return inner;
  return (
    <Transform transform={(text) => `\x1b]8;;${target}\x1b\\${text}\x1b]8;;\x1b\\`}>
      {inner}
    </Transform>
  );
}

function linkTarget(span: InlineSpan): string | null {
  if (span.link) return span.link;
  if (span.fileRef) {
    const { path, line } = span.fileRef;
    return line ? `file://${path}:${line}` : `file://${path}`;
  }
  return null;
}
