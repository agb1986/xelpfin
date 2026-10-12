import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { DiscoveredServer, ServerInfo } from '../../backend/types';
import { useApp } from '../../state/AppState';
import { useNavigation } from '../../state/navigation';
import { Button, describeError, Focusable, Screen, TextField, bleed } from '../components';
import { colors, font, radius, space } from '../theme';

function ServerTile({ server, note, onPress, preferred }: { server: ServerInfo; note: string; onPress(): void; preferred?: boolean }) {
  return (
    <Focusable
      testID={`server-${server.id}`}
      hasTVPreferredFocus={preferred}
      onPress={onPress}
      style={focused => [styles.tile, focused && styles.tileFocused]}
    >
      {focused => (
        <>
          <Text style={[styles.tileName, focused && styles.onAccent]} numberOfLines={1}>
            {server.name}
          </Text>
          <Text style={[styles.tileUrl, focused && styles.onAccent]} numberOfLines={1}>
            {server.url}
          </Text>
          <Text style={[styles.tileNote, focused && styles.onAccent]}>{note}</Text>
        </>
      )}
    </Focusable>
  );
}

/** Finds Jellyfin servers on the LAN (UDP 7359) and accepts a typed address. */
export function ServerSelectScreen() {
  const { connector, platform, servers: saved } = useApp();
  const nav = useNavigation();
  const [found, setFound] = useState<DiscoveredServer[]>([]);
  const [searching, setSearching] = useState(true);
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const discover = useCallback(() => {
    setSearching(true);
    connector
      .discover(2500, platform.discoveryHints())
      .then(setFound, () => setFound([]))
      .finally(() => setSearching(false));
  }, [connector, platform]);

  useEffect(discover, [discover]);

  const list = useMemo(() => {
    const out: { server: ServerInfo; note: string }[] = saved.map(s => ({ server: s, note: 'Saved' }));
    for (const f of found) {
      const i = out.findIndex(o => o.server.id === f.id);
      if (i >= 0) {
        out[i] = { server: f, note: 'Saved · found on network' };
      } else {
        out.push({ server: f, note: 'Found on network' });
      }
    }
    return out;
  }, [found, saved]);

  const choose = (server: ServerInfo) => nav.push({ name: 'login', server });

  const connect = async () => {
    setBusy(true);
    setError(undefined);
    try {
      choose(await connector.probe(address || platform.addressHint()));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Choose a Jellyfin server" testID="servers">
      <ScrollView style={bleed.outer} contentContainerStyle={[bleed.inner, styles.body]}>
        <View style={styles.tiles}>
          {list.map((s, i) => (
            <ServerTile key={s.server.id} server={s.server} note={s.note} onPress={() => choose(s.server)} preferred={i === 0} />
          ))}
          {list.length === 0 ? (
            <Text style={styles.dim} testID="discovery-status">
              {searching ? 'Looking for servers on your network…' : 'No servers found automatically. Enter the address below.'}
            </Text>
          ) : null}
        </View>
        <View style={styles.manual}>
          <TextField
            label="Server address"
            testID="address"
            value={address}
            onChangeText={setAddress}
            placeholder={platform.addressHint()}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={connect}
            hasTVPreferredFocus={list.length === 0}
          />
          <View style={styles.actions}>
            <Button label={busy ? 'Connecting…' : 'Connect'} variant="primary" onPress={connect} disabled={busy} testID="connect" />
            <Button label={searching ? 'Searching…' : 'Search again'} onPress={discover} disabled={searching} testID="rediscover" />
          </View>
          {error ? (
            <Text style={styles.error} testID="server-error">
              {error}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingBottom: space.xl },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', minHeight: 110 },
  tile: {
    width: 260,
    padding: space.lg,
    marginRight: space.lg,
    marginBottom: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  tileFocused: { backgroundColor: colors.accent, borderColor: colors.text, transform: [{ scale: 1.04 }] },
  tileName: { color: colors.text, fontSize: font.heading, fontWeight: '700' },
  tileUrl: { color: colors.textDim, fontSize: font.small, marginTop: space.xs },
  tileNote: { color: colors.textDim, fontSize: 12, marginTop: space.sm },
  onAccent: { color: colors.accentText },
  dim: { color: colors.textDim, fontSize: font.body },
  manual: { marginTop: space.md, maxWidth: 520 },
  actions: { flexDirection: 'row' },
  error: { color: colors.danger, fontSize: font.body, marginTop: space.md },
});
