import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { addWeeks, addYears, format, isAfter, isEqual, startOfToday } from 'date-fns';
import { fr } from 'date-fns/locale';
import * as pronote from '@niicojs/pawnote';
import Turndown from 'turndown';
import type { Config } from './config.ts';
import { getWeekNumber } from './utils.ts';
import Telegram, { escape } from './telegram.ts';

export async function handlePronote(config: Config) {
  console.log('Login...');
  const handle = await login(config);
  if (config.run.assignements) {
    console.log('Devoirs...');
    await devoirs(config, handle);
  }
  if (config.run.timetable) {
    console.log('Emplois du temps...');
    await emploiDuTemps(config, handle);
  }
  if (config.run.grades) {
    console.log('Notes...');
    await notes(config, handle);
  }
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
  // writeFileSync('assignements.json', JSON.stringify(assignments), 'utf8');

  const todo = assignments
    .filter((d) => !d.done && isAfter(d.deadline, startOfToday()))
    .toSorted((a, b) => (isAfter(b.deadline, a.deadline) ? -1 : 1));
  if (todo.length === 0) return;

  const turndown = new Turndown();
  turndown.escape = escape;

  let msg = '';

  for (const assignment of todo) {
    const devoir = {
      classe: assignment.subject.name,
      description: turndown.turndown(assignment.description),
      deadline: assignment.deadline,
      when: format(assignment.deadline, 'eeee dd', { locale: fr }),
    };
    msg += `*\\[${devoir.when}\\] ${escape(devoir.classe)}*\n${devoir.description}\n`;
    for (const attach of assignment.attachments) {
      if (attach.kind === pronote.AttachmentKind.Link) {
        msg += `\n[${escape(attach.name || attach.url)}](${attach.url})\n`;
      } else if (attach.kind === pronote.AttachmentKind.File) {
        msg += `\n[${escape(attach.name || attach.url)}](${attach.url})\n`;
      }
    }
    console.log('', devoir);
  }

  // console.log(msg);

  const telegram = Telegram(config);
  const kid = handle.userResource.name;
  await telegram.sendMessage(kid, 'DEVOIRS', msg, true);
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
      const when = format(classe.startDate, 'eeee à HH:mm', { locale: fr });
      console.log('  annulé :', classe.subject?.name, when);
      history.push({
        classe: classe.subject?.name || '??',
        date: classe.startDate.toISOString(),
      });
      if (classe.canceled) {
        await telegram.sendMessage(kid, 'Cours Annulé', `${classe.subject?.name}, ${when}`);
      } else if (classe.status === 'Permanence') {
        await telegram.sendMessage(kid, 'Permanence', when);
      }
    }
  }

  // writeFileSync(path.join(config.home, 'timetable.json'), JSON.stringify(timetable), 'utf8');
  writeFileSync(path.join(config.home, 'timetable-history.json'), JSON.stringify(history), 'utf8');
}

type GradeHistory = { id: string; date: string };
async function notes(config: Config, handle: pronote.SessionHandle) {
  let history: GradeHistory[] = [];
  const historyfile = path.join(config.home, 'grades-history.json');
  if (existsSync(historyfile)) {
    const old = addYears(new Date(), -1);
    history = JSON.parse(readFileSync(historyfile, 'utf-8'));
    history = history.filter((h) => isAfter(h.date, old));
  }

  const tab = handle.userResource.tabs.get(pronote.TabLocation.Grades);
  if (!tab) throw new Error('no grades tab');
  const selectedPeriod = tab.defaultPeriod!;
  console.log('Period:', selectedPeriod.name);

  const overview = await pronote.gradesOverview(handle, selectedPeriod);

  const messages = [];
  for (const grade of overview.grades) {
    if (history.find((h) => h.id === grade.id)) continue;
    history.push({ id: grade.id, date: grade.date.toISOString() });

    let name = format(grade.date, 'dd/MM', { locale: fr }) + ' ' + grade.subject.name;
    if (grade.comment) name += ' (' + grade.comment + ')';
    let value = '';
    if (grade.value.kind === pronote.GradeKind.Grade) {
      value = grade.value.points.toString();
      if (typeof grade.outOf.points === 'number') value += '/' + grade.outOf.points;
    } else if (grade.value.kind === pronote.GradeKind.Absent) {
      value = 'Absent';
    }

    console.log(`${name} - ${value}`);
    messages.push(`${name} - ${value}`);
  }

  if (messages.length > 0) {
    const telegram = Telegram(config);
    const kid = handle.userResource.name;
    const s = messages.length > 1 ? 's' : '';
    await telegram.sendMessage(kid, `Nouvelle${s} Note${s}`, messages.join('\n'));
  }

  writeFileSync(path.join(config.home, 'grades.json'), JSON.stringify(overview.grades), 'utf8');
  writeFileSync(path.join(config.home, 'grades-history.json'), JSON.stringify(history), 'utf8');
}
