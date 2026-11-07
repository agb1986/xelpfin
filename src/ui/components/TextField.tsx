import React, {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useScreenState } from '../../state/navigation';
import {
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { colors, font, radius, space } from '../theme';

// Vega opens the keyboard on every focus the field gets while showSoftInputOnFocus is on, D-pad
// moves included, and the remote then drives the keyboard until BACK. There the keyboard is
// enabled only for a SELECT press.
const KEYBOARD_ON_SELECT_ONLY = (Platform.OS as string) === 'kepler';

interface TextFieldProps extends TextInputProps {
  label: string;
}

/** Labelled text input with the purple focus ring. SELECT opens the on-screen keyboard. */
export const TextField = forwardRef<TextInput, TextFieldProps>(
  function TextField(
    { label, style, onFocus, onBlur, onPress, hasTVPreferredFocus, ...rest },
    ref,
  ) {
    const [focused, setFocused] = useState(false);
    // See Focusable: hidden screens must not hold focus.
    const { active, lastFocused } = useScreenState();
    const inner = useRef<TextInput | null>(null);
    const hasFocus = useRef(false);
    const setRef = useCallback(
      (node: TextInput | null) => {
        inner.current = node;
        if (typeof ref === 'function') {
          ref(node);
        } else if (ref) {
          ref.current = node;
        }
      },
      [ref],
    );
    // Preferred focus only applies until something else on the screen has had focus: on return
    // to the screen, Focusable restores the remembered element, and the field must not take
    // focus back from it.
    const wantsFocus = !!hasTVPreferredFocus && active && !lastFocused.current;
    // Keep the keyboard closed while the field takes initial focus programmatically; SELECT
    // opens it afterwards, as for any other focus.
    const [quiet, setQuiet] = useState(wantsFocus);
    // The preferred-focus flag is only read when the native view is created, which is while the
    // screen below it still holds focus, and TextInput has no requestTVFocus. Focus it directly,
    // retrying for a few frames until it has focus. On Vega, focus() logs a deprecation warning
    // that points at requestTVFocus, but Vega's TextInput does not have that method either.
    useEffect(() => {
      if (!wantsFocus) {
        return;
      }
      let tries = 0;
      let t: ReturnType<typeof setTimeout>;
      const attempt = () => {
        if (hasFocus.current || !inner.current || tries++ >= 10) {
          return;
        }
        inner.current.focus();
        t = setTimeout(attempt, 100);
      };
      t = setTimeout(attempt, 0);
      return () => clearTimeout(t);
    }, [wantsFocus]);
    // Vega: SELECT enables the keyboard, which only opens on a focus() made after the change
    // has reached the native view. TextInput's own focus() on press runs before that.
    const [keyboard, setKeyboard] = useState(false);
    useEffect(() => {
      if (keyboard && hasFocus.current) {
        inner.current?.focus();
      }
    }, [keyboard]);
    return (
      <View style={styles.wrap}>
        <Text style={[styles.label, focused && styles.labelFocused]}>
          {label}
        </Text>
        <TextInput
          ref={setRef}
          placeholderTextColor={colors.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          focusable={active}
          showSoftInputOnFocus={KEYBOARD_ON_SELECT_ONLY ? keyboard : !quiet}
          hasTVPreferredFocus={wantsFocus}
          {...rest}
          onPress={e => {
            if (KEYBOARD_ON_SELECT_ONLY) {
              setKeyboard(true);
            }
            onPress?.(e);
          }}
          onFocus={e => {
            hasFocus.current = true;
            setFocused(true);
            setQuiet(false);
            onFocus?.(e);
          }}
          onBlur={e => {
            hasFocus.current = false;
            setFocused(false);
            setKeyboard(false);
            onBlur?.(e);
          }}
          style={[styles.input, focused && styles.inputFocused, style]}
        />
      </View>
    );
  },
);

const styles = StyleSheet.create({
  wrap: { marginBottom: space.md },
  label: {
    color: colors.textDim,
    fontSize: font.small,
    marginBottom: space.xs,
  },
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
  inputFocused: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceHi,
  },
});
