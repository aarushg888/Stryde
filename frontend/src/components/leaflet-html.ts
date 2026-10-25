/**
 * The Leaflet/OSM document that powers Stryde's map, generated once as a
 * string so both hosts (native react-native-webview, web <iframe>) render the
 * identical page from the same source.
 *
 * Contract with hosts:
 *  - initial paint is driven by `window.__stryde__` embedded at build time;
 *  - runtime updates arrive from the host as postMessage JSON
 *    ({type:'state',payload:State}) or ({type:'fit',coords,pad});
 *  - the page listens to BOTH 'message' windows events because the react-
 *    native-webview bridge emits on `window` (Android) and `document` (iOS).
 *
 * Tiles: standard OpenStreetMap raster tiles, dark mode done in-CSS
 * (invert+hue-rotate) so a single tile source and single attribution cover
 * both schemes.
 */
import type { LeafletScheme } from './leaflet-types';

const TILE_URL = 'https://maps.wikimedia.org/osm-intl/{z}/{x}/{y}.png';
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';

export type LeafletBoot = {
  scheme?: LeafletScheme;
  center?: [number, number];
  route?: [number, number][]; // [lat,lng] polyline vertices (single route)
  routes?: {
    coords: [number, number][];
    color: string;
    selected?: boolean;
  }[]; // multi-route rendering (selected draws haloed & bold)
  markers?: {
    point: [number, number]; // [lat,lng]
    color: string;
    title?: string;
    description?: string;
  }[];
};

export function buildLeafletHtml(state: LeafletBoot): string {
  const boot = JSON.stringify(state ?? {}).replace(/</g, '\\u003c');
  return [
    '<!DOCTYPE html><html><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">',
    '<link rel="stylesheet" href="' + LEAFLET_CSS + '">',
    '<style>',
    'html,body{height:100%;margin:0;padding:0;}',
    '#map{height:100%;background:#0b0f14;font-family:-apple-system,Roboto,sans-serif;}',
    '/* Wikimedia raster tiles get Stryde night mode via a tuned CSS filter */',
    'body.dark .leaflet-tile{filter:brightness(0.62) invert(1) contrast(2.4) hue-rotate(196deg) saturate(0.32) brightness(0.82);}',
    'body.dark .leaflet-control-attribution{background:rgba(13,17,23,0.75);color:#8fa0b3;}',
    '.leaflet-popup-content-wrapper,.leaflet-popup-tip{background:#fff;border-radius:10px;}',
    '</style>',
    '</head><body>',
    '<div id="map"></div>',
    '<script>window.__stryde__ = ' + boot + ';</script>',
    '<script src="' + LEAFLET_JS + '"></script>',
    '<script>',
    '(function(){',
    '  var S = window.__stryde__ || {};',
    '  var map = L.map("map", {zoomControl:true, attributionControl:true, preferCanvas:true});',
    '  L.tileLayer("' + TILE_URL + '", {maxZoom:19, attribution:"&copy; OpenStreetMap contributors, tiles &copy; Wikimedia"}).addTo(map);',
    '  var routeLayer = L.layerGroup().addTo(map);',
    '  var markerLayer = L.layerGroup().addTo(map);',
    '  function isDark(){ return document.body.classList.contains("dark"); }',
    '  function applyScheme(scheme){ document.body.classList.toggle("dark", scheme === "dark"); }',
    '  function setRoutes(st){',
    '    routeLayer.clearLayers();',
    '    var single = st.route && st.route.length > 1 ? [{coords: st.route, color: isDark() ? "#2ecc71" : "#27ae60", selected: true}] : null;',
    '    var lines = st.routes && st.routes.length ? st.routes : single;',
    '    if (!lines) return;',
    '    var hasAny = false;',
    '    lines.forEach(function(line){',
    '      var coords = line.coords;',
    '      if (!coords || coords.length < 2) return;',
    '      hasAny = true;',
    '      if (line.selected){',
    '        L.polyline(coords, {color:"rgba(255,255,255,0.85)", weight:7, lineCap:"round", lineJoin:"round"}).addTo(routeLayer);',
    '        L.polyline(coords, {color:line.color, weight:4, lineCap:"round", lineJoin:"round"}).addTo(routeLayer);',
    '      } else {',
    '        L.polyline(coords, {color:line.color, weight:3, opacity:0.85, lineCap:"round", lineJoin:"round"}).addTo(routeLayer);',
    '      }',
    '    });',
    '    if (hasAny){',
    '      var fitTo = st.routes && st.routes.length ? (lines.filter(function(l){return l.selected;})[0] || lines[0]).coords : st.route;',
    '      fit(fitTo);',
    '    }',
    '  }',
    '  function setMarkers(markers){',
    '    markerLayer.clearLayers();',
    '    (markers || []).forEach(function(m){',
    '      L.circleMarker(m.point, {radius:8, color:"#ffffff", weight:2, fillColor:m.color, fillOpacity:1})',
    '        .addTo(markerLayer)',
    '        .bindPopup("<b>" + (m.title || "") + "</b>" + (m.description ? "<br>" + m.description : ""));',
    '    });',
    '  }',
    '  function fit(coords, pad){',
    '    if (!coords || coords.length < 2) return;',
    '    var opts = pad ? {',
    '      paddingTopLeft:[pad.left || 60, pad.top || 80],',
    '      paddingBottomRight:[pad.right || 60, pad.bottom || 80],',
    '    } : {};',
    '    map.fitBounds(L.latLngBounds(coords), opts);',
    '  }',
    '  function applyState(st){',
    '    if (!st) return;',
    '    applyScheme(st.scheme);',
    '    setRoutes(st);',
    '    setMarkers(st.markers);',
    '    if ((st.route && st.route.length > 1) || (st.routes && st.routes.length)) return;',
    '    map.setView(st.center || [38.9137, -77.0325], 15);',
    '  }',
    '  map.on("click", function(ev){',
    '    try{',
    '      if (window.parent){',
    '        window.parent.postMessage({type:"pick", point:[ev.latlng.lat, ev.latlng.lng]}, "*");',
    '      }',
    '    } catch (err) {}',
    '  });',
    '  function onMsg(ev){',
    '    try{',
    '      var msg = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;',
    '      if (!msg || !msg.type) return;',
    '      if (msg.type === "state") applyState(msg.payload);',
    '      else if (msg.type === "fit") fit(msg.route, msg.pad);',
    '    } catch (err) {}',
    '  }',
    '  applyState(S);',
    '  window.addEventListener("message", onMsg);',
    '  document.addEventListener("message", onMsg);',
    '})();',
    '</script>',
    '</body></html>',
  ].join('\n');
}
