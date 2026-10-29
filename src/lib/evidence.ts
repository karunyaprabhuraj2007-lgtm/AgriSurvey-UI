import { useEffect, useState } from 'react';
import { getMediaUrl } from './media-store';

export interface EvidenceFileRef {
  media_id?: string;
  image_url?: string;
  original_filename: string;
}

/** True when a record points at an actual stored photograph. */
export const hasEvidenceFile = (r: Pick<EvidenceFileRef, 'media_id' | 'image_url'>) => Boolean(r.media_id || r.image_url);

/** Resolve a record's photograph: local copy first (works offline), then the cloud URL. */
export function useEvidenceUrl(r: EvidenceFileRef | null | undefined): { url: string | null; loading: boolean } {
  const [state, setState] = useState<{ key: string; url: string | null } | null>(null);
  const key = r ? `${r.media_id ?? ''}|${r.image_url ?? ''}` : '';
  useEffect(() => {
    if (!r?.media_id) return;
    let cancelled = false;
    getMediaUrl(r.media_id).then((u) => !cancelled && setState({ key, url: u }));
    return () => {
      cancelled = true;
    };
  }, [key, r?.media_id]);
  if (!r || !hasEvidenceFile(r)) return { url: null, loading: false };
  if (!r.media_id) return { url: r.image_url ?? null, loading: false };
  if (state?.key !== key) return { url: null, loading: true };
  return { url: state.url ?? r.image_url ?? null, loading: false };
}

