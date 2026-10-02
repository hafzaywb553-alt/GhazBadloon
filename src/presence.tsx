import { useEffect, useState } from 'react';
import { api } from './firebase-api';
import { UserCheck } from 'lucide-react';

type OnlineUser = { userId: string; email?: string; name?: string; lastSeen?: string };
type PresencePayload = { count: number; users: OnlineUser[]; ttlSeconds?: number };

function getSessionId() {
  const key = 'finance_presence_session_id';
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : 's-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  sessionStorage.setItem(key, id);
  return id;
}

export function PresenceBar({ user }: { user: any }) {
  const [presence, setPresence] = useState<PresencePayload>({ count: 0, users: [] });

  useEffect(() => {
    let mounted = true;
    const sessionId = getSessionId();

    const refresh = async () => {
      try {
        const result = await api.get('/api/presence');
        if (mounted && result?.data) setPresence(result.data);
      } catch {}
    };

    const heartbeat = async () => {
      try {
        const result = await api.post('/api/presence/heartbeat', { sessionId });
        if (mounted && result?.data) setPresence(result.data);
      } catch {}
    };

    refresh();
    heartbeat();
    const timer = window.setInterval(heartbeat, 15_000);

    return () => {
      mounted = false;
      window.clearInterval(timer);
      api.post('/api/presence/offline', { sessionId }).catch(() => {});
    };
  }, [user?.userId]);

  const names = presence.users.slice(0, 4).map(u => u.name || u.email || 'کاروونکی');
  const extra = Math.max(0, presence.count - names.length);

  return (
    <div className="presence-bar" title={names.join('، ')}>
      <UserCheck size={17} />
      <b>{presence.count}</b>
      <span>کسان آنلاین</span>
      {names.length > 0 && <em>{names.join('، ')}{extra ? ` +${extra}` : ''}</em>}
    </div>
  );
}
