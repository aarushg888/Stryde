import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web
 */
const emptySubscribe = () => () => {};

export function useColorScheme() {
  const colorScheme = useRNColorScheme();
  // After hydration the scheme is only available on the client; before that we
  // render 'light' so SSR/static output stays deterministic.
  const hasHydrated = useSyncExternalStore(
    emptySubscribe,
    () => colorScheme !== undefined,
    () => false,
  );

  if (hasHydrated && colorScheme) {
    return colorScheme;
  }

  return 'light';
}
