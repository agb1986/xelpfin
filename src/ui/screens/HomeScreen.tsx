import React, { useCallback, useRef } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { Backend } from '../../backend/Backend';
import { peekBackend } from '../../backend/CachedBackend';
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
import { useAsync, useRefreshOnReturn } from '../hooks';
import { colors, space } from '../theme';
import { openItem } from './navigate';

const ROW_LIMIT = 24;

/** The catalogue rows: libraries and the newest items of each. */
interface Shelves {
  libraries: Library[];
  latest: { library: Library; items: MediaItem[] }[];
}

/** The rows that change with every play. */
interface Progress {
  resume: MediaItem[];
  nextUp: MediaItem[];
}

/** Shelves straight from the backend's cache, or nothing when any row is missing. */
function peekShelves(backend: Backend): Shelves | undefined {
  const libraries = peekBackend(backend, 'libraries');
  if (!libraries) {
    return undefined;
  }
  const latest: Shelves['latest'] = [];
  for (const library of libraries) {
    const items = peekBackend(backend, 'latest', library.id, ROW_LIMIT);
    if (!items) {
      return undefined;
    }
    latest.push({ library, items });
  }
  return { libraries, latest };
}

function peekProgress(backend: Backend): Progress | undefined {
  const resume = peekBackend(backend, 'resume', ROW_LIMIT);
  const nextUp = peekBackend(backend, 'nextUp', ROW_LIMIT);
  return resume && nextUp ? { resume, nextUp } : undefined;
}

/** Continue Watching, Next Up and the newest items per library. */
export function HomeScreen() {
  const backend = useBackend();
  const { signOut } = useApp();
  const nav = useNavigation();
  const active = useIsActive();
  const randomizer = useRandomizer();
  const { hidden } = useHiddenNextUp();

  const shelves = useAsync<Shelves>(
    async () => {
      const libraries = await backend.libraries();
      // Rows load in parallel; one failing row should not blank the whole screen.
      const latest = await Promise.all(
        libraries.map(l => backend.latest(l.id, ROW_LIMIT).catch(() => [])),
      );
      return {
        libraries,
        latest: libraries.map((library, i) => ({ library, items: latest[i] })),
      };
    },
    [backend],
    { initial: () => peekShelves(backend) },
  );
  const progress = useAsync<Progress>(
    async () => {
      const [resume, nextUp] = await Promise.all([
        backend.resume(ROW_LIMIT).catch(() => []),
        backend.nextUp(ROW_LIMIT).catch(() => []),
      ]);
      return { resume, nextUp };
    },
    [backend],
    { initial: () => peekProgress(backend) },
  );

  // Coming back from the player or a detail page only refreshes the rows that playback changes;
  // the backend's cache answers from memory when nothing was played in the meantime.
  const reloadProgress = progress.reload;
  useRefreshOnReturn(active, backend, reloadProgress);

  const reloadShelves = shelves.reload;
  const reloadAll = useCallback(() => {
    reloadShelves();
    reloadProgress();
  }, [reloadShelves, reloadProgress]);

  const resumeItem = useCallback(
    (item: MediaItem) => openItem(nav, item, { resume: true }),
    [nav],
  );
  const open = useCallback((item: MediaItem) => openItem(nav, item), [nav]);
  // Loading the pool takes a moment; a second press meanwhile would draw and open a second episode.
  const drawing = useRef(false);

  if (!shelves.data || !progress.data) {
    if (shelves.status === 'error') {
      const authFailed =
        shelves.error instanceof BackendError && shelves.error.kind === 'auth';
      return (
        <View style={styles.root}>
          <ErrorView
            error={shelves.error}
            onRetry={reloadAll}
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

  const { libraries, latest } = shelves.data;
  const { resume } = progress.data;
  const nextUp = withoutHidden(progress.data.nextUp, hidden);
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
