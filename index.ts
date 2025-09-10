import { rmSync } from 'fs';
import mri from 'mri';
import getConfig from './config.ts';
import { initLockFile } from './utils.ts';
import { handlePronote } from './pronote.ts';

console.info('pronote2telegram');

const options = mri(process.argv.slice(2));
const home = options.home || '.';

console.log('Load config...');
const config = getConfig(home);

const lockFile = initLockFile(config);
try {
  await handlePronote(config);
} catch (e) {
  console.error(e);
} finally {
  try {
    if (lockFile) rmSync(lockFile);
  } catch {}
}

console.log('done.');
