/**
 * Design tokens for Skill Check
 *
 * Visual identity: premium dark surfaces with jewel-tone teal accents.
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

  // Teal / jewel-tone accent
  primary: '#1ABC9C',
  primaryForeground: '#FFFFFF',
  accent: '#16A085',
  accentForeground: '#FFFFFF',

  // Card text
  cardForeground: '#F0F0F0',
  secondaryForeground: '#F0F0F0',

  // Destructive
  destructive: '#E53E3E',
  destructiveForeground: '#ffffff',

  // Legacy aliases
  text: '#F0F0F0',
  tint: '#1ABC9C',
};

const colors = {
  light: palette,
  dark: palette,
  radius: 12,
};

export default colors;
