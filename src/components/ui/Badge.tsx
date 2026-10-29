import React from 'react';
import { useOptionalLanguage } from '@/context/LanguageContext';
import { getStatusLabel } from '@/lib/dashboard-localizer';

export interface BadgeProps {
  status?: string;
  variant?: 'success' | 'warning' | 'error' | 'info' | 'default' | string;
  children?: React.ReactNode;
  className?: string;
  size?: 'sm' | 'md';
}

export const Badge: React.FC<BadgeProps> = ({
  status,
  variant,
  children,
  className = '',
  size = 'md',
}) => {
  // Falls back to Marathi when rendered outside LanguageContext
  const lang = useOptionalLanguage()?.language || 'mr';
  const getBadgeStyle = (st: string) => {
    switch (st) {
      case 'success':
      case 'APPROVED':
      case 'VERIFIED':
      case 'COMPLETED':
      case 'MATCHES':
      case 'delivered':
      case 'active':
      case 'SENT':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200 ring-emerald-500/10';

      case 'warning':
      case 'PENDING_TAHSILDAR_REVIEW':
      case 'PENDING_REVIEW':
      case 'ASSIGNED':
      case 'SCHEDULED':
      case 'IN_PROGRESS':
      case 'pending':
      case 'queued':
      case 'pending_approval':
      case 'pending_activation':
      case 'PROVIDER_UNAVAILABLE':
        return 'bg-amber-50 text-amber-700 border-amber-200 ring-amber-500/10';

      case 'info':
      case 'EVIDENCE_UPLOADED':
      case 'SUBMITTED_FOR_REVIEW':
      case 'SUBMITTED_FOR_INSPECTION':
      case 'CONSISTENT':
        return 'bg-teal-50 text-teal-700 border-teal-200 ring-teal-500/10';

      case 'ADDITIONAL_INFORMATION_REQUIRED':
      case 'ADDITIONAL_EVIDENCE_REQUIRED':
      case 'PARTIALLY_MATCHES':
      case 'REINSPECTION_REQUIRED':
        return 'bg-cyan-50 text-cyan-800 border-cyan-200 ring-cyan-500/10';

      case 'error':
      case 'REJECTED':
      case 'CANCELLED':
      case 'DOES_NOT_MATCH':
      case 'INCONSISTENT':
      case 'failed':
      case 'FAILED':
      case 'suspended':
        return 'bg-rose-50 text-rose-700 border-rose-200 ring-rose-500/10';

      case 'provider_unavailable':
        return 'bg-slate-100 text-slate-600 border-slate-200 ring-slate-500/10';

      default:
        return 'bg-slate-50 text-slate-700 border-slate-200 ring-slate-500/10';
    }
  };

  const formatText = (txt: string) => {
    return txt.replace(/_/g, ' ');
  };

  const sizeClass = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs';
  const resolvedKey = variant || status || 'default';

  return (
    <span
      className={`inline-flex items-center font-medium rounded-full border ring-1 ring-inset ${sizeClass} ${getBadgeStyle(
        resolvedKey
      )} ${className}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current mr-1.5 opacity-75 shrink-0" />
      <span>{children !== undefined ? children : getStatusLabel(status, lang as any) || formatText(status || '')}</span>
    </span>
  );
};
