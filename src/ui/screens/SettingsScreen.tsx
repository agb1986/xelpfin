import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../../state/AppState';
import { useNavigation } from '../../state/navigation';
import {
  BITRATE_CHOICES,
  LANGUAGE_CHOICES,
  SUBTITLE_BACKGROUND_CHOICES,
  SUBTITLE_CHOICES,
  SUBTITLE_COLOR_CHOICES,
  SUBTITLE_SIZE_CHOICES,
} from '../../state/settings';
import { APP_NAME, APP_VERSION } from '../../version';
import { Focusable, OptionPicker, Screen, bleed, type Option } from '../components';
import { useAsync } from '../hooks';
import { colors, font, radius, space } from '../theme';

function Row({ label, value, onPress, testID, first }: { label: string; value: string; onPress(): void; testID: string; first?: boolean }) {
  return (
    <Focusable testID={testID} onPress={onPress} hasTVPreferredFocus={first} style={focused => [styles.row, focused && styles.rowFocused]}>
      {focused => (
        <>
          <Text style={[styles.rowLabel, focused && styles.textOn]}>{label}</Text>
          <Text style={[styles.rowValue, focused && styles.textOn]}>{value}</Text>
        </>
      )}
    </Focusable>
  );
}

type PickerKey = 'bitrate' | 'subtitles' | 'language' | 'subsize' | 'subcolor' | 'subbg';
const labelOf = <T,>(choices: Option<T>[], v: T) => choices.find(c => c.value === v)?.label ?? String(v);

