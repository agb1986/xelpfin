import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { DiscoveredServer, ServerInfo } from '../../backend/types';
import type { TlsInspection } from '../../platform/types';
import { useApp } from '../../state/AppState';
import { useNavigation } from '../../state/navigation';
import {
  assessCertificate,
  fingerprintLines,
  tlsEndpoint,
  tlsTargets,
} from '../../state/servers';
import {
  Button,
  describeError,
  Focusable,
  Screen,
  TextField,
  bleed,
} from '../components';
import { colors, font, radius, space } from '../theme';

export interface ServerEntry {
  key: string;
  server: ServerInfo;
  note: string;
}

/**
 * Lists saved servers first, then what discovery found. Any device on the network can answer
 * discovery with a saved server's id, so a reply never replaces a saved entry's address: it only
 * confirms the entry when the address matches, and is otherwise listed as a separate server.
 */
export function mergeServerList(
  saved: ServerInfo[],
  found: ServerInfo[],
): ServerEntry[] {
  const out: ServerEntry[] = saved.map(s => ({
    key: s.id,
    server: s,
    note: 'Saved',
  }));
  for (const f of found) {
    const i = out.findIndex(o => o.server.id === f.id);
    if (i < 0) {
      out.push({ key: f.id, server: f, note: 'Found on network' });
    } else if (out[i].server.url === f.url) {
      out[i] = { ...out[i], note: 'Saved · found on network' };
    } else {
      out.push({
        key: `${f.id}@${f.url}`,
        server: f,
        note: 'Found on network · different address',
      });
    }
  }
  return out;
}

function ServerTile({
  id,
  server,
  note,
  onPress,
  preferred,
}: {
  id: string;
  server: ServerInfo;
  note: string;
  onPress(): void;
  preferred?: boolean;
}) {
  return (
    <Focusable
      testID={`server-${id}`}
      hasTVPreferredFocus={preferred}
      onPress={onPress}
      style={focused => [styles.tile, focused && styles.tileFocused]}
    >
      {focused => (
        <>
          <Text
            style={[styles.tileName, focused && styles.onAccent]}
            numberOfLines={1}
          >
            {server.name}
          </Text>
          <Text
            style={[styles.tileUrl, focused && styles.onAccent]}
            numberOfLines={1}
          >
            {server.url}
          </Text>
          <Text style={[styles.tileNote, focused && styles.onAccent]}>
            {note}
          </Text>
        </>
      )}
    </Focusable>
  );
}

