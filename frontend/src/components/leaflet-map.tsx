import { forwardRef, memo, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { buildLeafletHtml, type LeafletBoot } from './leaflet-html';
import {
  type LeafletMapHandle,
  type LeafletMapProps,
} from './leaflet-types';

export type { LeafletMapHandle, LeafletMapProps } from './leaflet-types';

/**
 * Leaflet + OpenStreetMap in a react-native-webview (iOS/Android).
 *
 * Initial state is baked into the generated HTML; later changes (route found,
 * markers, theme flip) are pushed over the postMessage bridge as full state
 * snapshots, so the page never reloads mid-session.
 */
export const LeafletMap = memo(forwardRef<LeafletMapHandle, LeafletMapProps>(
  function LeafletMap(props, ref) {
    const webviewRef = useRef<WebView>(null);
    const [loaded, setLoaded] = useState(false);
    const scheme = props.scheme ?? 'light';

    const snapshot = (): LeafletBoot => ({
      scheme,
      center: props.region
        ? [props.region.latitude, props.region.longitude]
        : undefined,
      route: props.routeCoordinates ?? [],
      markers: props.markers ?? [],
    });

    // Everything before the page has loaded is already baked into the HTML.
    useEffect(() => {
      if (!loaded) return;
      const payload: LeafletBoot = {
        scheme,
        center: props.region
          ? [props.region.latitude, props.region.longitude]
          : undefined,
        route: props.routeCoordinates ?? [],
        markers: props.markers ?? [],
      };
      webviewRef.current?.postMessage(
        JSON.stringify({ type: 'state', payload }),
      );
    }, [loaded, scheme, props.region, props.routeCoordinates, props.markers]);

    useImperativeHandle(ref, () => ({
      fitToCoordinates(coords, opts) {
        if (!webviewRef.current) return;
        webviewRef.current.postMessage(JSON.stringify({
          type: 'fit',
          route: coords,
          pad: opts?.edgePadding,
        }));
      },
    }));

    return (
      <WebView
        ref={webviewRef}
        style={styles.map}
        source={{ html: buildLeafletHtml(snapshot()) }}
        originWhitelist={['*']}
        scrollEnabled={false}
        onLoadEnd={() => setLoaded(true)}
      />
    );
  },
));

const styles = StyleSheet.create({
  map: { flex: 1, width: '100%', height: '100%' },
});
