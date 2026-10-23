import type { Clip, Origin, Permission } from './types';

export const PERMISSION_LABELS: Record<Permission, string> = {
  own: '本人が撮影',
  granted: '権利者の許可あり',
  license: 'ライセンスで利用可',
  unknown: '許可は未確認',
};

export const emptyOrigin = (): Origin => ({
  title: '',
  url: '',
  rightsHolder: '',
  permission: 'unknown',
  license: '',
  note: '',
});

/** A recording made with the camera by the person signing. */
export const ownRecording = (): Origin => ({ ...emptyOrigin(), permission: 'own' });

/** Older clips carry no origin, so nobody has said they may be used. */
export const permissionOf = (clip: Clip): Permission => clip.origin?.permission ?? 'unknown';

/** True when someone has recorded why the sample may be used. */
export const isCleared = (clip: Clip): boolean => permissionOf(clip) !== 'unknown';

/** "手話講座 第1回（〇〇チャンネル、CC BY 4.0）", or a note that nothing was recorded. */
export function describeOrigin(origin: Origin | undefined): string {
  if (!origin) return '出典は未記入';
  const name = origin.title || origin.rightsHolder;
  const grounds = origin.permission === 'license' && origin.license ? origin.license : PERMISSION_LABELS[origin.permission];
  const detail = [origin.title && origin.rightsHolder ? origin.rightsHolder : '', grounds].filter(Boolean).join('、');
  return name ? `${name}（${detail}）` : grounds;
}

/** One line per distinct origin, with how many samples came from it: the credits of a vocabulary book. */
export function credits(clips: Clip[]): Array<Origin & { samples: number }> {
  const byKey = new Map<string, Origin & { samples: number }>();
  for (const clip of clips) {
    const o = clip.origin;
    if (!o || (!o.title && !o.rightsHolder && !o.url)) continue;
    const key = JSON.stringify([o.title, o.url, o.rightsHolder, o.permission, o.license]);
    const entry = byKey.get(key);
    if (entry) entry.samples++;
    else byKey.set(key, { ...o, samples: 1 });
  }
  return [...byKey.values()].sort((a, b) => b.samples - a.samples);
}
