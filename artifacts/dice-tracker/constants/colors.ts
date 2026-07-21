/**
 * Design tokens for Bad Luck or Skill Issue?
 *
 * Visual identity: premium tabletop electronics — dark charcoal surfaces,
 * warm amber/gold accents, high contrast, tactile feel.
 *
 * Both light and dark keys use the same dark theme so the app always renders
 * in the charcoal+amber palette regardless of system appearance setting.
 * A future light theme can replace the `light` key values (Phase 6).
 */

const palette = {
  // Surfaces
  background: '#141414',
  card: '#1E1E1E',
  secondary: '#252525',
  muted: '#252525',
  border: '#2E2E2E',
  input: '#252525',

  // Text
  foreground: '#F0F0F0',
  mutedForeground: '#888888',

  // Amber / gold accent
  primary: '#F5A623',
  primaryForeground: '#141414',
  accent: '#E8960A',
  accentForeground: '#141414',

  // Card text inherits foreground
  cardForeground: '#F0F0F0',
  secondaryForeground: '#F0F0F0',
  accentForegroundAlt: '#1a1a1a',

  // Destructive
  destructive: '#E53E3E',
  destructiveForeground: '#ffffff',

  // Legacy aliases
  text: '#F0F0F0',
  tint: '#F5A623',
};

const colors = {
  light: palette,
  dark: palette,
  /** Border radius in px — applied to cards, buttons, inputs, and modals */
  radius: 12,
};

export default colors;
