import React, { useEffect, useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { PublicUser, ServerInfo, Session } from '../../backend/types';
import { useApp } from '../../state/AppState';
import { useIsActive, useNavigation } from '../../state/navigation';
import { Button, describeError, Focusable, Screen, TextField, bleed } from '../components';
import { useAsync } from '../hooks';
import { colors, font, radius, space } from '../theme';

const UserTile = React.forwardRef<View, { user: PublicUser; onPress(): void; preferred?: boolean }>(function UserTile(
  { user, onPress, preferred },
  ref,
) {
  return (
    <Focusable
      ref={ref}
      testID={`user-${user.name}`}
      hasTVPreferredFocus={preferred}
      onPress={onPress}
      style={focused => [styles.user, focused && styles.userFocused]}
    >
      {focused => (
        <>
          <View style={styles.avatar}>
            {user.imageUrl ? (
              <Image source={{ uri: user.imageUrl }} style={styles.avatarImg} />
            ) : (
              <Text style={styles.avatarText}>{user.name.slice(0, 1).toUpperCase()}</Text>
            )}
          </View>
          <Text style={[styles.userName, focused && styles.onAccent]} numberOfLines={1}>
            {user.name}
          </Text>
        </>
      )}
    </Focusable>
  );
});

/** User picker, password sign-in and Quick Connect for one server. */
export function LoginScreen({ server, expired }: { server: ServerInfo; expired?: boolean }) {
  const { connector, signIn } = useApp();
  const nav = useNavigation();
  const active = useIsActive();
  const users = useAsync(() => connector.publicUsers(server), [connector, server]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [qcCode, setQcCode] = useState<string>();
  const passwordRef = useRef<TextInput>(null);
  const firstUser = useRef<View>(null);
  // The user list arrives after the screen has mounted and focus has already settled on a
  // button, so preferred focus alone is not enough: move focus to the first user explicitly.
  const userCount = users.data?.length ?? 0;
  useEffect(() => {
    if (active && userCount > 0) {
      const t = setTimeout(() => firstUser.current?.requestTVFocus?.(), 0);
      return () => clearTimeout(t);
    }
  }, [active, userCount]);

  const done = (session: Session) => {
    signIn(session);
    nav.reset([{ name: 'home' }]);
  };

  const login = async (name = username, pw = password) => {
    if (!name.trim()) {
      setError('Pick a user or type a user name.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      done(await connector.login(server, name.trim(), pw));
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  };

  // Quick Connect: show the code, poll until another signed-in device approves it.
  const [qcSecret, setQcSecret] = useState<string>();
  const startQuickConnect = async () => {
    setError(undefined);
    try {
      const st = await connector.quickConnectStart(server);
      if (st.status === 'pending') {
        setQcCode(st.code);
        setQcSecret(st.secret);
      } else {
        setError('Quick Connect is turned off on this server.');
      }
    } catch (e) {
      setError(describeError(e));
    }
  };
  useEffect(() => {
    if (!qcSecret || !active) {
      return;
    }
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const st = await connector.quickConnectPoll(server, qcSecret);
        if (!stopped && st.status === 'authorized') {
          stopped = true;
          clearInterval(timer);
          done(await connector.quickConnectLogin(server, qcSecret));
        }
      } catch (e) {
        if (!stopped) {
          stopped = true;
          clearInterval(timer);
          setQcCode(undefined);
          setQcSecret(undefined);
          setError(describeError(e));
        }
      }
    }, 3000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qcSecret, active, connector, server]);

  const pickUser = (u: PublicUser) => {
    setUsername(u.name);
    setPassword('');
    setError(undefined);
    passwordRef.current?.focus();
  };

  return (
    <Screen title={`Sign in to ${server.name}`} testID="login">
      <ScrollView style={bleed.outer} contentContainerStyle={[bleed.inner, styles.body]}>
        {expired ? (
          <Text style={styles.notice} testID="login-expired">
            Your session on this server has ended. Sign in again to continue.
          </Text>
        ) : null}
        <View style={styles.users}>
          {users.data?.map((u, i) => (
            <UserTile key={u.id} ref={i === 0 ? firstUser : undefined} user={u} onPress={() => pickUser(u)} preferred={i === 0} />
          ))}
          {users.status === 'error' ? <Text style={styles.dim}>Could not load the user list: {describeError(users.error)}</Text> : null}
        </View>
        <View style={styles.form}>
          <TextField label="User name" testID="username" value={username} onChangeText={setUsername} returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()} />
          <TextField
            ref={passwordRef}
            label="Password (leave empty if the account has none)"
            testID="password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            returnKeyType="go"
            onSubmitEditing={() => login()}
          />
          <View style={styles.actions}>
            <Button label={busy ? 'Signing in…' : 'Sign in'} variant="primary" onPress={() => login()} disabled={busy} testID="signin" />
            <Button label="Quick Connect" onPress={startQuickConnect} testID="quickconnect" />
            <Button label="Other server" onPress={() => (nav.depth > 1 ? nav.back() : nav.reset([{ name: 'servers' }]))} testID="change-server" />
          </View>
          {qcCode ? (
            <View style={styles.qc} testID="qc-code">
              <Text style={styles.dim}>On a device where you are signed in, open Quick Connect and enter</Text>
              <Text style={styles.code}>{qcCode}</Text>
              <Text style={styles.dim}>Waiting for approval…</Text>
            </View>
          ) : null}
          {error ? (
            <Text style={styles.error} testID="login-error">
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
  users: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: space.md },
  user: { width: 120, alignItems: 'center', padding: space.md, marginRight: space.md, borderRadius: radius.lg, borderWidth: 2, borderColor: 'transparent' },
  userFocused: { backgroundColor: colors.accent, borderColor: colors.text, transform: [{ scale: 1.05 }] },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.surfaceHi, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImg: { width: 72, height: 72 },
  avatarText: { color: colors.text, fontSize: 30, fontWeight: '700' },
  userName: { color: colors.text, fontSize: font.body, marginTop: space.sm },
  onAccent: { color: colors.accentText },
  form: { maxWidth: 560 },
  actions: { flexDirection: 'row', marginTop: space.xs },
  qc: { marginTop: space.lg, padding: space.lg, backgroundColor: colors.surface, borderRadius: radius.lg },
  code: { color: colors.accent, fontSize: 40, fontWeight: '800', letterSpacing: 8, marginVertical: space.sm },
  dim: { color: colors.textDim, fontSize: font.body },
  error: { color: colors.danger, fontSize: font.body, marginTop: space.md },
  notice: { color: colors.text, fontSize: font.body, marginBottom: space.md },
});
