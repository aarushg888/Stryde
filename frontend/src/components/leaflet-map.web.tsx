import { forwardRef, memo, useEffect, useImperativeHandle } from 'react';
import { StyleSheet } from 'react-native';
import { buildLeafletHtml } from './leaflet-html';
import type { LeafletMapHandle, LeafletMapProps } from './leaflet-types';

// Plain DOM iframe rendered through react-dom; typed as a component so JSX
// stays declarative.
const IFrame = 'iframe' as unknown as React.ComponentType<{
  title?: string;
  srcDoc?: string;
  style?: object;
}>;

/**
 * Web build of the Stryde map: the identical Leaflet/OSM page, hosted in an
 * <iframe>. The iframe rebuilds (srcDoc diff) whenever the scheme, routes or
 * markers change, so the imperative fit API needed by the native WebView
 * bridge is a no-op here — every rebuild auto-fits its own route.
 *
 * Map clicks arrive as {type:'pick', point:[lat,lng]} postMessages from the
 * iframe (same-origin srcDoc) and are surfaced as onPick.
 */
export const LeafletMap = memo(forwardRef<LeafletMapHandle, LeafletMapProps>(
  function LeafletMapWeb(props, ref) {
    const html = buildLeafletHtml({
      scheme: props.scheme,
      center: props.region
        ? [props.region.latitude, props.region.longitude]
        : undefined,
      route: props.routeCoordinates ?? [],
      routes: props.routes ?? [],
      markers: props.markers ?? [],
    });

    useImperativeHandle(ref, () => ({
      fitToCoordinates() {
        /* auto-fits on rebuild */
      },
    }));

    useEffect(function listenForPick() {
      function onMsg(ev: MessageEvent) {
        if (!ev.data || typeof ev.data !== 'object') return;
        if (ev.data.type === 'pick' && Array.isArray(ev.data.point)) {
          props.onPick?.(ev.data.point[0], ev.data.point[1]);
        }
      }
      window.addEventListener('message', onMsg);
      return () => window.removeEventListener('message', onMsg);
    }, [props.onPick]);

    return (
      <IFrame
        title="Stryde route map"
        srcDoc={html}
        style={styles.frame}
      />
    );
  },
));

const styles = StyleSheet.create({
  frame: { flex: 1, width: '100%', height: '100%', borderWidth: 0 },
});
