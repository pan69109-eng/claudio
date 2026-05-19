const COMMAND_PATTERNS = {
  play: /^(播放|开始|放歌)$/i,
  pause: /^(暂停|stop)$/i,
  next: /^(下一首|切歌)$/i,
  previous: /^(上一首|回退)$/i,
};

const MUSIC_PATTERNS = [
  { type: 'playlist', regex: /(放|播放)(我的|这个)?(.+)歌单/i, group: 3 },
  { type: 'playSearch', regex: /^播放(.+)/i, group: 1 },
  { type: 'search', regex: /(来首|放首|点播|唱一首)(.+)/i, group: 2 },
  { type: 'mood', regex: /(来点|想听|放点)(.+)/i, group: 2 },
];

export function route(input) {
  for (const pattern of MUSIC_PATTERNS) {
    const match = input.match(pattern.regex);
    if (match) {
      return { type: 'music', payload: { intent: pattern.type, match: match[pattern.group], raw: input } };
    }
  }

  for (const [type, pattern] of Object.entries(COMMAND_PATTERNS)) {
    if (pattern.test(input)) {
      return { type: 'command', payload: { command: type, raw: input } };
    }
  }

  return { type: 'llm', payload: { text: input } };
}
