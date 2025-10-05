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
      grades: false,
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
