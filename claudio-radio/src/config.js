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
  llm: {
    apiKey: process.env.LLM_API_KEY,
    model: process.env.LLM_MODEL || 'mimo-v2-flash',
    baseUrl: process.env.LLM_BASE_URL || 'https://api.xiaomimimo.com/v1',
  },
  weather: {
    apiKey: process.env.OPENWEATHER_API_KEY,
    city: process.env.WEATHER_CITY || 'Beijing',
    lat: process.env.WEATHER_LAT,
    lon: process.env.WEATHER_LON,
  },
  app: {
    port: process.env.PORT || 3000,
  },
};