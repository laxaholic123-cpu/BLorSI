import { useEffect, useState } from 'react';

/**
 * Returns elapsed time since `startedAt` as a "M:SS" string.
 * Updates every second while mounted. Returns "0:00" when startedAt is null.
 */
export function useTimer(startedAt: string | null): string {
  const [label, setLabel] = useState('0:00');

  useEffect(() => {
    if (!startedAt) {
      setLabel('0:00');
      return;
    }

    const tick = () => {
      const total = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
      const m = Math.floor(total / 60);
      const s = total % 60;
      setLabel(`${m}:${String(s).padStart(2, '0')}`);
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return label;
}
