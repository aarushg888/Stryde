import { forwardRef, memo, useImperativeHandle, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, Circle } from 'react-native-maps';
import type {
  AppMapHandle,
  AppMapLatLng,
  AppMapProps,
} from './app-map-types';

/**
 * Native build of the Stryde map (react-native-maps). Draws every route:
 * the selected one gets a white halo + bold stroke, alternates stay thin.
 * Taps surface as onPressPick for the map-pick planner flow.
 */
export const AppMap = memo(forwardRef<AppMapHandle, AppMapProps>(
  function AppMapNative(props, ref) {
    const mapRef = useRef<MapView>(null);

    useImperativeHandle(ref, () => ({
      fitToCoordinates(coords: AppMapLatLng[], opts?) {
        mapRef.current?.fitToCoordinates(coords, {
          edgePadding: opts?.edgePadding,
          animated: opts?.animated ?? true,
        });
      },
    }));

    const selected = props.routes?.find((line) => line.selected);

    return (
      <MapView
        ref={mapRef}
        style={props.style}
        initialRegion={props.initialRegion as MapView['props']['initialRegion']}
        userInterfaceStyle="dark"
        pitchEnabled={false}
        rotateEnabled={false}
        showsUserLocation={false}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        onPress={({ nativeEvent }) => {
          props.onPressPick?.(
            nativeEvent.coordinate.latitude,
            nativeEvent.coordinate.longitude,
          );
        }}
      >
        {(props.routes ?? [])
          .filter((line) => !line.selected)
          .map((line, i) => (
            <Polyline
              key={`route-alt-${i}`}
              coordinates={line.coordinates}
              strokeWidth={3}
              strokeColor={line.color}
              lineCap="round"
              lineJoin="round"
            />
          ))}
        {selected && selected.coordinates.length > 1 && (
          <>
            <Polyline
              coordinates={selected.coordinates}
              strokeWidth={7}
              strokeColor="rgba(255,255,255,0.85)"
              lineCap="round"
              lineJoin="round"
            />
            <Polyline
              coordinates={selected.coordinates}
              strokeWidth={4}
              strokeColor={selected.color}
              lineCap="round"
              lineJoin="round"
            />
          </>
        )}
        {(props.markers ?? []).map((m, i) => (
          <Marker
            key={`marker-${i}`}
            coordinate={m.coordinate}
            title={m.title}
            description={m.description}
            anchor={m.variant === 'note' ? { x: 0.5, y: 0.5 } : undefined}
          >
            {m.variant === 'note' ? (
              <View style={[styles.noteBadge, { borderColor: m.color }]}>
                <Text style={styles.noteEmoji}>{m.emoji ?? '⚠️'}</Text>
              </View>
            ) : null}
          </Marker>
        ))}
      </MapView>
    );
  },
));

const styles = StyleSheet.create({
  noteBadge: {
    width: 27,
    height: 27,
    borderRadius: 9,
    backgroundColor: '#ffffff',
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0a141e',
    shadowOpacity: 0.4,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  noteEmoji: { fontSize: 15 },
});
