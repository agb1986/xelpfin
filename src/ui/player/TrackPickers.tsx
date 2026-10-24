import React from 'react';
import type { PlaybackPlan } from '../../backend/types';
import { OptionPicker, type Option } from '../components';
import type { Picker } from './overlayState';

function audioOptions(plan: PlaybackPlan): Option<number>[] {
  return plan.audioTracks.map(a => ({
    label: a.label,
    detail: [
      a.language,
      a.codec?.toUpperCase(),
      a.channels ? `${a.channels} ch` : undefined,
    ]
      .filter(Boolean)
      .join(' · '),
    value: a.index,
  }));
}

function subtitleOptions(plan: PlaybackPlan): Option<number>[] {
  return [
    { label: 'Off', value: -1 },
    ...plan.subtitleTracks.map(s => ({
      label: s.label,
      detail: [
        s.language,
        s.codec?.toUpperCase(),
        s.isForced ? 'forced' : undefined,
        s.delivery === 'burn-in' ? 'burned in by server' : undefined,
      ]
        .filter(Boolean)
        .join(' · '),
      value: s.index,
    })),
  ];
}

/** Track labels carry codec and flags; buttons keep the first part so the row stays on screen. */
const SHORT_LABEL_CHARS = 22;
export function shortLabel(label: string | undefined): string | undefined {
  if (!label || label.length <= SHORT_LABEL_CHARS) {
    return label;
  }
  const first = label.split(' - ')[0];
  return first.length <= SHORT_LABEL_CHARS
    ? first
    : `${first.slice(0, SHORT_LABEL_CHARS - 1)}…`;
}

/** The audio and subtitle lists the controls' track buttons open. */
export function TrackPickers({
  plan,
  picker,
  audio,
  subtitle,
  onAudio,
  onSubtitle,
  onClose,
}: {
  plan: PlaybackPlan;
  picker?: Picker;
  audio?: number;
  subtitle: number;
  onAudio(index: number): void;
  onSubtitle(index: number): void;
  onClose(): void;
}) {
  return (
    <>
      <OptionPicker
        visible={picker === 'audio'}
        title="Audio"
        options={audioOptions(plan)}
        selected={audio ?? -2}
        onSelect={onAudio}
        onClose={onClose}
        testID="pick-audio"
      />
      <OptionPicker
        visible={picker === 'subtitles'}
        title="Subtitles"
        options={subtitleOptions(plan)}
        selected={subtitle}
        onSelect={onSubtitle}
        onClose={onClose}
        testID="pick-subtitle"
      />
    </>
  );
}
