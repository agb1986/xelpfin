import React, { forwardRef, useState } from 'react';
import { useIsActive } from '../../state/navigation';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors, font, radius, space } from '../theme';

interface TextFieldProps extends TextInputProps {
  label: string;
}

/** Labelled text input with the purple focus ring. SELECT opens the on-screen keyboard. */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField({ label, style, onFocus, onBlur, ...rest }, ref) {
  const [focused, setFocused] = useState(false);
  const active = useIsActive(); // see Focusable: hidden screens must not hold focus
  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, focused && styles.labelFocused]}>{label}</Text>
      <TextInput
        ref={ref}
        placeholderTextColor={colors.textDim}
        autoCapitalize="none"
        autoCorrect={false}
        focusable={active}
        {...rest}
        onFocus={e => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={e => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[styles.input, focused && styles.inputFocused, style]}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { marginBottom: space.md },
  label: { color: colors.textDim, fontSize: font.small, marginBottom: space.xs },
  labelFocused: { color: colors.accent },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: font.body,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.surfaceHi,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    minWidth: 360,
  },
  inputFocused: { borderColor: colors.accent, backgroundColor: colors.surfaceHi },
});
