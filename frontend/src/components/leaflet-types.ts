export type LeafletScheme = 'light' | 'dark';

/** [latitude, longitude] — matches the backend /search geometry rows directly. */
export type LeafletLatLng = [number, number];

export type LeafletMarkerSpec = {
  point: LeafletLatLng;
  color: string;
  title?: string;
  description?: string;
  variant?: 'pin' | 'note';
  icon?: string;
};

export type LeafletRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta?: number;
  longitudeDelta?: number;
};

export type LeafletEdgePadding = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type LeafletRouteLine = {
  coords: LeafletLatLng[];
  color: string;
  selected?: boolean;
};

export type LeafletMapProps = {
  scheme?: LeafletScheme;
  region?: LeafletRegion;
  routeCoordinates?: LeafletLatLng[];
  routes?: LeafletRouteLine[];
  markers?: LeafletMarkerSpec[];
  onPick?: (lat: number, lng: number) => void;
};

export type LeafletMapHandle = {
  fitToCoordinates(coords: LeafletLatLng[], opts?: { edgePadding?: LeafletEdgePadding }): void;
};
