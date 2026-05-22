import { cn } from '@/lib/utils';
import type { DiscType } from '@/types/api';

export type DimKey = 'D' | 'I' | 'S' | 'C';

interface DiscMeta {
  label: string;
  desc: string;
  bg: string;
  text: string;
  border: string;
  barColor: string;
  dot: string;
}

export const DISC_META: Record<DiscType, DiscMeta> = {
  D: {
    label: 'Dominant',
    desc: 'Kararlı Lider',
    bg: 'bg-red-50',
    text: 'text-red-700',
    border: 'border-red-200',
    barColor: '#ef4444',
    dot: 'bg-red-500',
  },
  I: {
    label: 'Etkili',
    desc: 'İlham Verici',
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-200',
    barColor: '#f59e0b',
    dot: 'bg-amber-400',
  },
  S: {
    label: 'Kararlı',
    desc: 'Güvenilir Destekçi',
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    barColor: '#10b981',
    dot: 'bg-emerald-500',
  },
  C: {
    label: 'Vicdanlı',
    desc: 'Analitik Düşünür',
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    border: 'border-blue-200',
    barColor: '#3b82f6',
    dot: 'bg-blue-500',
  },
};

interface DiscBadgeProps {
  discType: DiscType;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  showDesc?: boolean;
  className?: string;
}

export function DiscBadge({ discType, size = 'sm', showLabel = true, showDesc = false, className }: DiscBadgeProps) {
  const meta = DISC_META[discType];

  if (size === 'xs') {
    return (
      <span className={cn('inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full border', meta.bg, meta.text, meta.border, className)}>
        <span className={cn('w-1.5 h-1.5 rounded-full', meta.dot)} />
        {discType}
      </span>
    );
  }

  if (size === 'sm') {
    return (
      <span className={cn('inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border', meta.bg, meta.text, meta.border, className)}>
        <span className={cn('w-2 h-2 rounded-full', meta.dot)} />
        DISC-{discType} {showLabel && `— ${meta.label}`}
      </span>
    );
  }

  if (size === 'md') {
    return (
      <div className={cn('inline-flex flex-col gap-0.5 px-3 py-2 rounded-xl border', meta.bg, meta.border, className)}>
        <div className="flex items-center gap-1.5">
          <span className={cn('w-3 h-3 rounded-full', meta.dot)} />
          <span className={cn('text-sm font-bold', meta.text)}>DISC-{discType}</span>
        </div>
        {showLabel && <span className={cn('text-xs font-medium', meta.text)}>{meta.label}</span>}
        {showDesc && <span className="text-xs text-slate-500">{meta.desc}</span>}
      </div>
    );
  }

  // lg
  return (
    <div className={cn('flex items-center gap-3 px-4 py-3 rounded-2xl border', meta.bg, meta.border, className)}>
      <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center text-lg font-black text-white', meta.dot)}>
        {discType}
      </div>
      <div>
        <p className={cn('text-base font-bold', meta.text)}>{meta.label}</p>
        <p className="text-xs text-slate-500">{meta.desc}</p>
      </div>
    </div>
  );
}

// Vektör mini bar chart — D/I/S/C değerlerini dikey çubuk olarak gösterir
interface DiscVectorBarsProps {
  vector: Record<string, number>;
  height?: number;
  className?: string;
}

export function DiscVectorBars({ vector, height = 40, className }: DiscVectorBarsProps) {
  const dims: DimKey[] = ['D', 'I', 'S', 'C'];
  const max = Math.max(...dims.map((d) => vector[d] ?? 0), 0.01);

  return (
    <div className={cn('flex items-end gap-1', className)}>
      {dims.map((dim) => {
        const val = vector[dim] ?? 0;
        const barH = Math.round((val / max) * height);
        const meta = DISC_META[dim];
        return (
          <div key={dim} className="flex flex-col items-center gap-0.5">
            <div
              style={{ height: `${barH}px`, backgroundColor: meta.barColor }}
              className="w-5 rounded-t transition-all"
            />
            <span className="text-[9px] font-bold text-slate-500">{dim}</span>
          </div>
        );
      })}
    </div>
  );
}
