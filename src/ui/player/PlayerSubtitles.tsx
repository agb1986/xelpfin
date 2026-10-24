import React, { useMemo } from 'react';
import type { PlaybackPlan } from '../../backend/types';
import { useSubtitleCues } from '../../player/useSubtitleCues';
import { useApp } from '../../state/AppState';
import { SubtitleText } from '../components';

/** Side-loaded subtitles, drawn by the app (see useSubtitleCues) in the look from Settings. */
export function PlayerSubtitles({
  plan,
  subtitle,
  positionMs,
  lift,
}: {
  plan?: PlaybackPlan;
  subtitle: number;
  positionMs: number;
  /** Raises the cues clear of the overlay panel while it is up. */
  lift: number;
}) {
  const { settings } = useApp();
  const look = useMemo(
    () => ({
      size: settings.subtitleSize,
      color: settings.subtitleColor,
      background: settings.subtitleBackground,
    }),
    [
      settings.subtitleSize,
      settings.subtitleColor,
      settings.subtitleBackground,
    ],
  );
  const cues = useSubtitleCues(
    plan?.subtitleTracks.find(t => t.index === subtitle),
    plan?.headers,
  );
  return (
    <SubtitleText cues={cues} positionMs={positionMs} lift={lift} look={look} />
  );
}