interface TrustPrompt {
  /** What the user typed or picked; retried after accepting. */
  address: string;
  inspection: TlsInspection;
  /** The fingerprint pinned before, when the certificate changed. */
  previous?: string;
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Shows exactly which certificate would be trusted. The user compares the fingerprint with the
 * one on the server (`openssl x509 -noout -fingerprint -sha256 -in cert.pem`) before accepting.
 */
function TrustPanel({
  prompt,
  busy,
  onAccept,
  onReject,
}: {
  prompt: TrustPrompt;
  busy: boolean;
  onAccept(): void;
  onReject(): void;
}) {
  const { inspection, previous } = prompt;
  const leaf = inspection.chain[0];
  return (
    <View style={styles.trust} testID="trust-prompt">
      <Text style={styles.trustTitle}>
        {previous
          ? 'The server certificate has changed'
          : 'This server uses a certificate the device does not trust'}
      </Text>
      <Text style={styles.trustText}>
        {previous
          ? 'The certificate is not the one you accepted before. If you did not replace it yourself, someone may be intercepting the connection. Do not continue unless the new fingerprint matches the one on your server.'
          : 'This is normal for a self-signed certificate. Continue only if the fingerprint below matches the one on your server. It will be trusted for this address only.'}
      </Text>
      <Text style={styles.trustLabel}>Server</Text>
      <Text style={styles.trustValue}>
        {inspection.host}:{inspection.port}
      </Text>
      <Text style={styles.trustLabel}>Issued to</Text>
      <Text style={styles.trustValue}>{leaf.subject}</Text>
      <Text style={styles.trustLabel}>Issued by</Text>
      <Text style={styles.trustValue}>
        {leaf.selfSigned ? 'Self-signed' : leaf.issuer}
      </Text>
      <Text style={styles.trustLabel}>Valid</Text>
      <Text style={styles.trustValue}>
        {day(leaf.notBefore)} to {day(leaf.notAfter)}
      </Text>
      <Text style={styles.trustLabel}>SHA-256 fingerprint</Text>
      <View testID="trust-fingerprint">
        {fingerprintLines(leaf.sha256).map((line, i) => (
          <Text key={i} style={styles.fingerprint}>
            {line}
          </Text>
        ))}
      </View>
      {previous ? (
        <>
          <Text style={styles.trustLabel}>Previously accepted</Text>
          <View testID="trust-previous">
            {fingerprintLines(previous).map((line, i) => (
              <Text key={i} style={styles.fingerprintOld}>
                {line}
              </Text>
            ))}
          </View>
        </>
      ) : null}
      <View style={styles.actions}>
        <Button
          label="Cancel"
          onPress={onReject}
          disabled={busy}
          testID="trust-reject"
          hasTVPreferredFocus
        />
        <Button
          label={
            previous ? 'Trust the new certificate' : 'Trust this certificate'
          }
          variant={previous ? 'danger' : 'primary'}
          onPress={onAccept}
          disabled={busy}
          testID="trust-accept"
        />
      </View>
    </View>
  );
}

/** Finds Jellyfin servers on the LAN (UDP 7359) and accepts a typed address. */
export function ServerSelectScreen() {
  const {
    connector,
    platform,
    servers: saved,
    certificatePin,
    trustCertificate,
  } = useApp();
  const nav = useNavigation();
  const [found, setFound] = useState<DiscoveredServer[]>([]);
  const [searching, setSearching] = useState(true);
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [trust, setTrust] = useState<TrustPrompt>();

  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const discover = useCallback(() => {
    setSearching(true);
    connector
      .discover(2500, platform.discoveryHints())
      .catch(() => [] as DiscoveredServer[])
      .then(servers => {
        if (alive.current) {
          setFound(servers);
          setSearching(false);
        }
      });
  }, [connector, platform]);

  useEffect(discover, [discover]);

  const list = useMemo(() => mergeServerList(saved, found), [found, saved]);

  const choose = (server: ServerInfo) => nav.push({ name: 'login', server });

  /**
   * After a failed connect, reads the certificate of each https endpoint the address may mean.
   * Returns a prompt only for a certificate the system does not trust and the user has not
   * accepted yet (or one that differs from what they accepted).
   */
  const certificatePrompt = async (
    target: string,
  ): Promise<TrustPrompt | undefined> => {
    const tls = platform.tls;
    if (!tls) {
      return undefined;
    }
    for (const { host, port } of tlsTargets(target)) {
      let inspection: TlsInspection;
      try {
        inspection = await tls.inspect(host, port);
      } catch {
        continue; // Nothing listening, or not TLS: try the next candidate.
      }
      const pinned = certificatePin(
        `https://${host.includes(':') ? `[${host}]` : host}:${port}`,
      );
      const verdict = assessCertificate(inspection, pinned);
      if (verdict === 'new' || verdict === 'changed') {
        return {
          address: target,
          inspection,
          previous: verdict === 'changed' ? pinned : undefined,
        };
      }
      return undefined;
    }
    return undefined;
  };

  const connectTo = async (target: string) => {
    setBusy(true);
    setError(undefined);
    setTrust(undefined);
    try {
      const info = await connector.probe(target);
      const pin = certificatePin(info.url);
      choose(pin ? { ...info, certSha256: pin } : info);
    } catch (e) {
      const prompt = await certificatePrompt(target).catch(() => undefined);
      if (!alive.current) {
        return;
      }
      if (prompt) {
        setTrust(prompt);
      } else {
        setError(describeError(e));
      }
    } finally {
      if (alive.current) {
        setBusy(false);
      }
    }
  };

  const connect = () => connectTo(address || platform.addressHint());

  // Saved https servers go through a probe so a changed certificate is caught here, with the
  // prompt, instead of as a bare network error on the sign-in screen.
  const pick = (server: ServerInfo) =>
    tlsEndpoint(server.url) ? connectTo(server.url) : choose(server);

  const accept = async () => {
    if (!trust) {
      return;
    }
    const { inspection, address: target } = trust;
    setBusy(true);
    try {
      await trustCertificate({
        host: inspection.host,
        port: inspection.port,
        sha256: inspection.chain[0].sha256,
      });
    } catch (e) {
      if (alive.current) {
        setBusy(false);
        setTrust(undefined);
        setError(describeError(e));
      }
      return;
    }
    if (alive.current) {
      await connectTo(target);
    }
  };

  const reject = () => {
    setTrust(undefined);
    setError(
      'The certificate was not trusted, so the app did not connect to the server.',
    );
  };

  return (
    <Screen title="Choose a Jellyfin server" testID="servers">
      <ScrollView
        style={bleed.outer}
        contentContainerStyle={[bleed.inner, styles.body]}
      >
        <View style={styles.tiles}>
          {list.map((s, i) => (
            <ServerTile
              key={s.key}
              id={s.key}
              server={s.server}
              note={s.note}
              onPress={() => pick(s.server)}
              preferred={i === 0}
            />
          ))}
          {list.length === 0 ? (
            <Text style={styles.dim} testID="discovery-status">
              {searching
                ? 'Looking for servers on your network…'
                : 'No servers found automatically. Enter the address below.'}
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
            <Button
              label={busy ? 'Connecting…' : 'Connect'}
              variant="primary"
              onPress={connect}
              disabled={busy}
              testID="connect"
            />
            <Button
              label={searching ? 'Searching…' : 'Search again'}
              onPress={discover}
              disabled={searching}
              testID="rediscover"
            />
          </View>
          {error ? (
            <Text style={styles.error} testID="server-error">
              {error}
            </Text>
          ) : null}
          {trust ? (
            <TrustPanel
              prompt={trust}
              busy={busy}
              onAccept={accept}
              onReject={reject}
            />
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
  tileFocused: {
    backgroundColor: colors.accent,
    borderColor: colors.text,
    transform: [{ scale: 1.04 }],
  },
  tileName: { color: colors.text, fontSize: font.heading, fontWeight: '700' },
  tileUrl: { color: colors.textDim, fontSize: font.small, marginTop: space.xs },
  tileNote: { color: colors.textDim, fontSize: 12, marginTop: space.sm },
  onAccent: { color: colors.accentText },
  dim: { color: colors.textDim, fontSize: font.body },
  manual: { marginTop: space.md, maxWidth: 520 },
  actions: { flexDirection: 'row' },
  error: { color: colors.danger, fontSize: font.body, marginTop: space.md },
  trust: {
    marginTop: space.lg,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.danger,
  },
  trustTitle: { color: colors.text, fontSize: font.heading, fontWeight: '700' },
  trustText: { color: colors.text, fontSize: font.body, marginTop: space.sm },
  trustLabel: {
    color: colors.textDim,
    fontSize: font.small,
    marginTop: space.md,
  },
  trustValue: { color: colors.text, fontSize: font.body },
  fingerprint: {
    color: colors.text,
    fontSize: font.body,
    fontFamily: 'monospace',
  },
  fingerprintOld: {
    color: colors.textDim,
    fontSize: font.body,
    fontFamily: 'monospace',
  },
});
