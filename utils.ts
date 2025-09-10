import path from 'path';
import { rmSync, statSync, writeFileSync } from 'fs';
import { addDays, addHours, differenceInWeeks, isBefore } from 'date-fns';
import type { Config } from './config.ts';

export function initLockFile(config: Config) {
  if (config.no_lock) return null;
  const home = config.home;
  const lockFile = path.join(home, '.lock');
  try {
    const old = addHours(new Date(), -3);
    const stats = statSync(lockFile);
    if (isBefore(stats.birthtime, old)) {
      rmSync(lockFile);
    } else {
      console.error('Lock file there, aborting!');
      process.exit(404);
    }
  } catch {}
  writeFileSync(lockFile, 'lock', 'utf-8');
  return lockFile;
}

export const wait = async (time: number) => {
  return new Promise((resolve) => setTimeout(resolve, time));
};

export const getWeekNumber = () =>
  1 + differenceInWeeks(addDays(new Date(), 1), new Date(2025, 8, 1));
