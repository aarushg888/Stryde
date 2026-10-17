import { forwardRef, memo, useImperativeHandle } from 'react';
import { StyleSheet } from 'react-native';
// react-native-web ships only flow types; the module shim in src/types makes
// this import typed. unstable_createElement is RNW's sanctioned way to render
// plain DOM tags like <iframe>.
import { unstable_createElement } from 'react-native-web';
import { buildLeafletHtml } from './leaflet-html';
import type { LeafletMapHandle, LeafletMapProps } from './leaflet-types';

const IFrame = unstable_createElement('iframe') as React.ComponentType<{
  title?: string;
  srcDoc?: string;
  style?: object;
}>;

/**
 * Web build of the Stryde map: the identical Leaflet/OSM page, hosted in an
 * <iframe>. The iframe rebuilds (srcDoc diff) whenever the scheme, route or
 * markers change, so the imperative fit API needed by the native WebView
 * bridge is a no-op here — every rebuild auto-fits its own route.
 */
export const LeafletMap = memo(forwardRef<LeafletMapHandle, LeafletMapProps>(
  function LeafletMapWeb(props, ref) {
    const html = buildLeafletHtml({
      scheme: props.scheme,
      center: props.region
        ? [props.region.latitude, props.region.longitude]
        : undefined,
      route: props.routeCoordinates ?? [],
      markers: props.markers ?? [],
    });

    useImperativeHandle(ref, () => ({
      fitToCoordinates() {
        /* auto-fits on rebuild */
      },
    }));

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
