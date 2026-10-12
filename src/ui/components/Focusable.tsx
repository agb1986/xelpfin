import React, { forwardRef, useState } from 'react';
import { Pressable, type PressableProps, type StyleProp, type View, type ViewStyle } from 'react-native';

export interface FocusableProps extends Omit<PressableProps, 'style' | 'children'> {
  style?: StyleProp<ViewStyle> | ((focused: boolean) => StyleProp<ViewStyle>);
  children: React.ReactNode | ((focused: boolean) => React.ReactNode);
  hasTVPreferredFocus?: boolean;
}

/**
 * The D-pad target every interactive element is built on: a Pressable that tracks focus and
 * passes it to style and children, so components can draw the purple focus treatment.
 */
export const Focusable = forwardRef<View, FocusableProps>(function Focusable(
  { style, children, onFocus, onBlur, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      ref={ref}
      focusable
      {...rest}
      onFocus={e => {
        setFocused(true);
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
