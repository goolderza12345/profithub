import { genericAdapter } from "./generic";
import { lazadaAdapter } from "./lazada";
import { shopeeAdapter } from "./shopee";
import { tiktokAdapter } from "./tiktok";
import type { AdapterId, ImportAdapter } from "./types";

export type { AdapterId, ImportAdapter } from "./types";

export const ADAPTERS: ImportAdapter[] = [genericAdapter, shopeeAdapter, tiktokAdapter, lazadaAdapter];

export function getAdapter(id: AdapterId): ImportAdapter {
  return ADAPTERS.find((a) => a.id === id) ?? genericAdapter;
}
