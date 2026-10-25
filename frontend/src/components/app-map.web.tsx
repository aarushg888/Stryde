import { forwardRef, memo, useImperativeHandle } from 'react';
import { LeafletMap } from './leaflet-map.web';
import type {
  AppMapHandle,
  AppMapLatLng,
  AppMapProps,
} from './app-map-types';
import type { LeafletLatLng } from './leaflet-types';

/**
 * Web build of the Stryde map: delegates to the Leaflet/OSM iframe host.
 * Taps the iframe reports via postMessage surface as onPressPick, and the
 * imperative fit handle is a no-op because the page auto-fits its route.
 */
export const AppMap = memo(forwardRef<AppMapHandle, AppMapProps>(
  function AppMapWeb(props, ref) {
    useImperativeHandle(ref, () => ({
      fitToCoordinates() {
        /* the Leaflet page auto-fits the selected route on rebuild */
      },
    }));

    return (
      <LeafletMap
        scheme="dark"
        region={props.initialRegion}
        routes={(props.routes ?? []).filter((line)=>line.selected).map((line) => ({
          coords: line.coordinates.map(
            (c): LeafletLatLng => [c.latitude, c.longitude],
          ),
          color: line.color,
          selected: !!line.selected,
        }))}
        markers={(props.markers ?? []).map((m) => ({
          point: [m.coordinate.latitude, m.coordinate.longitude] as LeafletLatLng,
          color: m.color,
          title: m.title,
          description: m.description,
          variant: m.variant,
          emoji: m.emoji,
        }))}
        onPick={props.onPressPick}
      />
    );
  },
));
