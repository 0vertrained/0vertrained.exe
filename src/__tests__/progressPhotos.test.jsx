// src/__tests__/progressPhotos.test.jsx
// Progress photos in the iPhone app: by pose, newest first, kept on the
// phone; a photo opens full size and can be deleted after a second
// thought; two of a pose compare side by side, first and latest to start.
// In a browser there's nothing to show.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const photos = vi.hoisted(() => ({list: [], available: true}));

beforeEach(() => {
  photos.list = [
    { id: "a", date: "2026-08-01", pose: "front" },
    { id: "b", date: "2026-09-12", pose: "side" },
    { id: "c", date: "2026-10-24", pose: "front" },
  ];
});

vi.mock("../photos/progressPhotos", async (importOriginal) => ({
  ...(await importOriginal()),
  hasProgressPhotos: () => photos.available,
  importLegacyPhotos: vi.fn(),
  listPhotos: vi.fn(async () => ({photos: photos.list, hasLegacy: false})),
  photoSource: vi.fn(async (owner, id, size) => `data:image/jpeg;base64,${id}-${size}`),
  removePhoto: vi.fn(async (owner, id) => { photos.list = photos.list.filter((photo) => photo.id !== id); }),
  savePhoto: vi.fn(async () => ({})),
}));

import { ProgressPhotos } from "../sections/ProgressPhotos";
import { fitWithin, importLegacyPhotos, listPhotos, photoSource, removePhoto, savePhoto } from "../photos/progressPhotos";

afterEach(() => { cleanup(); photos.available = true; });

describe("fitWithin", () => {
  it("brings the longer edge down and keeps the shape", () => {
    expect(fitWithin(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
});

describe("ProgressPhotos", () => {
  it("lists a pose's photos newest first, and compares the first and latest", async () => {
    render(<ProgressPhotos owner="athlete-a" todayKey="2026-11-26" showToast={vi.fn()} />);
    const open = await screen.findAllByRole("button", { name: /^Open the front photo/ });
    expect(open.map((button) => button.getAttribute("aria-label"))).toEqual(["Open the front photo from Oct 24", "Open the front photo from Aug 1"]);
    fireEvent.click(screen.getByRole("button", { name: "Side by side" }));
    const sheet = screen.getByRole("dialog", { name: "Side by side" });
    await waitFor(() => expect(within(sheet).getAllByRole("img").map((img) => img.getAttribute("src"))).toEqual(["data:image/jpeg;base64,a-full", "data:image/jpeg;base64,c-full"]));
    expect(within(sheet).getByText("12 weeks apart")).toBeTruthy();
  });

  it("adds a photo for the chosen pose", async () => {
    const showToast = vi.fn();
    const { container } = render(<ProgressPhotos owner="athlete-a" todayKey="2026-11-26" showToast={showToast} />);
    fireEvent.click(screen.getByRole("radio", { name: "Side" }));
    await screen.findByRole("button", { name: "Add a side photo" });
    const file = new File(["x"], "me.jpg", { type: "image/jpeg" });
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Photo kept on this iPhone"));
    expect(savePhoto).toHaveBeenCalledWith("athlete-a", file, { date: "2026-11-26", pose: "side" });
  });

  it("keeps a failed deletion open for a retry and reports only successful removal", async () => {
    const showToast = vi.fn();
    vi.mocked(removePhoto).mockRejectedValueOnce(new Error("Protected file"));
    render(<ProgressPhotos owner="athlete-a" todayKey="2026-11-26" showToast={showToast} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open the front photo from Aug 1" }));
    const box = within(screen.getByRole("dialog"));
    fireEvent.click(box.getByRole("button", {name: "Delete photo"}));
    fireEvent.click(box.getByRole("button", {name: "Delete"}));
    expect(await box.findByText(/Couldn’t finish deleting/)).toBeTruthy();
    expect(showToast).not.toHaveBeenCalled();
    fireEvent.click(box.getByRole("button", {name: "Delete"}));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Photo deleted"));
  });

  it("offers a retry on a failed list read instead of reporting an empty album", async () => {
    vi.mocked(listPhotos).mockRejectedValueOnce(new Error("Index unavailable"));
    render(<ProgressPhotos owner="athlete-a" todayKey="2026-11-26" />);
    const retry = await screen.findByRole("button", {name:"Retry loading photos"});
    expect(screen.queryByText(/No front photos yet/)).toBeNull();
    fireEvent.click(retry);
    expect(await screen.findByRole("button", {name:"Open the front photo from Oct 24"})).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("clears a comparison image when its date changes and the new photo cannot be read", async () => {
    render(<ProgressPhotos owner="athlete-a" todayKey="2026-11-26" />);
    fireEvent.click(await screen.findByRole("button", {name:"Side by side"}));
    const sheet = within(screen.getByRole("dialog"));
    await waitFor(() => expect(sheet.getByRole("img", {name:"Before, Aug 1"}).getAttribute("src")).toContain("a-full"));
    vi.mocked(photoSource).mockRejectedValueOnce(new Error("Read failed"));
    fireEvent.change(sheet.getByLabelText("Before"), {target:{value:"c"}});
    expect(sheet.getByRole("img", {name:/Before, Oct 24/}).getAttribute("src")).toBeNull();
    expect(await sheet.findByRole("img", {name:"Before, Oct 24, Photo unavailable"})).toBeTruthy();
  });

  it("deletes a photo only after asking", async () => {
    const showToast = vi.fn();
    render(<ProgressPhotos owner="athlete-a" todayKey="2026-11-26" showToast={showToast} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open the front photo from Oct 24" }));
    const sheet = screen.getByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Delete photo" }));
    expect(within(sheet).getByText(/can’t be brought back/)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Photo deleted"));
    expect(removePhoto).toHaveBeenCalledWith("athlete-a", "c");
  });

  it("closes the viewer and clears thumbnails immediately when the active athlete changes", async () => {
    const view = render(<ProgressPhotos owner="athlete-a" todayKey="2026-11-26" />);
    fireEvent.click(await screen.findByRole("button", {name:"Open the front photo from Oct 24"}));
    expect(screen.getByRole("dialog")).toBeTruthy();
    vi.mocked(listPhotos).mockResolvedValueOnce({photos:[],hasLegacy:false});
    view.rerender(<ProgressPhotos owner="athlete-b" todayKey="2026-11-26"/>);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", {name:/Open the front photo/})).toBeNull();
    await screen.findByText(/No front photos yet/);
    view.rerender(<ProgressPhotos owner={null}/>);
    expect(view.container.textContent).toBe("");
  });

  it("requests legacy import only after the athlete explicitly chooses it", async () => {
    vi.mocked(listPhotos).mockResolvedValueOnce({photos:[],hasLegacy:true});
    render(<ProgressPhotos owner="athlete-a" todayKey="2026-11-26" />);
    const prompt = await screen.findByRole("button", {name:"Import older photos into this profile"});
    expect(importLegacyPhotos).not.toHaveBeenCalled();
    vi.mocked(importLegacyPhotos).mockRejectedValueOnce(new Error("Cancelled"));
    fireEvent.click(prompt);
    await screen.findByText(/Import didn’t finish/);
    fireEvent.click(prompt);
    await waitFor(()=>expect(screen.queryByRole("button", {name:prompt.textContent})).toBeNull());
    expect(importLegacyPhotos).toHaveBeenCalledWith("athlete-a");
  });

  it("shows nothing where photos can't be kept", () => {
    photos.available = false;
    const { container } = render(<ProgressPhotos owner="athlete-a" todayKey="2026-11-26" />);
    expect(container.textContent).toBe("");
  });
});
