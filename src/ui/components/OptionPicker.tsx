import React from 'react';
import { FlatList, Modal, StyleSheet, Text, View } from 'react-native';
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
  selected: T;
  onSelect(value: T): void;
  onClose(): void;
  testID?: string;
}

/** Modal list for audio/subtitle tracks and settings values. BACK closes it. */
export function OptionPicker<T>({ visible, title, options, selected, onSelect, onClose, testID }: OptionPickerProps<T>) {
  const selIndex = Math.max(0, options.findIndex(o => o.value === selected));
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <View style={styles.panel} testID={testID}>
          <Text style={styles.title}>{title}</Text>
          <FlatList
            data={options}
            keyExtractor={(_, i) => String(i)}
            initialScrollIndex={selIndex > 5 ? selIndex : undefined}
            getItemLayout={(_, index) => ({ length: 52, offset: 52 * index, index })}
            renderItem={({ item, index }) => {
              const isSel = item.value === selected;
              return (
                <Focusable
                  testID={`${testID ?? 'option'}-${index}`}
                  hasTVPreferredFocus={index === selIndex}
                  onPress={() => {
                    onSelect(item.value);
                    onClose();
                  }}
                  style={focused => [styles.option, focused && styles.optionFocused]}
                >
                  {focused => (
                    <View style={styles.optionRow}>
                      <Text style={[styles.check, (focused || isSel) && styles.textOn]}>{isSel ? '●' : '○'}</Text>
                      <View style={styles.flex}>
                        <Text style={[styles.label, focused && styles.textOn]} numberOfLines={1}>
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
  panel: { width: 380, height: '100%', backgroundColor: colors.surface, paddingVertical: space.xl, paddingHorizontal: space.lg },
  title: { color: colors.text, fontSize: font.title, fontWeight: '700', marginBottom: space.lg },
  option: { height: 48, marginBottom: 4, borderRadius: radius.md, paddingHorizontal: space.md, justifyContent: 'center' },
  optionFocused: { backgroundColor: colors.accent },
  optionRow: { flexDirection: 'row', alignItems: 'center' },
  check: { color: colors.textDim, fontSize: font.body, width: 26 },
  flex: { flex: 1 },
  label: { color: colors.text, fontSize: font.body },
  detail: { color: colors.textDim, fontSize: 12 },
  textOn: { color: colors.accentText },
});
