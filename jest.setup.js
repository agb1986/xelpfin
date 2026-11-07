/* global jest */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest'),
);

jest.mock('react-native-video', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Video = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({
      seek: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
    }));
    return React.createElement(View, { testID: 'video', ...props });
  });
  return {
    __esModule: true,
    default: Video,
    SelectedTrackType: {
      INDEX: 'index',
      DISABLED: 'disabled',
      TITLE: 'title',
      LANGUAGE: 'language',
      SYSTEM: 'system',
    },
    TextTrackType: {
      VTT: 'text/vtt',
      SUBRIP: 'application/x-subrip',
      TTML: 'application/ttml+xml',
    },
  };
});

// The app entry point registers the platform and engine; tests get the Vega boundary stub (the
// adapter jest's default Platform.OS used to select) and the react-native-video engine.
const { setPlatform } = require('./src/platform');
const { createVegaPlatform } = require('./src/platform/vega');
const { setEngine } = require('./src/player');
const { VideoEngine } = require('./src/player/rnv/VideoEngine');
setPlatform(createVegaPlatform());
setEngine(VideoEngine);
