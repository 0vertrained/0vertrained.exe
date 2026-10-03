import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/axe";
import { Wordmark } from "./Wordmark";

describe("Wordmark", () => {
  it("is one image named 0VERTRAINED with the glyphs hidden from the tree", () => {
    render(<Wordmark />);
    const mark = screen.getByRole("img", { name: "0VERTRAINED" });
    expect(mark.textContent).toBe("0VERTRAINED");
    const parts = Array.from(mark.children);
    expect(parts).toHaveLength(2);
    parts.forEach((p) => expect(p.getAttribute("aria-hidden")).toBe("true"));
    expect(parts[0]?.textContent).toBe("0");
    expect(mark.getAttribute("style")).toBeNull();
  });

  it("takes its size in px", () => {
    render(<Wordmark size={56} />);
    expect(screen.getByRole("img", { name: "0VERTRAINED" }).style.fontSize).toBe("56px");
  });

  it("has no axe violations at the landing and sign-in sizes", async () => {
    const { container } = render(
      <div>
        <Wordmark size={56} />
        <Wordmark size={28} />
      </div>,
    );
    await expectNoA11yViolations(container);
  });
});
