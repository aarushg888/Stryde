import type {
  LeafletScheme,
  LeafletLatLng,
  LeafletRouteLine,
} from './leaflet-types';

/**
 * Web build of the Stryde map (previously Leaflet/OSM filter tiles).
 *
 * Basemap: Esri World Imagery (keyless satellite raster) + Esri place labels
 * overlay — an Apple-Maps-satellite look that renders reliably everywhere.
 * The map is locked to Washington DC (maxBounds) so trips outside the service
 * area cannot start.
 *
 * Communication contract:
 *   -> boot state injected as window.__stryde__ (scheme/center/route(s)/markers)
 *   -> "state" postMessage updates routes/markers; "fit" recenters
 *   <- "pick" postMessage {point:[lat,lng]} on tap anywhere on the map
 */

const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const SATELLITE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const LABELS_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

const DC_BOUNDS: [[number, number], [number, number]] = [
  [38.78, -77.125], // SW corner (lat,lng)
  [39.005, -76.885], // NE corner
];

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
    emoji?: string;
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
    'html,body{height:100%;margin:0;padding:0;background:#131b21;}',
    '#map{height:100%;width:100%;background:#131b21;font-family:-apple-system,Roboto,sans-serif;}',
    '.leaflet-container{background:#131b21;}',
    '.leaflet-control-attribution{background:rgba(13,17,23,0.72);color:#9fb0c0;font-size:10px;}',
    'body.dark .leaflet-control-attribution{color:#8ea0b3;}',
    '.leaflet-popup-content-wrapper,.leaflet-popup-tip{background:#fff;border-radius:10px;}',
    '.stryde-pin{width:13px;height:13px;border-radius:50%;border:2.5px solid #ffffff;box-shadow:0 1px 5px rgba(5,12,18,0.55);}',
    '.stryde-note{width:26px;height:26px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:14px;background:#fff;border:2px solid rgba(240,190,60,0.95);box-shadow:0 1px 4px rgba(5,12,18,0.5);}',
    '</style>',
    '</head><body>',
    '<div id="map"></div>',
    '<script>window.__stryde__ = ' + boot + ';</script>',
    '<script src="' + LEAFLET_JS + '"></script>',
    '<script>',
    '(function(){',
    '  var S = window.__stryde__ || {};',
    '  function applyScheme(scheme){ document.body.classList.toggle("dark", scheme === "dark"); }',
    '  var map = L.map("map", {zoomControl:true, attributionControl:true, preferCanvas:true,',
    '    maxBounds:' + JSON.stringify(DC_BOUNDS) + ',',
    '    maxBoundsViscosity:1.0, minZoom:12, maxZoom:18.5});',
    '  L.tileLayer("' + SATELLITE_URL + '", {maxZoom:18.5, attribution:"Imagery &copy; Esri, Maxar, Earthstar Geographics"}).addTo(map);',
    '  L.tileLayer("' + LABELS_URL + '", {maxZoom:18.5, opacity:0.92, attribution:"Labels &copy; Esri"}).addTo(map);',
    '  var routeLayer = L.layerGroup().addTo(map);',
    '  var markerLayer = L.layerGroup().addTo(map);',
    '  function setRoutes(st){',
    '    routeLayer.clearLayers();',
    '    var single = st.route && st.route.length > 1 ? [{coords: st.route, color: "#22c55e", selected: true}] : null;',
    '    var lines = st.routes && st.routes.length ? st.routes : single;',
    '    if (!lines) return;',
    '    var hasAny = false;',
    '    lines.forEach(function(line){',
    '      var coords = line.coords;',
    '      if (!coords || coords.length < 2) return;',
    '      hasAny = true;',
    '      if (line.selected){',
    '        L.polyline(coords, {color:"rgba(255,255,255,0.9)", weight:8, lineCap:"round", lineJoin:"round"}).addTo(routeLayer);',
    '        L.polyline(coords, {color:line.color, weight:4.5, lineCap:"round", lineJoin:"round"}).addTo(routeLayer);',
    '      } else {',
    '        L.polyline(coords, {color:line.color, weight:3.2, opacity:0.95, lineCap:"round", lineJoin:"round"}).addTo(routeLayer);',
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
    '      if (m.emoji){',
    '        var icon = L.divIcon({className:"", html:"<div class=\'stryde-note\' title=\'" + (m.title||"") + "\'>" + m.emoji + "</div>", iconSize:[26,26], iconAnchor:[13,13]});',
    '        L.marker(m.point, {icon: icon}).addTo(markerLayer).bindPopup("<b>" + (m.title || "") + "</b>" + (m.description ? "<br>" + m.description : ""));',
    '      } else {',
    '        var icon = L.divIcon({className:"", html:"<div class=\'stryde-pin\' style=\'background:" + (m.color||"#22c55e") + "\'></div>", iconSize:[13,13], iconAnchor:[6.5,6.5]});',
    '        L.marker(m.point, {icon: icon}).addTo(markerLayer).bindPopup("<b>" + (m.title || "") + "</b>" + (m.description ? "<br>" + m.description : ""));',
    '      }',
    '    });',
    '  }',
    '  function fit(coords, pad){',
    '    if (!coords || coords.length < 2) return;',
    '    var opts = pad ? {',
    '      paddingTopLeft:[pad.left || 60, pad.top || 80],',
    '      paddingBottomRight:[pad.right || 60, pad.bottom || 80],',
    '    } : {paddingTopLeft:[70,80], paddingBottomRight:[70,90]};',
    '    map.fitBounds(L.latLngBounds(coords), opts);',
    '  }',
    '  function applyState(st){',
    '    if (!st) return;',
    '    applyScheme(st.scheme);',
    '    setRoutes(st);',
    '    setMarkers(st.markers);',
    '    if ((st.route && st.route.length > 1) || (st.routes && st.routes.length)) return;',
    '    map.setView(st.center || [38.9137, -77.0325], 14.4);',
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

export type { LeafletLatLng, LeafletRouteLine };
