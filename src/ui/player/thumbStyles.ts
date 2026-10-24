import { StyleSheet } from 'react-native';
import { colors, font, radius, space } from '../theme';

/** Card width in the scene navigator and the episode reel; the navigator scrolls by it. */
export const THUMB_CARD_WIDTH = 200;

/** Cards shared by the scene navigator and the episode reel. */
export const thumbStyles = StyleSheet.create({
  card: {
    width: THUMB_CARD_WIDTH,
    marginRight: space.sm,
    padding: space.xs,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  cardFocused: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceHi,
  },
  image: {
    width: 192,
    height: 108,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  time: {
    color: colors.text,
    fontSize: font.small,
    fontWeight: '700',
    marginTop: space.xs,
  },
  name: { color: colors.textDim, fontSize: font.small },
});
