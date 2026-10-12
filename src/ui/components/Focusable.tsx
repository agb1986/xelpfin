import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Pressable, type PressableProps, type StyleProp, type View, type ViewStyle } from 'react-native';
import { useScreenState } from '../../state/navigation';

const DOUBLE_PRESS_MS = 400;

export interface FocusableProps extends Omit<PressableProps, 'style' | 'children'> {
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
  { style, children, onFocus, onBlur, onPress, focusable = true, hasTVPreferredFocus, ...rest },
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
  useEffect(() => {
    if (active && lastFocused.current === inner && inner.current) {
      const t = setTimeout(() => inner.current?.requestTVFocus?.(), 0);
      return () => clearTimeout(t);
    }
  }, [active, lastFocused]);
  return (
    <Pressable
      ref={inner}
      focusable={focusable && active}
      hasTVPreferredFocus={hasTVPreferredFocus && active}
      {...rest}
      onPress={press}
      onFocus={e => {
        setFocused(true);
        lastFocused.current = inner;
        onFocus?.(e);
      }}
      onBlur={e => {
        setFocused(false);
        onBlur?.(e);
      }}
      style={typeof style === 'function' ? style(focused) : style}
    >
      {typeof children === 'function' ? children(focused) : children}
    </Pressable>
  );
});
