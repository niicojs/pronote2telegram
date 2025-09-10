import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { addWeeks, format, isAfter, isEqual } from 'date-fns';
import * as pronote from '@niicojs/pawnote';
import type { Config } from './config.ts';
import { getWeekNumber } from './utils.ts';
import { fr } from 'date-fns/locale';
import Telegram from './telegram.ts';

export async function handlePronote(config: Config) {
  console.log('Login...');
  const handle = await login(config);
  console.log('Devoirs...');
  await devoirs(config, handle);
  console.log('Emplois du temps...');
  await emploiDuTemps(config, handle);
}

async function login(config: Config) {
  const loginfile = path.join(config.home, 'login.json');
  if (!existsSync(loginfile)) {
    console.error('No login.json found. Use init.login.ts to create it.');
    throw new Error('no config');
  }

  const handle = pronote.createSessionHandle();
  const logininfo = JSON.parse(readFileSync(loginfile, 'utf-8'));
  const refresh = await pronote.loginToken(handle, {
    kind: logininfo.kind,
    url: logininfo.url,
    username: logininfo.username,
    token: logininfo.token,
    deviceUUID: logininfo.deviceUUID,
  });

  const nextlogin = { deviceUUID: logininfo.deviceUUID, ...refresh };
  writeFileSync(loginfile, JSON.stringify(nextlogin, null, 2), 'utf-8');

  return handle;
}

async function devoirs(config: Config, handle: pronote.SessionHandle) {
  const week = getWeekNumber();
  const assignments = await pronote.assignmentsFromWeek(handle, week, week);
  for (const assignment of assignments) {
    const devoir = {
      classe: assignment.subject.name,
      description: assignment.description,
      deadline: new Date(assignment.deadline),
      done: assignment.done,
    };
    console.log('', devoir);
  }
  writeFileSync('assignements.json', JSON.stringify(assignments), 'utf8');
}

type TimetableHistory = { classe: string; date: string };
async function emploiDuTemps(config: Config, handle: pronote.SessionHandle) {
  let history: TimetableHistory[] = [];
  const historyfile = path.join(config.home, 'timetable-history.json');
  if (existsSync(historyfile)) {
    const old = addWeeks(new Date(), -2);
    history = JSON.parse(readFileSync(historyfile, 'utf-8'));
    history = history.filter((h) => isAfter(h.date, old));
  }

  const week = getWeekNumber();
  const timetable = await pronote.timetableFromWeek(handle, week);
  pronote.parseTimetable(handle, timetable, {
    withSuperposedCanceledClasses: false,
    withCanceledClasses: true,
    withPlannedClasses: true,
  });

  const annules = timetable.classes.filter(
    (c) => c.is === 'lesson' && (c.canceled || c.status === 'Permanence')
  ) as pronote.TimetableClassLesson[];

  const telegram = Telegram(config);
  const kid = handle.userResource.name;

  for (const classe of annules) {
    if (!history.find((h) => isEqual(h.date, classe.startDate))) {
      const when = format(classe.startDate, 'eeee à hh:mm', { locale: fr });
      console.log('annulé :', classe.subject?.name, when);
      history.push({
        classe: classe.subject?.name || '??',
        date: classe.startDate.toISOString(),
      });
      if (classe.canceled) {
        await telegram.sendMessageHTML(kid, 'Cours Annulé', `${classe.subject?.name}, ${when}`);
      } else if (classe.status === 'Permanence') {
        await telegram.sendMessageHTML(kid, 'Permanence', when);
      }
    }
  }

  writeFileSync(path.join(config.home, 'timetable.json'), JSON.stringify(timetable), 'utf8');
  writeFileSync(path.join(config.home, 'timetable-history.json'), JSON.stringify(history), 'utf8');
}
