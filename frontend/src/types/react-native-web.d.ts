/**
 * react-native-web 0.21 publishes only .flow types, so TS projects need a
 * minimal ambient module for the few exports the app touches.
 */
declare module 'react-native-web' {
  export function unstable_createElement(
    type: string,
    props?: Record<string, unknown> | null,
    ...children: unknown[]
  ): React.ComponentType<any>;
}
