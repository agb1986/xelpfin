import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  Pressable,
  type PressableProps,
  type StyleProp,
  type View,
  type ViewStyle,
} from 'react-native';
import { useScreenState } from '../../state/navigation';

const DOUBLE_PRESS_MS = 400;
const RESTORE_TRIES = 8;
const RESTORE_RETRY_MS = 80;

export interface FocusableProps extends Omit<
  PressableProps,
  'style' | 'children'
> {
  style?: StyleProp<ViewStyle> | ((focused: boolean) => StyleProp<ViewStyle>);
  children: React.ReactNode | ((focused: boolean) => React.ReactNode);
  hasTVPreferredFocus?: boolean;
}

/**
 * The D-pad target every interactive element is built on: a Pressable that tracks focus and
 * passes it to style and children, so components can draw the purple focus treatment.
 *
 * Only focusable while its screen is on top: hidden screens stay mounted, and a view that is
 * merely hidden can otherwise keep (or receive) focus and swallow remote presses. When the
 * screen comes back, the element that had focus last takes it again.
 */
export const Focusable = forwardRef<View, FocusableProps>(function Focusable(
  {
    style,
    children,
    onFocus,
    onBlur,
    onPress,
    focusable = true,
    hasTVPreferredFocus,
    ...rest
  },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const inner = useRef<View>(null);
  useImperativeHandle(ref, () => inner.current as View);
  // react-native-tvos on Android reports one remote "select" twice: once as the TV press
  // (onPressOut) and once as a view click (onClick). Collapse the pair into a single press.
  const lastPress = useRef(0);
  const press: PressableProps['onPress'] = onPress
    ? e => {
        const now = Date.now();
        if (now - lastPress.current < DOUBLE_PRESS_MS) {
          return;
        }
        lastPress.current = now;
        onPress(e);
      }
    : undefined;
  const screen = useScreenState();
  const { active, lastFocused } = screen;
  const key = rest.testID;
  const hasFocus = useRef(false);
  useEffect(() => {
    if (!active) {
      // Hidden: Android drops focus without a blur event reaching us.
      hasFocus.current = false;
      return;
    }
    // The remembered element, or, when that view has been re-created (a list reloaded in a new
    // order), the one with the same testID.
    const last = lastFocused.current as {
      ref: typeof inner;
      key?: string;
    } | null;
    if (
      !last ||
      (last.ref !== inner &&
        !(last.key && last.key === key && !last.ref.current))
    ) {
      return;
    }
    // The screen was just un-hidden: the native view is not laid out or focusable for a few
    // frames, and Android may hand focus to another element (the header) meanwhile. Keep asking
    // until this element actually has focus.
    let tries = 0;
    let t: ReturnType<typeof setTimeout>;
    const attempt = () => {
      if (hasFocus.current || !inner.current || tries++ >= RESTORE_TRIES) {
        return;
      }
      inner.current.requestTVFocus?.();
      t = setTimeout(attempt, RESTORE_RETRY_MS);
    };
    t = setTimeout(attempt, 0);
    return () => clearTimeout(t);
  }, [active, lastFocused, key]);
  return (
    <Pressable
      ref={inner}
      focusable={focusable && active}
      hasTVPreferredFocus={hasTVPreferredFocus && active}
      {...rest}
      onPress={press}
      onFocus={e => {
        hasFocus.current = true;
        setFocused(true);
        // A hidden screen's elements can receive focus as Android reassigns it; that is not
        // the element to restore.
        if (active) {
          lastFocused.current = { ref: inner, key };
        }
        onFocus?.(e);
      }}
      onBlur={e => {
        hasFocus.current = false;
        setFocused(false);
        onBlur?.(e);
      }}
      style={typeof style === 'function' ? style(focused) : style}
    >
      {typeof children === 'function' ? children(focused) : children}
    </Pressable>
  );
});
