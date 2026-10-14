import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ItemDetail, MediaItem } from '../../backend/types';
import { useBackend } from '../../state/AppState';
import { useIsActive, useNavigation } from '../../state/navigation';
import { toggleSeries, useRandomizer } from '../../state/randomizer';
import { Button, ErrorView, LoadingView, MediaRow, describeError } from '../components';
import { formatDuration, formatRuntime, useAsync } from '../hooks';
import { colors, font, radius, space } from '../theme';
import { openItem } from './navigate';

function metaLine(item: ItemDetail): string {
  const parts: string[] = [];
  if (item.kind === 'episode' && item.seriesName) {
    parts.push(`${item.seriesName} · S${item.parentIndexNumber ?? '?'}:E${item.indexNumber ?? '?'}`);
  }
  if (item.year) {
    parts.push(String(item.year));
  }
  const rt = formatRuntime(item.runtimeMs);
  if (rt) {
    parts.push(rt);
  }
  if (item.officialRating) {
    parts.push(item.officialRating);
  }
  if (item.communityRating) {
    parts.push(`★ ${item.communityRating.toFixed(1)}`);
  }
  if (item.userData?.played) {
    parts.push('Watched');
  }
  return parts.join('  ·  ');
}

function mediaLine(item: ItemDetail): string | undefined {
  const src = item.mediaSources?.[0];
  if (!src) {
    return undefined;
  }
  const parts = [
    src.videoCodec?.toUpperCase(),
    src.height ? `${src.height}p` : undefined,
    src.container?.split(',')[0].toUpperCase(),
    src.audioTracks.length ? `${src.audioTracks.length} audio` : undefined,
    src.subtitleTracks.length ? `${src.subtitleTracks.length} subtitles` : undefined,
  ];
  return parts.filter(Boolean).join('  ·  ');
}

