import React, { useCallback, useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { Library, MediaItem } from '../../backend/types';
import { BackendError } from '../../backend/types';
import { useApp, useBackend } from '../../state/AppState';
import { useIsActive, useNavigation } from '../../state/navigation';
import { useHiddenNextUp, withoutHidden } from '../../state/hiddenNextUp';
import { drawEpisode, loadPool, useRandomizer } from '../../state/randomizer';
import {
  Button,
  EmptyView,
  ErrorView,
  LoadingView,
  MediaRow,
  TopBar,
} from '../components';
import { useAsync } from '../hooks';
import { colors, space } from '../theme';
import { openItem } from './navigate';

interface HomeData {
  libraries: Library[];
  resume: MediaItem[];
  nextUp: MediaItem[];
  latest: { library: Library; items: MediaItem[] }[];
}

/** Continue Watching, Next Up and the newest items per library. */
export function HomeScreen() {
  const backend = useBackend();
  const { signOut } = useApp();
  const nav = useNavigation();
  const active = useIsActive();
  const randomizer = useRandomizer();
  const { hidden } = useHiddenNextUp();

  const home = useAsync<HomeData>(async () => {
    const libraries = await backend.libraries();
    // Rows load in parallel; one failing row should not blank the whole screen.
    const [resume, nextUp, ...latest] = await Promise.all([
      backend.resume(24).catch(() => []),
      backend.nextUp(24).catch(() => []),
      ...libraries.map(l => backend.latest(l.id, 24).catch(() => [])),
    ]);
    return {
      libraries,
      resume,
      nextUp,
      latest: libraries.map((library, i) => ({ library, items: latest[i] })),
    };
  }, [backend]);

  // Refresh progress and next-up when coming back from the player or a detail page.
  const { reload } = home;
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) {
      reload();
    }
    wasActive.current = active;
  }, [active, reload]);

  const resumeItem = useCallback(
    (item: MediaItem) => openItem(nav, item, { resume: true }),
    [nav],
  );
  const open = useCallback((item: MediaItem) => openItem(nav, item), [nav]);
  // Loading the pool takes a moment; a second press meanwhile would draw and open a second episode.
  const drawing = useRef(false);

  if (!home.data) {
    if (home.status === 'error') {
      const authFailed =
        home.error instanceof BackendError && home.error.kind === 'auth';
      return (
        <View style={styles.root}>
          <ErrorView
            error={home.error}
            onRetry={home.reload}
            hasTVPreferredFocus
          />
          {authFailed ? (
            <View style={styles.center}>
              <Button
                label="Sign in again"
                onPress={() => {
                  const server = backend.session.server;
                  signOut(() =>
                    nav.reset([{ name: 'servers' }, { name: 'login', server }]),
                  );
                }}
              />
            </View>
          ) : null}
        </View>
      );
    }
    return (
      <View style={styles.root}>
        <LoadingView />
      </View>
    );
  }

  const playRandom = async () => {
    if (drawing.current) {
      return;
    }
    drawing.current = true;
    const pool = await loadPool(backend, randomizer.list.get().series).finally(
      () => {
        drawing.current = false;
      },
    );
    let drawn: MediaItem | undefined;
    randomizer.list.update(s => {
      const d = drawEpisode(s, pool, Math.random);
      drawn = d?.episode;
      return d?.state ?? s;
    });
    if (drawn) {
      nav.push({
        name: 'player',
        itemId: drawn.id,
        startPositionMs: drawn.userData?.playbackPositionMs ?? 0,
        shuffle: true,
      });
    }
  };

  const { libraries, resume, latest } = home.data;
  const nextUp = withoutHidden(home.data.nextUp, hidden);
  const empty =
    !resume.length && !nextUp.length && latest.every(l => !l.items.length);
  const firstRow = resume.length ? 'resume' : nextUp.length ? 'next' : 'latest';
  return (
    <View style={styles.root} testID="home">
      <TopBar
        libraries={libraries}
        current="home"
        onRandomizer={randomizer.state.series.length ? playRandom : undefined}
      />
      {empty ? (
        <EmptyView
          title="Nothing here yet"
          message="Your libraries are empty. Add media in the Jellyfin dashboard, then come back."
        />
      ) : (
        <ScrollView contentContainerStyle={styles.rows}>
          <MediaRow
            title="Continue Watching"
            testID="row-resume"
            items={resume}
            variant="thumb"
            onPress={resumeItem}
            preferFirst={firstRow === 'resume'}
          />
          <MediaRow
            title="Next Up"
            testID="row-nextup"
            items={nextUp}
            variant="thumb"
            onPress={resumeItem}
            preferFirst={firstRow === 'next'}
          />
          {latest.map(({ library, items }, i) => (
            <MediaRow
              key={library.id}
              title={`Latest in ${library.name}`}
              testID={`row-latest-${library.name}`}
              items={items}
              variant="poster"
              onPress={open}
              preferFirst={firstRow === 'latest' && i === 0}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  rows: { paddingBottom: space.xl },
  center: { alignItems: 'center', paddingBottom: space.xl },
});
