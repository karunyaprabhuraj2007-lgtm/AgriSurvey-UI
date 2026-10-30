import React from 'react';
import { ImageOff } from 'lucide-react';
import { EvidenceFileRef, hasEvidenceFile, useEvidenceUrl } from '@/lib/evidence';

/**
 * A stored evidence photograph. Records without a file (seeded samples) and files that
 * are not on this device show an explicit placeholder — never a substitute picture.
 */
export const EvidenceImage: React.FC<{ record: EvidenceFileRef; className?: string; onOpen?: (url: string) => void }> = ({
  record,
  className = '',
  onOpen,
}) => {
  const { url, loading } = useEvidenceUrl(record);
  if (url) {
    return (
      <img
        src={url}
        alt={record.original_filename}
        className={`${className} ${onOpen ? 'cursor-zoom-in' : ''}`}
        onClick={onOpen ? () => onOpen(url) : undefined}
        loading="lazy"
      />
    );
  }
  return (
    <div className={`${className} flex flex-col items-center justify-center gap-1 bg-slate-100 text-slate-500 text-[10px] text-center p-2`}>
      <ImageOff className="w-5 h-5" />
      {loading
        ? 'Loading…'
        : hasEvidenceFile(record)
        ? 'Photograph not available on this device'
        : 'Sample record — no photograph on file'}
    </div>
  );
};
