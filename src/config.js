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
  minimax: {
    apiKey: process.env.MINIMAX_API_KEY,
  },
  db: {
    path: process.env.DB_PATH || './db/claudio.db',
  },
  app: {
    port: process.env.PORT || 3000,
  },
};