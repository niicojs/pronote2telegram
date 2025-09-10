import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { parse as parseToml } from 'smol-toml';

export type Config = ReturnType<typeof getConfig>;

export default function getConfig(home: string) {
  const configFile = path.join(home, 'config.toml');

  if (!existsSync(configFile)) {
    console.error('No config file!');
    process.exit(404);
  }

  const config = {
    home,
    run: {
      assignements: false,
      timetable: false,
    },
    http: {
      agent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    },
    telegram: {
      throttling: 1500,
      token: '',
      chatId: '',
    },
    no_lock: false,
    ...parseToml(readFileSync(configFile, 'utf-8')),
  };

  return config;
}
