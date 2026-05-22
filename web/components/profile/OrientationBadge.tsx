import { Alert, AlertDescription } from '@/components/ui/alert';

interface Props {
  active: boolean;
  compact?: boolean;
}

export function OrientationBadge({ active, compact = false }: Props) {
  if (!active) return null;

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
        🔒 Oryantasyon Kilidi
      </span>
    );
  }

  return (
    <Alert variant="destructive">
      <AlertDescription>
        <strong>Oryantasyon Kilidi Aktif.</strong> Hazırlık puanınız düşük olduğu için yeni toplantı
        talep edemezsiniz. Lütfen yöneticinizle iletişime geçin.
      </AlertDescription>
    </Alert>
  );
}
