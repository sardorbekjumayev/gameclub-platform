/**
 * Xarita provayderi abstraksiyasi (docs/00-README.md §ochiq savollar #1).
 * Sahifalar faqat shu interfeys bilan ishlaydi; provayder (hozir Yandex) almashtirilsa UI o'zgarmaydi.
 */
export type LatLng = { lat: number; lng: number };
/** [g'arb, janub, sharq, shimol] — API `bbox=w,s,e,n` tartibida. */
export type BBox = [number, number, number, number];

export type MapMarker = {
  id: string;
  position: LatLng;
  label: string;
  active?: boolean;
};

export interface MapHandle {
  setMarkers(markers: MapMarker[]): void;
  setCenter(center: LatLng, zoom?: number): void;
  /** Bitta tanlanadigan pin (admin: filial joylashuvi). null — olib tashlash. */
  setPin(position: LatLng | null): void;
  /** Barcha nuqtalar ko'rinadigan qilib xaritani moslash. */
  fitTo(points: LatLng[]): void;
  getBBox(): BBox;
  destroy(): void;
}

export type MapEvents = {
  onBoundsChange?: (bbox: BBox, zoom: number) => void;
  onMarkerClick?: (id: string) => void;
  onMapClick?: (pos: LatLng) => void;
};

export interface MapProvider {
  create(container: HTMLElement, opts: { center: LatLng; zoom: number; locale: string } & MapEvents): Promise<MapHandle>;
  /** Koordinata → manzil (teskari geokodlash). */
  reverseGeocode(pos: LatLng, locale: string): Promise<string | null>;
}

export const TASHKENT: LatLng = { lat: 41.3111, lng: 69.2797 };
