import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  type HWEvent,
  Modal,
  StyleSheet,
  Text,
  useTVEventHandler,
  View,
} from 'react-native';
import { letterJumpTarget } from '../letterJump';
import { colors, font, radius, space } from '../theme';
import { Focusable } from './Focusable';

export interface Option<T> {
  label: string;
  detail?: string;
  value: T;
}

interface OptionPickerProps<T> {
  visible: boolean;
  title: string;
  options: Option<T>[];
  selected?: T;
  onSelect(value: T): void;
  onClose(): void;
  testID?: string;
  /**
   * Index of the first row of a list sorted by label. When set, rewind and fast-forward jump
   * focus by initial letter from there on (see letterJumpTarget), and a hint says so.
   */
  letterJumpFrom?: number;
  /** Plain action list: no selected-value marker column. */
  plain?: boolean;
}

const ROW_HEIGHT = 52;

/**
 * Modal list for audio/subtitle tracks and settings values. BACK closes it. With
 * `letterJumpFrom`, rewind and fast-forward move focus to the previous or next initial letter.
 */
export function OptionPicker<T>({
  visible,
  title,
  options,
  selected,
  onSelect,
  onClose,
  testID,
  letterJumpFrom,
  plain,
}: OptionPickerProps<T>) {
  const selIndex = Math.max(
    0,
    options.findIndex(o => o.value === selected),
  );
  // The row that should take focus: undefined means the selected one (when the picker opens),
  // a number is the target of a letter jump, null means none (it already got focus, so a row
  // that re-mounts while scrolling past it does not pull focus back).
  const [preferred, setPreferred] = useState<number | null | undefined>();
  const [openFor, setOpenFor] = useState(visible);
  if (openFor !== visible) {
    setOpenFor(visible);
    setPreferred(undefined);
  }
  const preferredIndex = preferred === undefined ? selIndex : preferred;
  // The row that has focus, which a jump starts from.
  const focusedIndex = useRef(selIndex);
  useEffect(() => {
    if (visible) {
      focusedIndex.current = selIndex;
    }
  }, [visible, selIndex]);
  const list = useRef<FlatList<Option<T>>>(null);
  const rows = useRef(new Map<number, View>());
  const pendingFocus = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const cancelFocus = () => {
    if (pendingFocus.current !== undefined) {
      clearTimeout(pendingFocus.current);
    }
  };
  useEffect(() => cancelFocus, []);

  const onKey = useCallback(
    (evt: HWEvent) => {
      if (!visible || letterJumpFrom === undefined) {
        return;
      }
      // Android TV delivers remote keys on key-up only (key-down events are off by default).
      if (
        evt.eventKeyAction !== 1 ||
        (evt.eventType !== 'rewind' && evt.eventType !== 'fastForward')
      ) {
        return;
      }
      const target = letterJumpTarget(
        options.map(o => o.label),
        letterJumpFrom,
        focusedIndex.current,
        evt.eventType === 'rewind' ? -1 : 1,
      );
      if (target === null) {
        return;
      }
      focusedIndex.current = target;
      // A row that is mounted with (or changes to) hasTVPreferredFocus takes focus natively;
      // scrolling first makes sure the target row is rendered at all (the list is virtualised).
      setPreferred(target);
      list.current?.scrollToIndex({ index: target, animated: false });
      // Jumping back to a row that is still marked preferred does not change the prop, so ask
      // that row directly as well.
      cancelFocus();
      pendingFocus.current = setTimeout(
        () => rows.current.get(target)?.requestTVFocus?.(),
        0,
      );
    },
    [visible, letterJumpFrom, options],
  );
  useTVEventHandler(onKey);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.scrim}>
        <View style={styles.panel} testID={testID}>
          <Text style={styles.title}>{title}</Text>
          {letterJumpFrom !== undefined ? (
            <Text style={styles.hint} testID={`${testID ?? 'option'}-hint`}>
              ⏪ ⏩ jump by letter
            </Text>
          ) : null}
          <FlatList
            ref={list}
            data={options}
            keyExtractor={(_, i) => String(i)}
            initialScrollIndex={selIndex > 5 ? selIndex : undefined}
            getItemLayout={(_, index) => ({
              length: ROW_HEIGHT,
              offset: ROW_HEIGHT * index,
              index,
            })}
            renderItem={({ item, index }) => {
              const isSel = item.value === selected;
              return (
                <Focusable
                  ref={view => {
                    if (view) {
                      rows.current.set(index, view);
                    } else {
                      rows.current.delete(index);
                    }
                  }}
                  testID={`${testID ?? 'option'}-${index}`}
                  hasTVPreferredFocus={index === preferredIndex}
                  onFocus={() => {
                    focusedIndex.current = index;
                    if (index === preferredIndex) {
                      setPreferred(null);
                    }
                  }}
                  onPress={() => {
                    onSelect(item.value);
                    onClose();
                  }}
                  style={focused => [
                    styles.option,
                    focused && styles.optionFocused,
                  ]}
                >
                  {focused => (
                    <View style={styles.optionRow}>
                      {plain ? null : (
                        <Text
                          style={[
                            styles.check,
                            (focused || isSel) && styles.textOn,
                          ]}
                        >
                          {isSel ? '●' : '○'}
                        </Text>
                      )}
                      <View style={styles.flex}>
                        <Text
                          style={[styles.label, focused && styles.textOn]}
                          numberOfLines={1}
                        >
                          {item.label}
                        </Text>
                        {item.detail ? (
                          <Text style={styles.detail} numberOfLines={1}>
                            {item.detail}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  )}
                </Focusable>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: colors.scrim, alignItems: 'flex-end' },
  panel: {
    width: 380,
    height: '100%',
    backgroundColor: colors.surface,
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
  },
  title: {
    color: colors.text,
    fontSize: font.title,
    fontWeight: '700',
    marginBottom: space.lg,
  },
  hint: {
    color: colors.textDim,
    fontSize: 12,
    marginTop: -space.md,
    marginBottom: space.md,
  },
  option: {
    height: 48,
    marginBottom: 4,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    justifyContent: 'center',
  },
  optionFocused: { backgroundColor: colors.accent },
  optionRow: { flexDirection: 'row', alignItems: 'center' },
  check: { color: colors.textDim, fontSize: font.body, width: 26 },
  flex: { flex: 1 },
  label: { color: colors.text, fontSize: font.body },
  detail: { color: colors.textDim, fontSize: 12 },
  textOn: { color: colors.accentText },
});
