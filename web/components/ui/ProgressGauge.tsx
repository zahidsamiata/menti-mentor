import { cn } from '@/lib/utils';

interface ProgressGaugeProps {
  value: number;      // 0–100
  label?: string;
  sublabel?: string;
  color?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function ProgressGauge({
  value,
  label,
  sublabel,
  color = '#6366f1',
  size = 'md',
  className,
}: ProgressGaugeProps) {
  const r = 36;
  const cx = 50;
  const cy = 52;

  // Yarım daire yayı — sol (10, cy) → sağ (90, cy) tepeden geçerek
  const halfCircumference = Math.PI * r; // ≈ 113.1

  const clampedVal = Math.max(0, Math.min(100, value));
  const strokeDash = (clampedVal / 100) * halfCircumference;
  const strokeGap = halfCircumference - strokeDash;

  const trackPath = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;

  const sizeMap = {
    sm: 'w-24',
    md: 'w-32',
    lg: 'w-44',
  };

  const fontSizeMap = {
    sm: 14,
    md: 18,
    lg: 24,
  };

  return (
    <div className={cn('flex flex-col items-center', className)}>
      <svg viewBox="0 0 100 60" className={cn(sizeMap[size])}>
        {/* Track */}
        <path
          d={trackPath}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth="8"
          strokeLinecap="round"
        />
        {/* Progress */}
        {clampedVal > 0 && (
          <path
            d={trackPath}
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${strokeDash} ${strokeGap + halfCircumference}`}
          />
        )}
        {/* Center value */}
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          fontSize={fontSizeMap[size]}
          fontWeight="700"
          fill="#1e293b"
        >
          {clampedVal}
        </text>
        {label && (
          <text x={cx} y={cy + 8} textAnchor="middle" fontSize="7" fill="#64748b">
            {label}
          </text>
        )}
      </svg>
      {sublabel && (
        <p className="text-xs text-slate-500 text-center -mt-1">{sublabel}</p>
      )}
    </div>
  );
}

// Düz yatay progress bar
interface ProgressBarProps {
  value: number;
  color?: string;
  label?: string;
  showValue?: boolean;
  className?: string;
}

export function ProgressBar({ value, color = '#6366f1', label, showValue = true, className }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className={cn('space-y-1', className)}>
      {(label || showValue) && (
        <div className="flex justify-between text-xs text-slate-600">
          {label && <span>{label}</span>}
          {showValue && <span className="font-medium">{clamped}%</span>}
        </div>
      )}
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${clamped}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
