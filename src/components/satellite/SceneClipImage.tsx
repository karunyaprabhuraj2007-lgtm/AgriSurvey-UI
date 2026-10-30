import React from 'react';
import { ClipImageMode, SceneClip, clipUrl } from '@/lib/sentinel-cog';
import { fieldOutline } from '@/services/field-surveillance.service';

export type { ClipImageMode };

/** Rendered Sentinel-2 clip with the survey-area boundary drawn on top. */
export const SceneClipImage: React.FC<{ clip: SceneClip; mode: ClipImageMode; alt: string; className?: string }> = ({
  clip,
  mode,
  alt,
  className,
}) => {
  const b = clip.bounds;
  const points = fieldOutline(clip.area)
    .map(
      ([lat, lon]) =>
        `${(((lon - b.minLon) / (b.maxLon - b.minLon)) * 100).toFixed(2)},${(((b.maxLat - lat) / (b.maxLat - b.minLat)) * 100).toFixed(2)}`
    )
    .join(' ');
  return (
    <div className={`relative bg-black ${className ?? ''}`}>
      <img src={clipUrl(clip, mode)} alt={alt} className="w-full h-full object-contain" />
      <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polygon points={points} fill="none" stroke="#facc15" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
};
