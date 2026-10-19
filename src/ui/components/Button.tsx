import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, font, radius, space } from '../theme';
import { Focusable, type FocusableProps } from './Focusable';

export interface ButtonProps extends Omit<
  FocusableProps,
  'children' | 'style'
> {
  label: string;
  icon?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  compact?: boolean;
}

export function Button({
  label,
  icon,
  variant = 'secondary',
  compact,
  ...rest
}: ButtonProps) {
  return (
    <Focusable
      accessibilityRole="button"
      accessibilityLabel={label}
      {...rest}
      style={focused => [
        styles.base,
        compact && styles.compact,
        variant === 'primary' && styles.primary,
        focused && styles.focused,
        focused && variant === 'danger' && styles.dangerFocused,
        rest.disabled && styles.disabled,
      ]}
    >
      {focused => (
        <View style={styles.row}>
          {icon ? (
            <Text style={[styles.icon, focused && styles.textFocused]}>
              {icon}
            </Text>
          ) : null}
          <Text
            style={[
              styles.label,
              compact && styles.labelCompact,
              focused && styles.textFocused,
            ]}
            numberOfLines={1}
          >
            {label}
          </Text>
        </View>
      )}
    </Focusable>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.surfaceHi,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm + 2,
    borderWidth: 2,
    borderColor: 'transparent',
    marginRight: space.md,
  },
  compact: { paddingHorizontal: space.md, paddingVertical: space.xs + 2 },
  primary: { backgroundColor: colors.accentDim },
  focused: {
    backgroundColor: colors.accent,
    borderColor: colors.text,
    transform: [{ scale: 1.05 }],
  },
  dangerFocused: { backgroundColor: colors.danger },
  disabled: { opacity: 0.4 },
  row: { flexDirection: 'row', alignItems: 'center' },
  icon: { color: colors.textDim, fontSize: font.body, marginRight: space.sm },
  label: { color: colors.text, fontSize: font.body, fontWeight: '600' },
  labelCompact: { fontSize: font.small },
  textFocused: { color: colors.accentText },
});
