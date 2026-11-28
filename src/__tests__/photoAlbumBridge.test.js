import { afterEach, expect, it, vi } from "vitest";
import { importLegacyPhotos, listPhotos, photoSource, removePhoto } from "../photos/progressPhotos";

function bridge(api) {
  vi.stubGlobal("Capacitor", {isNativePlatform:()=>true, Plugins:{OTPhotos:api}});
}
afterEach(() => vi.unstubAllGlobals());

it("uses only scoped methods and carries the athlete into each bridge operation", async () => {
  const api = {albumList:vi.fn(async()=>({version:2, photos:[], hasLegacy:true})),
    albumRead:vi.fn(async({owner})=>({data:owner})), albumRemove:vi.fn(), importLegacyAlbum:vi.fn()};
  bridge(api);
  await expect(listPhotos("one")).resolves.toEqual({photos:[],hasLegacy:true});
  await expect(photoSource("one","matching-id")).resolves.toContain("base64,one");
  await expect(photoSource("two","matching-id")).resolves.toContain("base64,two");
  await removePhoto("one","matching-id");
  expect(api.albumRemove).toHaveBeenCalledWith({owner:"one",id:"matching-id"});
  expect(api.importLegacyAlbum).not.toHaveBeenCalled();
  await importLegacyPhotos("two");
  expect(api.importLegacyAlbum).toHaveBeenCalledWith({owner:"two"});
});
it("keeps unscoped shells and signed-out sessions out of legacy albums", async () => {
  const old = {list:vi.fn(), read:vi.fn(), remove:vi.fn()};
  bridge(old);
  await expect(listPhotos("one")).rejects.toThrow(/Rebuild or update/);
  await expect(photoSource("one","id")).rejects.toThrow(/Rebuild or update/);
  await expect(removePhoto("one","id")).rejects.toThrow(/Rebuild or update/);
  await expect(listPhotos(null)).rejects.toThrow(/athlete profile/);
  expect(Object.values(old).every(method=>method.mock.calls.length === 0)).toBe(true);
});
