import { colors } from '../src/theme/colors';

test('uses the OrdboxLink brand palette', () => {
  expect(colors.navy).toBe('#172A43');
  expect(colors.red).toBe('#C6283D');
  expect(colors.background).toBe('#FAF8F2');
  expect(colors.onPrimary).toBe('#FFFFFF');
});
