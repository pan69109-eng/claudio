import 'dotenv/config';

export const config = {
  fishAudio: {
    apiKey: process.env.FISH_AUDIO_API_KEY,
    referenceId: process.env.FISH_AUDIO_REFERENCE_ID,
  },
  spotify: {
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  },
  mimo: {
    apiKey: process.env.MIMO_API_KEY,
    model: process.env.MIMO_MODEL || 'mimo-v2.5-pro',
    baseUrl: process.env.MIMO_BASE_URL || 'https://api.xiaomimimo.com/anthropic',
  },
  db: {
    path: process.env.DB_PATH || './db/claudio.db',
  },
  app: {
    port: process.env.PORT || 3000,
  },
};