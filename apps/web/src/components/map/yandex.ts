import type { BBox, LatLng, MapHandle, MapMarker, MapProvider } from "./provider";

/* Yandex Maps JS API 2.1 — minimal tiplar (rasmiy @types yo'q). */
/* eslint-disable @typescript-eslint/no-explicit-any */
type YMaps = any;

declare global {
  interface Window {
    ymaps?: YMaps;
  }
}

const KEY = process.env.NEXT_PUBLIC_YANDEX_MAPS_KEY ?? "";
const LANG: Record<string, string> = { uz: "uz_UZ", ru: "ru_RU", en: "en_US" };

let loading: Promise<YMaps> | null = null;

function load(locale: string): Promise<YMaps> {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    if (!KEY) return reject(new Error("NEXT_PUBLIC_YANDEX_MAPS_KEY is not set"));
    const s = document.createElement("script");
    s.src = `https://api-maps.yandex.ru/2.1/?apikey=${KEY}&lang=${LANG[locale] ?? "uz_UZ"}`;
    s.async = true;
    s.onload = () => window.ymaps!.ready(() => resolve(window.ymaps));
    s.onerror = () => {
      loading = null;
      reject(new Error("Yandex Maps failed to load"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

const toLL = (p: LatLng) => [p.lat, p.lng];

export const yandexMaps: MapProvider = {
  async create(container, opts) {
    const ymaps = await load(opts.locale);
    const map = new ymaps.Map(container, { center: toLL(opts.center), zoom: opts.zoom, controls: ["zoomControl", "geolocationControl"] }, { suppressMapOpenBlock: true });

    // Narx "pill" markerlari — designn/mobile-map.html uslubida.
    const pill = ymaps.templateLayoutFactory.createClass(
      '<div class="gc-pin {% if properties.active %}gc-pin--active{% endif %}">$[properties.label]</div>',
    );
    const markers = new ymaps.GeoObjectCollection();
    map.geoObjects.add(markers);
    let pin: YMaps = null;

    const emitBounds = () => {
      const [[s, w], [n, e]] = map.getBounds();
      opts.onBoundsChange?.([w, s, e, n], map.getZoom());
    };
    map.events.add("boundschange", emitBounds);
    if (opts.onMapClick) {
      map.events.add("click", (e: YMaps) => {
        const [lat, lng] = e.get("coords");
        opts.onMapClick!({ lat, lng });
      });
    }
    setTimeout(emitBounds, 0);
    // Konteyner o'lchami o'zgarsa (responsive layout) xaritani moslash.
    const ro = new ResizeObserver(() => map.container.fitToViewport());
    ro.observe(container);

    const handle: MapHandle = {
      setMarkers(list: MapMarker[]) {
        markers.removeAll();
        for (const m of list) {
          const pm = new ymaps.Placemark(
            toLL(m.position),
            { label: m.label, active: m.active },
            { iconLayout: pill, iconShape: { type: "Rectangle", coordinates: [[-40, -16], [40, 16]] } },
          );
          pm.events.add("click", () => opts.onMarkerClick?.(m.id));
          markers.add(pm);
        }
      },
      setCenter(center, zoom) {
        map.setCenter(toLL(center), zoom ?? map.getZoom(), { duration: 300 });
      },
      setPin(position) {
        if (pin) map.geoObjects.remove(pin);
        pin = position ? new ymaps.Placemark(toLL(position), {}, { preset: "islands#circleDotIcon", iconColor: "#C6FF3D" }) : null;
        if (pin) map.geoObjects.add(pin);
      },
      fitTo(points) {
        if (points.length === 0) return;
        if (points.length === 1) return map.setCenter(toLL(points[0]), 14, { duration: 300 });
        map.setBounds(ymaps.util.bounds.fromPoints(points.map(toLL)), { checkZoomRange: true, zoomMargin: 48, duration: 300 });
      },
      getBBox(): BBox {
        const [[s, w], [n, e]] = map.getBounds();
        return [w, s, e, n];
      },
      destroy() {
        ro.disconnect();
        map.destroy();
      },
    };
    return handle;
  },

  async reverseGeocode(pos, locale) {
    const ymaps = await load(locale);
    const res = await ymaps.geocode(toLL(pos), { results: 1 });
    const first = res.geoObjects.get(0);
    return first ? (first.getAddressLine() as string) : null;
  },
};
