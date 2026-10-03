import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface LatLon {
  lat: number;
  lon: number;
}

const OVERVIEW_M = 12000;
const DETAIL_M = 3000;

/** A square of `size` metres centred on a point, as lat/lon bounds (fine at search-area scale). */
function squareBounds(p: LatLon, size: number): L.LatLngBoundsExpression {
  const dLat = size / 2 / 111320;
  const dLon = size / 2 / (111320 * Math.cos((p.lat * Math.PI) / 180));
  return [
    [p.lat - dLat, p.lon - dLon],
    [p.lat + dLat, p.lon + dLon],
  ];
}

const pinIcon = L.divIcon({
  className: '',
  html: '<div style="width:22px;height:22px;border-radius:50%;background:#d4521c;border:3px solid #fff;box-shadow:0 0 0 1.5px #1e2420"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

/**
 * Leaflet map for choosing the last known point. Click or drag the marker to move it; the
 * 12 km overview and 3 km focus squares show what will be modelled.
 */
export function LocationMap({ point, onPick, flyKey }: { point: LatLon | null; onPick: (p: LatLon) => void; flyKey: number }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<{ marker: L.Marker; overview: L.Rectangle; detail: L.Rectangle } | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([39.5, -98.35], 4);
    const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      attribution: 'Map: © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA), © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM',
    });
    const usgs = L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 16,
      attribution: 'USGS The National Map',
    });
    const imagery = L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 16,
      attribution: 'USGS The National Map: imagery',
    });
    const streets = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    });
    topo.addTo(m);
    L.control.layers({ 'Topographic (OpenTopoMap)': topo, 'USGS topo (US)': usgs, 'USGS imagery (US)': imagery, 'Streets (OSM)': streets }, {}, { position: 'topright' }).addTo(m);
    L.control.scale({ imperial: true, metric: true, position: 'bottomleft' }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => pick.current({ lat: e.latlng.lat, lon: e.latlng.lng }));
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      layers.current = null;
    };
  }, []);

  // keep marker and squares in sync with the chosen point
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!point) {
      if (layers.current) {
        layers.current.marker.remove();
        layers.current.overview.remove();
        layers.current.detail.remove();
        layers.current = null;
      }
      return;
    }
    const ll: L.LatLngExpression = [point.lat, point.lon];
    if (!layers.current) {
      const overview = L.rectangle(squareBounds(point, OVERVIEW_M), { color: '#1e2420', weight: 1.5, dashArray: '6 5', fill: false, interactive: false }).addTo(m);
      const detail = L.rectangle(squareBounds(point, DETAIL_M), { color: '#d4521c', weight: 2.5, fillColor: '#d4521c', fillOpacity: 0.06, interactive: false }).addTo(m);
      const marker = L.marker(ll, { icon: pinIcon, draggable: true, keyboard: true, title: 'Last known point' }).addTo(m);
      marker.on('dragend', () => {
        const p = marker.getLatLng();
        pick.current({ lat: p.lat, lon: p.lng });
      });
      layers.current = { marker, overview, detail };
    } else {
      layers.current.marker.setLatLng(ll);
      layers.current.overview.setBounds(squareBounds(point, OVERVIEW_M) as L.LatLngBoundsExpression as L.LatLngBounds);
      layers.current.detail.setBounds(squareBounds(point, DETAIL_M) as L.LatLngBoundsExpression as L.LatLngBounds);
    }
  }, [point]);

  // fly to the point when a search result / typed coordinate is chosen (not on map clicks)
  useEffect(() => {
    const m = map.current;
    if (!m || !point || flyKey === 0) return;
    m.flyToBounds(squareBounds(point, OVERVIEW_M * 1.15), { duration: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 1.2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyKey]);

  return <div ref={el} className="h-full w-full" aria-label="Map: click to set the last known point" />;
}
