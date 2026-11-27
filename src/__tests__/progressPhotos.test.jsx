// src/__tests__/progressPhotos.test.jsx
// Progress photos in the iPhone app: by pose, newest first, kept on the
// phone; a photo opens full size and can be deleted after a second
// thought; two of a pose compare side by side, first and latest to start.
// In a browser there's nothing to show.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const photos = vi.hoisted(() => ({
  list: [
    { id: "a", date: "2026-08-01", pose: "front" },
    { id: "b", date: "2026-09-12", pose: "side" },
    { id: "c", date: "2026-10-24", pose: "front" },
  ],
  available: true,
}));

vi.mock("../photos/progressPhotos", async (importOriginal) => ({
  ...(await importOriginal()),
  hasProgressPhotos: () => photos.available,
  listPhotos: vi.fn(async () => photos.list),
  photoSource: vi.fn(async (id, size) => `data:image/jpeg;base64,${id}-${size}`),
  removePhoto: vi.fn(async (id) => { photos.list = photos.list.filter((photo) => photo.id !== id); }),
  savePhoto: vi.fn(async () => ({})),
}));

import { ProgressPhotos } from "../sections/ProgressPhotos";
import { fitWithin, removePhoto, savePhoto } from "../photos/progressPhotos";

afterEach(() => { cleanup(); photos.available = true; });

describe("fitWithin", () => {
  it("brings the longer edge down and keeps the shape", () => {
    expect(fitWithin(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
});

describe("ProgressPhotos", () => {
  it("lists a pose's photos newest first, and compares the first and latest", async () => {
    render(<ProgressPhotos todayKey="2026-11-26" showToast={vi.fn()} />);
    const open = await screen.findAllByRole("button", { name: /^Open the front photo/ });
    expect(open.map((button) => button.getAttribute("aria-label"))).toEqual(["Open the front photo from Oct 24", "Open the front photo from Aug 1"]);
    fireEvent.click(screen.getByRole("button", { name: "Side by side" }));
    const sheet = screen.getByRole("dialog", { name: "Side by side" });
    await waitFor(() => expect(within(sheet).getAllByRole("img").map((img) => img.getAttribute("src"))).toEqual(["data:image/jpeg;base64,a-full", "data:image/jpeg;base64,c-full"]));
    expect(within(sheet).getByText("12 weeks apart")).toBeTruthy();
  });

  it("adds a photo for the chosen pose", async () => {
    const showToast = vi.fn();
    const { container } = render(<ProgressPhotos todayKey="2026-11-26" showToast={showToast} />);
    fireEvent.click(screen.getByRole("radio", { name: "Side" }));
    await screen.findByRole("button", { name: "Add a side photo" });
    const file = new File(["x"], "me.jpg", { type: "image/jpeg" });
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Photo kept on this iPhone"));
    expect(savePhoto).toHaveBeenCalledWith(file, { date: "2026-11-26", pose: "side" });
  });

  it("deletes a photo only after asking", async () => {
    const showToast = vi.fn();
    render(<ProgressPhotos todayKey="2026-11-26" showToast={showToast} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open the front photo from Oct 24" }));
    const sheet = screen.getByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Delete photo" }));
    expect(within(sheet).getByText(/can’t be brought back/)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Photo deleted"));
    expect(removePhoto).toHaveBeenCalledWith("c");
  });

  it("shows nothing where photos can't be kept", () => {
    photos.available = false;
    const { container } = render(<ProgressPhotos todayKey="2026-11-26" />);
    expect(container.textContent).toBe("");
  });
});
