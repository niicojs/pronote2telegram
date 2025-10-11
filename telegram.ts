import { lightFormat as format } from 'date-fns';
import { ofetch } from 'ofetch';
import type { Config } from './config.ts';
import { wait } from './utils.ts';

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  const temps = items.slice(0);
  while (temps.length) {
    chunks.push(temps.splice(0, size));
  }

  return chunks;
}

export const escape = (text: string) => {
  if (!text) return '\\.';
  return text.replace(/(_|\*|\[|\]|\(|\)|~|`|>|#|\+|-|=|\||\{|\}|\.|!)/g, '\\$1');
};

type Attach = { name: string; type: string; data: Blob };

type Post = {
  child: string;
  type: string;
  from?: string;
  date: Date;
  subject: string;
  html: string;
  attachments?: Attach[];
};

export default function Telegram(config: Config) {
  const token = config.telegram.token;
  const chatId = config.telegram.chatId;
  const throttling = config.telegram?.throttling || 0;

  let last = new Date().getTime() - throttling;
  const throttle = async () => {
    if (throttling > 0 && new Date().getTime() < last + throttling) {
      await new Promise((resolve) => setTimeout(resolve, throttling));
    }
    last = new Date().getTime();
  };

  const client = ofetch.create({
    method: 'POST',
    baseURL: `https://api.telegram.org/bot${token}`,
    retry: 5,
    retryDelay: (ctx) => {
      const opt = ctx.options as any;
      const attempt = (opt.retryAttempt = (opt.retryAttempt || 0) + 1);
      if (attempt < 2) {
        return 2 ** (attempt - 1) * 1_000;
      } else {
        return 61_000;
      }
    },
    retryStatusCodes: [408, 429, 503, 504],
    timeout: 20_000,
  });

  const sendAttachments = async (files: Attach[], type: string) => {
    console.log(`Send ${files.length} attachments...`);
    if (files.length === 1) {
      await throttle();
      const api = {
        photo: 'sendPhoto',
        document: 'sendDocument',
        video: 'sendVideo',
        audio: 'sendAudio',
      } as Record<string, string>;
      const file = files[0];
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('disable_notification', 'true');
      form.append(type, file.data, file.name);
      await client(api[type], { body: form });
    } else {
      for (const elts of chunk(files, 10)) {
        await throttle();
        const form = new FormData();
        form.append('chat_id', chatId);
        const media = [];
        for (const file of elts) {
          media.push({
            type: type,
            media: `attach://${file.name}`,
          });
          form.append(file.name, file.data, file.name);
        }
        form.append('media', JSON.stringify(media));
        await client('sendMediaGroup', { body: form });
        if (elts.length >= 10) {
          await wait(1 * 60 * 1_000 + 100); // wait a minute to avoid throttling
        }
      }
    }
  };

  const sendMessage = async (child: string, subject: string, msg: string, isMd = false) => {
    await throttle();
    if (!isMd) msg = escape(msg);
    await client('sendMessage', {
      body: {
        chat_id: chatId,
        parse_mode: 'MarkdownV2',
        text: `*__PRONOTE \\- ${child}__*  
*${escape(subject)}*  
${msg}`,
      },
    });
  };

  const sendPostMessage = async (post: Post) => {
    await throttle();

    await client('sendMessage', {
      body: {
        chat_id: chatId,
        parse_mode: 'HTML',
        text: `
<b>PRONOTE - ${post.child}</b>  
${post.type || ''}${post.from ? `de ${post.from}` : ''}  
${format(post.date, `'Le' dd/MM/yy 'à' HH:mm:ss`)}  
<b>${post.subject}</b>  
${post.html}`,
      },
    });

    if (post.attachments) {
      // send photos
      const images = post.attachments.filter((a) => a.type === 'image');
      if (images.length > 0) {
        await sendAttachments(images, 'photo');
      }

      // document (pdf par exemple)
      const docs = post.attachments.filter((a) => a.type === 'document');
      if (docs.length > 0) {
        await sendAttachments(docs, 'document');
      }

      // send videos
      const videos = post.attachments.filter((a) => a.type === 'video');
      if (videos.length > 0) {
        await sendAttachments(videos, 'video');
      }

      // notif pour les autres objets (audio ?)
      const others = post.attachments.filter(
        (a) => !['image', 'document', 'video'].includes(a.type)
      );
      if (others.length > 0) {
        await throttle();
        await client('sendMessage', {
          body: {
            chat_id: config.telegram.chatId,
            parse_mode: 'MarkdownV2',
            text: `${others.length} objet${others.length > 1 ? 's' : ''} de type ${others
              .map((o) => o.type)
              .join(',')}`,
          },
        });
      }
    }
  };

  return { client, sendPostMessage, sendMessage };
}
