/** Shared contract for the cross-platform Stryde map host component. */
export type AppMapLatLng = { latitude: number; longitude: number };

export type AppMapRouteLine = {
  coordinates: AppMapLatLng[];
  /** Stroke color for this route (matches the ROUTE_META palette). */
  color: string;
  /** The active route draws bold with a white halo. */
  selected?: boolean;
};

export type AppMapMarkerSpec = {
  coordinate: AppMapLatLng;
  color: string;
  title?: string;
  description?: string;
  /** 'pin' = start/destination marker; 'note' = small hazard badge (icon chip). */
  variant?: 'pin' | 'note';
  /** MaterialIcons glyph shown inside hazard badges (web) / custom markers (native). */
  icon?: string;
};

export type AppMapEdgePadding = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type AppMapRegion = AppMapLatLng & {
  latitudeDelta?: number;
  longitudeDelta?: number;
};

export type AppMapProps = {
  style?: object;
  initialRegion?: AppMapRegion;
  routes?: AppMapRouteLine[];
  markers?: AppMapMarkerSpec[];
  /** Tap anywhere on the map (latitude, longitude). Used for map-pick mode. */
  onPressPick?: (latitude: number, longitude: number) => void;
};

export type AppMapHandle = {
  fitToCoordinates(
    coords: AppMapLatLng[],
    opts?: { edgePadding?: AppMapEdgePadding; animated?: boolean },
  ): void;
};
