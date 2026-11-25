import { useAppStore } from '../store/appStore';

const paletteTokens = {
  savanna: {
    label: 'Safari Pop',
    colors: {
      navy: '#172A43',
      red: '#C6283D',
      background: '#FAF8F2',
      text: '#192A3E',
      onPrimary: '#FFFFFF',
      softRed: '#F6E5E8',
      softSurface: '#F1EEE7',
      muted: '#6D737C',
      border: '#DAD8D0',
      surface: '#FFFFFF',
    },
    swatches: ['#172A43', '#C6283D', '#D6A94D'],
  },
  baobab: {
    label: 'Sunset Glow',
    colors: {
      navy: '#40235F',
      red: '#F05B7C',
      background: '#FAF4FF',
      text: '#30203F',
      onPrimary: '#FFFFFF',
      softRed: '#FBE2EC',
      softSurface: '#F0E7F7',
      muted: '#776987',
      border: '#E4D8EF',
      surface: '#FFFCFF',
    },
    swatches: ['#40235F', '#F05B7C', '#FFBE55'],
  },
  ocean: {
    label: 'Mint Wave',
    colors: {
      navy: '#123D4A',
      red: '#12A98F',
      background: '#F0FFFC',
      text: '#153943',
      onPrimary: '#FFFFFF',
      softRed: '#DDF8F1',
      softSurface: '#E5F5F1',
      muted: '#66817F',
      border: '#D2E8E2',
      surface: '#FFFFFF',
    },
    swatches: ['#123D4A', '#12A98F', '#62DCC7'],
  },
  clay: {
    label: 'Berry Pop',
    colors: {
      navy: '#3B1A53',
      red: '#E84F9C',
      background: '#FFF5FA',
      text: '#381E42',
      onPrimary: '#FFFFFF',
      softRed: '#FCE3F1',
      softSurface: '#F6E9F1',
      muted: '#876B81',
      border: '#ECD8E6',
      surface: '#FFFDFF',
    },
    swatches: ['#3B1A53', '#E84F9C', '#FC915F'],
  },
  monochrome: {
    label: 'Black & White',
    colors: {
      navy: '#222222',
      red: '#4A4A4A',
      background: '#F5F5F5',
      text: '#202020',
      onPrimary: '#FFFFFF',
      softRed: '#E8E8E8',
      softSurface: '#EEEEEE',
      muted: '#696969',
      border: '#D5D5D5',
      surface: '#FFFFFF',
    },
    swatches: ['#222222', '#FFFFFF', '#BDBDBD'],
  },
  rose: {
    label: 'Petal Plum',
    colors: {
      navy: '#4A2362',
      red: '#D94691',
      background: '#FFF8FC',
      text: '#37213E',
      onPrimary: '#FFFFFF',
      softRed: '#FCE4F0',
      softSurface: '#F1EAF4',
      muted: '#806D87',
      border: '#E9D9E9',
      surface: '#FFFFFF',
    },
    swatches: ['#4A2362', '#D94691', '#FFFFFF'],
  },
  orchid: {
    label: 'Orchid Pop',
    colors: {
      navy: '#54248A',
      red: '#D83C9C',
      background: '#FCF7FF',
      text: '#32194A',
      onPrimary: '#FFFFFF',
      softRed: '#F8E3F3',
      softSurface: '#EEE5F6',
      muted: '#786788',
      border: '#E4D8EE',
      surface: '#FFFDFF',
    },
    swatches: ['#54248A', '#D83C9C', '#F3D9FF'],
  },
  sky: {
    label: 'Sky Mist',
    colors: {
      navy: '#244E75',
      red: '#3296D0',
      background: '#F4F9FD',
      text: '#22394D',
      onPrimary: '#FFFFFF',
      softRed: '#DFF1FB',
      softSurface: '#E9EFF4',
      muted: '#687C8D',
      border: '#D6E2EB',
      surface: '#FFFFFF',
    },
    swatches: ['#244E75', '#3296D0', '#DDE3E8'],
  },
  lime: {
    label: 'Lime Grove',
    colors: {
      navy: '#205334',
      red: '#79B82A',
      background: '#F6FAF1',
      text: '#263B2C',
      onPrimary: '#FFFFFF',
      softRed: '#E9F4D8',
      softSurface: '#EDF3E7',
      muted: '#6D7B68',
      border: '#D8E4D0',
      surface: '#FFFFFF',
    },
    swatches: ['#205334', '#79B82A', '#F1F4E8'],
  },
  earth: {
    label: 'Cocoa Sand',
    colors: {
      navy: '#5A3D2B',
      red: '#A46D43',
      background: '#FAF7F1',
      text: '#403128',
      onPrimary: '#FFFFFF',
      softRed: '#F1E5D7',
      softSurface: '#F0E9DF',
      muted: '#817467',
      border: '#E3D8C9',
      surface: '#FFFDF9',
    },
    swatches: ['#5A3D2B', '#A46D43', '#E9DDC8'],
  },
} as const;

export type ThemePaletteId = keyof typeof paletteTokens;
export type AppColors = { [Key in keyof (typeof paletteTokens)['savanna']['colors']]: string };

export const themePalettes = Object.entries(paletteTokens).map(([id, palette]) => ({
  id: id as ThemePaletteId,
  label: palette.label,
  swatches: palette.swatches,
}));

export const colors: AppColors = paletteTokens.savanna.colors;

export function useAppColors(): AppColors {
  const themePalette = useAppStore((state) => state.themePalette);
  return paletteTokens[themePalette as ThemePaletteId]?.colors ?? paletteTokens.savanna.colors;
}
