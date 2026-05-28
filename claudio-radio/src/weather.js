import { config } from './config.js';
import { logger } from './logger.js';

// 天气缓存
let weatherCache = null;
let weatherCacheTime = 0;
const CACHE_DURATION = 10 * 60 * 1000; // 10 分钟缓存

// 获取天气数据
export async function getWeather() {
  const apiKey = config.weather?.apiKey;

  if (!apiKey) {
    logger.warn('OpenWeather API Key 未配置');
    return {
      provider: 'openweather',
      city: '未知',
      tempC: null,
      feelsLikeC: null,
      condition: '天气未配置',
      humidity: null,
      updatedAt: null,
    };
  }

  // 检查缓存
  if (weatherCache && Date.now() - weatherCacheTime < CACHE_DURATION) {
    return weatherCache;
  }

  try {
    const city = config.weather?.city || 'Beijing';
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric&lang=zh_cn`;

    logger.info('获取天气数据', { city });
    const response = await fetch(url);

    if (!response.ok) {
      const error = await response.text();
      logger.error('天气 API 请求失败', { status: response.status, error });
      throw new Error(`天气 API 请求失败: ${response.status}`);
    }

    const data = await response.json();

    const weather = {
      provider: 'openweather',
      city: data.name || city,
      tempC: Math.round(data.main?.temp || 0),
      feelsLikeC: Math.round(data.main?.feels_like || 0),
      condition: data.weather?.[0]?.description || '未知',
      humidity: data.main?.humidity || 0,
      updatedAt: new Date().toISOString(),
    };

    // 更新缓存
    weatherCache = weather;
    weatherCacheTime = Date.now();

    logger.info('天气数据获取成功', { city: weather.city, temp: weather.tempC, condition: weather.condition });
    return weather;
  } catch (err) {
    logger.error('获取天气失败', { error: err.message });
    return {
      provider: 'openweather',
      city: config.weather?.city || '未知',
      tempC: null,
      feelsLikeC: null,
      condition: '获取失败',
      humidity: null,
      updatedAt: null,
    };
  }
}

// 清除天气缓存
export function clearWeatherCache() {
  weatherCache = null;
  weatherCacheTime = 0;
}