/** Playback preferences, account actions and device information. */
export function SettingsScreen() {
  const app = useApp();
  const nav = useNavigation();
  const { settings, updateSettings, platform, backend } = app;
  const [picker, setPicker] = useState<PickerKey>();
  const caps = useAsync(() => app.capabilities(), [app.capabilities]);
  const server = backend?.session.server;

  const signOut = () => app.signOut(() => nav.reset(server ? [{ name: 'servers' }, { name: 'login', server }] : [{ name: 'servers' }]));
  const changeServer = () => app.signOut(() => nav.reset([{ name: 'servers' }]));

  const device = platform.device;
  const decoders = caps.data?.video.map(v => `${v.codec.toUpperCase()} ${v.maxBitDepth}-bit${v.hardware ? '' : ' (sw)'}`).join(', ');

  return (
    <Screen title="Settings" testID="settings">
      <ScrollView style={bleed.outer} contentContainerStyle={[bleed.inner, styles.body]}>
        <Text style={styles.section}>Playback</Text>
        <Row first testID="set-bitrate" label="Maximum streaming quality" value={labelOf(BITRATE_CHOICES, settings.maxBitrate)} onPress={() => setPicker('bitrate')} />
        <Row testID="set-subtitles" label="Subtitles" value={labelOf(SUBTITLE_CHOICES, settings.subtitleMode)} onPress={() => setPicker('subtitles')} />
        <Row testID="set-language" label="Preferred audio and subtitle language" value={labelOf(LANGUAGE_CHOICES, settings.preferredLanguage)} onPress={() => setPicker('language')} />
        <Row testID="set-subsize" label="Subtitle size" value={labelOf(SUBTITLE_SIZE_CHOICES, settings.subtitleSize)} onPress={() => setPicker('subsize')} />
        <Row testID="set-subcolor" label="Subtitle colour" value={labelOf(SUBTITLE_COLOR_CHOICES, settings.subtitleColor)} onPress={() => setPicker('subcolor')} />
        <Row testID="set-subbg" label="Subtitle background" value={labelOf(SUBTITLE_BACKGROUND_CHOICES, settings.subtitleBackground)} onPress={() => setPicker('subbg')} />
        <Row testID="set-autoplay" label="Play next episode automatically" value={settings.autoplayNext ? 'On' : 'Off'} onPress={() => updateSettings({ autoplayNext: !settings.autoplayNext })} />
        <Row testID="set-debug" label="Show playback information overlay" value={settings.showDebugOverlay ? 'On' : 'Off'} onPress={() => updateSettings({ showDebugOverlay: !settings.showDebugOverlay })} />

        <Text style={styles.section}>Account</Text>
        {backend ? (
          <>
            <Row testID="set-switch-user" label={`Signed in as ${backend.session.userName}`} value="Switch user" onPress={signOut} />
            <Row testID="set-change-server" label={`Server ${backend.session.server.name}`} value="Change server" onPress={changeServer} />
          </>
        ) : null}

        <Text style={styles.section}>About</Text>
        <View style={styles.about}>
          <Text style={styles.aboutText}>
            {APP_NAME} {APP_VERSION} · {platform.id}
          </Text>
          <Text style={styles.aboutText}>
            {device.manufacturer} {device.model} · Android {device.osVersion} · {device.abis.join(', ')}
            {device.isEmulator ? ' · emulator' : ''}
          </Text>
          {server ? (
            <Text style={styles.aboutText}>
              {server.name} · {server.url}
              {server.version ? ` · Jellyfin ${server.version}` : ''}
            </Text>
          ) : null}
          {decoders ? <Text style={styles.aboutText}>Video decoders: {decoders}</Text> : null}
          {caps.data ? <Text style={styles.aboutText}>Audio decoders: {caps.data.audio.join(', ')}</Text> : null}
          <Text style={styles.aboutDim}>xelpfin talks only to your Jellyfin server. No analytics, no accounts elsewhere.</Text>
        </View>
      </ScrollView>

      <OptionPicker
        visible={picker === 'bitrate'}
        title="Maximum streaming quality"
        options={BITRATE_CHOICES}
        selected={settings.maxBitrate}
        onSelect={v => updateSettings({ maxBitrate: v })}
        onClose={() => setPicker(undefined)}
        testID="pick-bitrate"
      />
      <OptionPicker
        visible={picker === 'subtitles'}
        title="Subtitles"
        options={SUBTITLE_CHOICES}
        selected={settings.subtitleMode}
        onSelect={v => updateSettings({ subtitleMode: v })}
        onClose={() => setPicker(undefined)}
        testID="pick-subtitles"
      />
      <OptionPicker
        visible={picker === 'language'}
        title="Preferred language"
        options={LANGUAGE_CHOICES}
        selected={settings.preferredLanguage}
        onSelect={v => updateSettings({ preferredLanguage: v })}
        onClose={() => setPicker(undefined)}
        testID="pick-language"
      />
      <OptionPicker
        visible={picker === 'subsize'}
        title="Subtitle size"
        options={SUBTITLE_SIZE_CHOICES}
        selected={settings.subtitleSize}
        onSelect={v => updateSettings({ subtitleSize: v })}
        onClose={() => setPicker(undefined)}
        testID="pick-subsize"
      />
      <OptionPicker
        visible={picker === 'subcolor'}
        title="Subtitle colour"
        options={SUBTITLE_COLOR_CHOICES}
        selected={settings.subtitleColor}
        onSelect={v => updateSettings({ subtitleColor: v })}
        onClose={() => setPicker(undefined)}
        testID="pick-subcolor"
      />
      <OptionPicker
        visible={picker === 'subbg'}
        title="Subtitle background"
        options={SUBTITLE_BACKGROUND_CHOICES}
        selected={settings.subtitleBackground}
        onSelect={v => updateSettings({ subtitleBackground: v })}
        onClose={() => setPicker(undefined)}
        testID="pick-subbg"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingBottom: space.xl, maxWidth: 760 },
  section: { color: colors.accent, fontSize: font.heading, fontWeight: '700', marginTop: space.lg, marginBottom: space.sm },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    marginBottom: space.xs,
  },
  rowFocused: { backgroundColor: colors.accent },
  rowLabel: { color: colors.text, fontSize: font.body },
  rowValue: { color: colors.textDim, fontSize: font.body, fontWeight: '600' },
  textOn: { color: colors.accentText },
  about: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.lg },
  aboutText: { color: colors.text, fontSize: font.body, marginBottom: space.xs },
  aboutDim: { color: colors.textDim, fontSize: font.small, marginTop: space.sm },
});
