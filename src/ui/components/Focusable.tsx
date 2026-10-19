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
    onPressIn,
    onPressOut,
    onLongPress,
    focusable = true,
    hasTVPreferredFocus,
    ...rest
  },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const inner = useRef<View>(null);
  useImperativeHandle(ref, () => inner.current as View);
  // One remote "select" reaches JS by two routes in react-native-tvos (0.81.5-2, ReactAndroid):
  // ReactViewGroup.onKeyUp dispatches topPressOut for DPAD_CENTER/ENTER and then lets Android's
  // View.onKeyUp performClick(), where the OnClickListener that ReactViewManager.setFocusable
  // installs dispatches topClick. Pressability.js turns the first into onPressOut followed by
  // onPress, and the second into onPress again, unless Platform.isTV is true, in which case it
  // drops the click outright. That flag follows the device's UI mode: true on a Fire TV stick,
  // false on the project's tv_1080p emulator, which is where the double press was seen. A time
  // window cannot tell the two routes apart from two deliberate presses, so the press is taken
  // from onPressOut, which fires exactly once per key release on both, and onPress is not given
  // to the Pressable, which leaves the click route unhandled. Click-only sources (a mouse, the
  // keyboard space bar, a TalkBack click) therefore do not press, which a remote-driven app can
  // live with; Pressability's touch sound is skipped too, though the native click sound still
  // plays.
  const longPressed = useRef(false);
  const pressIn: PressableProps['onPressIn'] = e => {
    longPressed.current = false;
    onPressIn?.(e);
  };
  const longPress: PressableProps['onLongPress'] = onLongPress
    ? e => {
        longPressed.current = true;
        onLongPress(e);
      }
    : undefined;
  const pressOut: PressableProps['onPressOut'] = e => {
    onPressOut?.(e);
    // Pressability's own rule: a long press that was delivered consumes the release.
    if (onPress && !longPressed.current) {
      onPress(e);
    }
  };
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
      onPressIn={pressIn}
      onPressOut={pressOut}
      onLongPress={longPress}
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
