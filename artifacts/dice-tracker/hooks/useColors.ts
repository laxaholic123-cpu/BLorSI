import { useColorScheme } from 'react-native';
import colors from '@/constants/colors';

/**
 * Returns the design tokens for the current color scheme, merged with
 * scheme-independent values like `radius`.
 *
 * Both `light` and `dark` use the dark charcoal + amber palette so the app
 * always renders with the branded dark appearance. A future light theme can
 * replace the `light` key values in constants/colors.ts.
 */
export function useColors() {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? colors.dark : colors.light;
  return { ...palette, radius: colors.radius };
}
