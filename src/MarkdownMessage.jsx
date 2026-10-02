import { Fragment } from "react";
import { useTheme } from "./theme";

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

// Coach replies are model-generated Markdown. Keep links whitelist-only and never
// render raw HTML; React escapes all text nodes by default.
function isSafeHref(href) {
  if (typeof href !== "string") return false;
  const trimmed = href.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return true;
  if (trimmed.startsWith("#")) return true;
  try {
    const url = new URL(trimmed, "https://0vertrained.netlify.app");
    return SAFE_LINK_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}

function splitInlineMarkdown(text) {
  const tokens = [];
  let i = 0;
  const src = String(text ?? "");

  while (i < src.length) {
    const rest = src.slice(i);

    const code = rest.match(/^`([^`]+)`/);
    if (code) {
      tokens.push({ type: "code", text: code[1] });
      i += code[0].length;
      continue;
    }

    const link = rest.match(/^\[([^\]\n]+)\]\(([^\s)]+)\)/);
    if (link) {
      tokens.push({ type: "link", text: link[1], href: link[2] });
      i += link[0].length;
      continue;
    }

    const bold = rest.match(/^\*\*([^*]+)\*\*/);
    if (bold) {
      tokens.push({ type: "bold", text: bold[1] });
      i += bold[0].length;
      continue;
    }

    const italic = rest.match(/^_([^_]+)_/);
    if (italic) {
      tokens.push({ type: "italic", text: italic[1] });
      i += italic[0].length;
      continue;
    }

    const nextSpecial = rest.slice(1).search(/[`[]|\*\*|_/);
    const end = nextSpecial === -1 ? src.length : i + 1 + nextSpecial;
    tokens.push({ type: "text", text: src.slice(i, end) });
    i = end;
  }

  return tokens;
}

export function renderInlineMarkdown(text, C, S) {
  return splitInlineMarkdown(text).map((token, idx) => {
    if (token.type === "bold") return <strong key={idx} style={{ color: C.text, fontWeight: 700 }}>{token.text}</strong>;
    if (token.type === "italic") return <em key={idx}>{token.text}</em>;
    if (token.type === "code") {
      return (
        <code key={idx} style={{
          fontFamily: C.monoFamily || S.fontMono || C.fontFamily,
          fontSize: "0.92em",
          padding: "1px 4px",
          border: `1px solid ${C.line}`,
          background: C.bg,
          color: C.text,
        }}>
          {token.text}
        </code>
      );
    }
    if (token.type === "link") {
      if (!isSafeHref(token.href)) return <Fragment key={idx}>{token.text}</Fragment>;
      return (
        <a
          key={idx}
          href={token.href.trim()}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: C.text, textDecoration: "underline", textUnderlineOffset: 3 }}
        >
          {token.text}
        </a>
      );
    }
    return <Fragment key={idx}>{token.text}</Fragment>;
  });
}

function parseMarkdownBlocks(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = null;
  let quote = [];
  let code = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ type: "paragraph", text: paragraph.join(" ").trim() });
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push(list);
    list = null;
  };
  const flushQuote = () => {
    if (!quote.length) return;
    blocks.push({ type: "quote", text: quote.join(" ").trim() });
    quote = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (code) {
      if (line.trim().startsWith("```")) {
        blocks.push(code);
        code = null;
      } else {
        code.text.push(raw.replace(/\s+$/, ""));
      }
      continue;
    }

    if (line.trim().startsWith("```")) {
      flushParagraph(); flushList(); flushQuote();
      code = { type: "codeBlock", text: [] };
      continue;
    }

    if (!line.trim()) {
      flushParagraph(); flushList(); flushQuote();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph(); flushList(); flushQuote();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() });
      continue;
    }

    const unordered = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph(); flushQuote();
      const kind = unordered ? "ul" : "ol";
      if (!list || list.kind !== kind) flushList();
      if (!list) list = { type: "list", kind, items: [] };
      list.items.push((unordered || ordered)[1].trim());
      continue;
    }

    const blockquote = line.match(/^>\s?(.+)$/);
    if (blockquote) {
      flushParagraph(); flushList();
      quote.push(blockquote[1].trim());
      continue;
    }

    flushList(); flushQuote();
    paragraph.push(line.trim());
  }

  flushParagraph(); flushList(); flushQuote();
  if (code) blocks.push(code);
  return blocks;
}

export function MarkdownMessage({ text }) {
  const { C, S } = useTheme();
  const blocks = parseMarkdownBlocks(text);
  if (!blocks.length) return null;

  const paragraphStyle = { margin: "0 0 8px", lineHeight: 1.55 };
  const listStyle = { margin: "0 0 9px 16px", padding: 0, lineHeight: 1.55 };

  return (
    <div style={{ whiteSpace: "normal" }}>
      {blocks.map((block, idx) => {
        if (block.type === "heading") {
          const size = block.level === 1 ? 14 : block.level === 2 ? 13 : 12;
          return (
            <div key={idx} style={{
              margin: idx === 0 ? "0 0 7px" : "12px 0 7px",
              fontFamily: S.fontSerif || C.serifFamily || C.fontFamily,
              fontSize: size,
              fontWeight: 600,
              lineHeight: 1.25,
              color: C.text,
            }}>
              {renderInlineMarkdown(block.text, C, S)}
            </div>
          );
        }
        if (block.type === "list") {
          const Tag = block.kind;
          return (
            <Tag key={idx} style={listStyle}>
              {block.items.map((item, itemIdx) => (
                <li key={itemIdx} style={{ marginBottom: 4, paddingLeft: 2 }}>
                  {renderInlineMarkdown(item, C, S)}
                </li>
              ))}
            </Tag>
          );
        }
        if (block.type === "quote") {
          return (
            <blockquote key={idx} style={{
              margin: "0 0 9px",
              padding: "0 0 0 10px",
              borderLeft: `2px solid ${C.lineBright}`,
              color: C.textDim,
              lineHeight: 1.55,
            }}>
              {renderInlineMarkdown(block.text, C, S)}
            </blockquote>
          );
        }
        if (block.type === "codeBlock") {
          return (
            <pre key={idx} style={{
              margin: "0 0 9px",
              padding: "8px 9px",
              overflowX: "auto",
              border: `1px solid ${C.line}`,
              background: C.bg,
              color: C.text,
              fontFamily: C.monoFamily || S.fontMono || C.fontFamily,
              fontSize: 13,
              lineHeight: 1.45,
              whiteSpace: "pre-wrap",
            }}><code>{block.text.join("\n")}</code></pre>
          );
        }
        return (
          <p key={idx} style={idx === blocks.length - 1 ? { ...paragraphStyle, marginBottom: 0 } : paragraphStyle}>
            {renderInlineMarkdown(block.text, C, S)}
          </p>
        );
      })}
    </div>
  );
}

export default MarkdownMessage;
