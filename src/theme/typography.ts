import { TextStyle } from 'react-native';

export const typography: Record<string, TextStyle> = {
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  heading: { fontSize: 22, fontWeight: '800' },
  body: { fontSize: 16, lineHeight: 24 },
  caption: { fontSize: 13, lineHeight: 18 },
};
