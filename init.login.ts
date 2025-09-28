import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import * as pronote from '@niicojs/pawnote';

const deviceUUID = randomUUID();
const handle = pronote.createSessionHandle();
const refresh = await pronote.loginQrCode(handle, {
  deviceUUID,
  pin: '0000', // 4 numbers you provided in Pronote.
  qr: {
    avecPageConnexion: false,
    jeton: 'aaaaaaaaa',
    login: 'aaaaaaabbbbbbb',
    url: 'https://0910860r.index-education.net/pronote/mobile.parent.html',
  },
});

const nextlogin = { deviceUUID, ...refresh };
writeFileSync('login.json', JSON.stringify(nextlogin, null, 2), 'utf-8');

console.log('done.');
