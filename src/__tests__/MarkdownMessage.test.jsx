import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemeProvider } from "../theme";
import { MarkdownMessage } from "../MarkdownMessage";

function renderMarkdown(text) {
  return renderToStaticMarkup(
    <ThemeProvider>
      <MarkdownMessage text={text} />
    </ThemeProvider>,
  );
}

describe("MarkdownMessage", () => {
  it("renders headings, emphasis, lists, and inline code", () => {
    const html = renderMarkdown(`# Recovery plan\n\n**Do this:**\n- Keep Zone 2 easy\n- Hit \`180g protein\`\n\n_Recovery still counts._`);

    expect(html).toContain("Recovery plan");
    expect(html).toContain("<strong");
    expect(html).toContain("Do this:");
    expect(html).toContain("<ul");
    expect(html).toContain("<li");
    expect(html).toContain("Keep Zone 2 easy");
    expect(html).toContain("<code");
    expect(html).toContain("180g protein");
    expect(html).toContain("<em");
  });

  it("renders ordered lists, blockquotes, and fenced code blocks", () => {
    const html = renderMarkdown(`## Tomorrow\n1. Sleep\n2. Hydrate\n\n> Conservative call.\n\n\`\`\`\nscore: 82\n\`\`\``);

    expect(html).toContain("<ol");
    expect(html).toContain("<blockquote");
    expect(html).toContain("Conservative call.");
    expect(html).toContain("<pre");
    expect(html).toContain("score: 82");
  });

  it("renders safe links", () => {
    const html = renderMarkdown("Read [the guide](https://0vertrained.netlify.app/legal/privacy-policy.html).");

    expect(html).toContain("<a");
    expect(html).toContain("href=\"https://0vertrained.netlify.app/legal/privacy-policy.html\"");
    expect(html).toContain("rel=\"noopener noreferrer\"");
  });

  it("does not render unsafe markdown links as anchors", () => {
    const html = renderMarkdown("Bad [link](javascript:alert(1)) should be plain text.");

    expect(html).not.toContain("href=\"javascript:");
    expect(html).not.toContain("<a");
    expect(html).toContain("link");
  });

  it("does not interpret raw html", () => {
    const html = renderMarkdown("<script>alert('x')</script> **safe**");

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(&#x27;x&#x27;)&lt;/script&gt;");
    expect(html).toContain("<strong");
  });
});