/** Movie, episode and series detail with play/resume, watched and favourite actions. */
export function DetailScreen({ itemId, seasonId: initialSeason }: { itemId: string; seasonId?: string }) {
  const backend = useBackend();
  const nav = useNavigation();
  const active = useIsActive();
  const detail = useAsync(() => backend.item(itemId), [backend, itemId]);
  const [actionError, setActionError] = useState<string>();
  const randomizer = useRandomizer();

  const { reload } = detail;
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) {
      reload();
    }
    wasActive.current = active;
  }, [active, reload]);

  const item = detail.data;
  const isSeries = item?.kind === 'series';
  const seasons = useAsync(async () => (isSeries ? backend.seasons(itemId) : []), [backend, itemId, isSeries]);
  const isEpisode = item?.kind === 'episode';
  const resumeEp = useAsync(async () => (isSeries ? backend.resumeEpisode(itemId) : undefined), [backend, itemId, isSeries, detail.data]);
  const [seasonId, setSeasonId] = useState(initialSeason);
  // Set when a season button is pressed: the first episode of the new season takes focus.
  const [pickedSeason, setPickedSeason] = useState(false);
  const currentSeason = seasonId ?? resumeEp.data?.seasonId ?? item?.nextUp?.seasonId ?? seasons.data?.[0]?.id;
  // Tagged with its season so a row never shows the previous season's episodes while loading.
  const episodes = useAsync(async () => {
    if (isSeries && currentSeason) {
      return { season: currentSeason, list: await backend.episodes(itemId, currentSeason) };
    }
    if (isEpisode && item?.seriesId && item.seasonId) {
      const list = await backend.episodes(item.seriesId, item.seasonId);
      const at = list.findIndex(e => e.id === item.id);
      return { season: item.seasonId, list: at < 0 ? [] : list.slice(at + 1) };
    }
    return { season: '', list: [] as MediaItem[] };
  }, [backend, itemId, isSeries, isEpisode, currentSeason, item?.seriesId, item?.seasonId]);
  const shownEpisodes = episodes.data && (isEpisode || episodes.data.season === currentSeason) ? episodes.data.list : [];

  const openEpisode = useCallback((ep: MediaItem) => openItem(nav, ep), [nav]);
  const episodeTitle = useCallback((ep: MediaItem) => `${ep.indexNumber ?? ''}. ${ep.name}`, []);

  if (!item) {
    return (
      <View style={styles.root}>
        {detail.status === 'error' ? <ErrorView error={detail.error} onRetry={detail.reload} hasTVPreferredFocus /> : <LoadingView />}
      </View>
    );
  }

  const act = async (fn: () => Promise<void>) => {
    setActionError(undefined);
    try {
      await fn();
      detail.reload();
    } catch (e) {
      setActionError(describeError(e));
    }
  };

  const position = item.userData?.playbackPositionMs ?? 0;
  const canResume = !isSeries && position > 0 && !item.userData?.played;
  const play = (from: number) => nav.push({ name: 'player', itemId: item.id, startPositionMs: from });
  const backdrop = item.backdropUrl ?? item.thumbUrl;
  const next = item.nextUp;
  const resume = resumeEp.data;
  const code = (e: MediaItem) => `S${e.parentIndexNumber ?? '?'}:E${e.indexNumber ?? '?'}`;
  const playEp = (e: MediaItem) => nav.push({ name: 'player', itemId: e.id, startPositionMs: e.userData?.playbackPositionMs ?? 0 });
  const compact = isSeries || isEpisode;

  return (
    <View style={styles.root} testID="detail">
      {backdrop ? <Image source={{ uri: backdrop }} style={styles.backdrop} resizeMode="cover" blurRadius={1} /> : null}
      <View style={styles.scrim} />
      <ScrollView contentContainerStyle={compact ? styles.bodySeries : styles.body}>
        <View style={styles.top}>
          {item.posterUrl && item.kind !== 'episode' ? (
            <Image source={{ uri: item.posterUrl }} style={isSeries ? styles.posterSeries : styles.poster} />
          ) : null}
          <View style={styles.info}>
            <Text style={styles.title} numberOfLines={isSeries ? 1 : 2} testID="detail-title">
              {item.name}
            </Text>
            <Text style={styles.meta}>{metaLine(item)}</Text>
            {!isSeries && item.genres?.length ? <Text style={styles.meta}>{item.genres.slice(0, 4).join(', ')}</Text> : null}
            {!isSeries && item.tagline ? <Text style={styles.tagline}>{item.tagline}</Text> : null}
            {item.overview ? (
              <Text style={styles.overview} numberOfLines={compact ? 3 : 5}>
                {item.overview}
              </Text>
            ) : null}
            {!compact && mediaLine(item) ? <Text style={styles.media}>{mediaLine(item)}</Text> : null}
            <View style={styles.actions}>
              {isSeries ? (
                <>
                  {resume ? (
                    <Button
                      variant="primary"
                      hasTVPreferredFocus
                      label={`Resume ${code(resume)} · ${formatDuration(resume.userData?.playbackPositionMs)}`}
                      onPress={() => playEp(resume)}
                      testID="resume-episode"
                    />
                  ) : null}
                  {next && next.id !== resume?.id && (resumeEp.status !== 'loading' || resume) ? (
                    <Button
                      variant={resume ? 'secondary' : 'primary'}
                      hasTVPreferredFocus={!resume}
                      label={`Play ${code(next)}`}
                      onPress={() => playEp(next)}
                      testID="play-next"
                    />
                  ) : null}
                </>
              ) : canResume ? (
                <>
                  <Button variant="primary" hasTVPreferredFocus label={`Resume from ${formatDuration(position)}`} onPress={() => play(position)} testID="resume" />
                  <Button label="Play from start" onPress={() => play(0)} testID="play-start" />
                </>
              ) : (
                <Button variant="primary" hasTVPreferredFocus label="Play" onPress={() => play(0)} testID="play" />
              )}
              {isEpisode && item.seasonId && item.seriesId ? (
                <Button
                  label="Back to season"
                  onPress={() => nav.replace({ name: 'detail', itemId: item.seriesId!, seasonId: item.seasonId })}
                  testID="back-to-season"
                />
              ) : null}
              {isEpisode && item.seriesId ? (
                <Button label="Back to series" onPress={() => nav.replace({ name: 'detail', itemId: item.seriesId! })} testID="back-to-series" />
              ) : null}
              {isSeries ? (
                <Button
                  label={randomizer.state.series.includes(item.id) ? 'Remove Randomizer' : 'Add Randomizer'}
                  onPress={() => randomizer.list.update(s => toggleSeries(s, item.id))}
                  testID="toggle-randomizer"
                />
              ) : null}
              <Button
                label={item.userData?.played ? 'Mark unwatched' : 'Mark watched'}
                onPress={() => act(() => backend.setPlayed(item.id, !item.userData?.played))}
                testID="toggle-played"
              />
              <Button
                label={item.userData?.favorite ? '♥ Favourite' : '♡ Favourite'}
                onPress={() => act(() => backend.setFavorite(item.id, !item.userData?.favorite))}
                testID="toggle-favorite"
              />
            </View>
            {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
          </View>
        </View>
        {isSeries ? (
          <View style={styles.series}>
            <ScrollView horizontal contentContainerStyle={styles.seasons} showsHorizontalScrollIndicator={false}>
              {seasons.data?.map(s => (
                <Button
                  key={s.id}
                  compact
                  variant={s.id === currentSeason ? 'primary' : 'secondary'}
                  label={s.name}
                  onPress={() => {
                    setSeasonId(s.id);
                    setPickedSeason(true);
                  }}
                  testID={`season-${s.indexNumber ?? s.id}`}
                />
              ))}
            </ScrollView>
            {episodes.status === 'error' ? (
              <ErrorView error={episodes.error} onRetry={episodes.reload} />
            ) : (
              <MediaRow
                key={currentSeason}
                title="Episodes"
                items={shownEpisodes}
                variant="thumb"
                onPress={openEpisode}
                titleFor={episodeTitle}
                preferFirst={pickedSeason}
                testID="episodes"
              />
            )}
          </View>
        ) : null}
        {isEpisode ? (
          <View style={styles.series}>
            <MediaRow title="Next episodes" items={shownEpisodes} variant="thumb" onPress={openEpisode} titleFor={episodeTitle} testID="next-episodes" />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  backdrop: { ...StyleSheet.absoluteFillObject, opacity: 0.45 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(20,16,31,0.55)' },
  body: { paddingTop: space.safeY + space.md, paddingBottom: space.xl },
  // A series page has to fit the 540 dp canvas without scrolling: header, seasons and one
  // episode row. Anything taller makes the page jump down when focus reaches the episodes.
  bodySeries: { paddingTop: space.safeY },
  posterSeries: { width: 135, height: 202, borderRadius: radius.md, marginRight: space.xl, backgroundColor: colors.surface },
  top: { flexDirection: 'row', paddingHorizontal: space.safeX },
  poster: { width: 180, height: 270, borderRadius: radius.md, marginRight: space.xl, backgroundColor: colors.surface },
  info: { flex: 1 },
  title: { color: colors.text, fontSize: font.hero, fontWeight: '800' },
  meta: { color: colors.textDim, fontSize: font.body, marginTop: space.xs },
  tagline: { color: colors.text, fontSize: font.body, fontStyle: 'italic', marginTop: space.md },
  overview: { color: colors.text, fontSize: font.body, lineHeight: 22, marginTop: space.md, maxWidth: 620 },
  media: { color: colors.textDim, fontSize: font.small, marginTop: space.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space.lg, paddingVertical: space.xs },
  error: { color: colors.danger, fontSize: font.body, marginTop: space.sm },
  series: { marginTop: space.md },
  seasons: { paddingHorizontal: space.safeX, paddingVertical: space.xs },
});
