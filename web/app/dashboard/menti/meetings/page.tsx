'use client';

import { useState } from 'react';
import { useSession } from '@/hooks/useSession';
import { useUser } from '@/hooks/useUsers';
import { useMeetings, useUpdateMeetingStatus } from '@/hooks/useMeetings';
import { MeetingTimeline } from '@/components/meeting/MeetingTimeline';
import { FeedbackForm } from '@/components/feedback/FeedbackForm';
import { OrientationBadge } from '@/components/profile/OrientationBadge';
import { Skeleton } from '@/components/ui/skeleton';
import type { Meeting } from '@/types/api';

export default function MentiMeetingsPage() {
  const { session, loading } = useSession('MENTI');
  const { data: profile } = useUser(session?.userId ?? '');
  const { data, isLoading } = useMeetings({ mentiId: session?.userId });
  const updateStatus = useUpdateMeetingStatus();
  const [feedbackMeeting, setFeedbackMeeting] = useState<Meeting | null>(null);

  if (loading || isLoading) return <Skeleton className="h-64 w-full" />;
  if (!session) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Toplantılarım</h1>

      {profile?.needsOrientation && <OrientationBadge active />}

      <MeetingTimeline
        meetings={data?.items ?? []}
        role="MENTI"
        onUpdateStatus={(id, status) => updateStatus.mutate({ id, status })}
        onFeedback={(m) => setFeedbackMeeting(m)}
      />

      {feedbackMeeting && (
        <FeedbackForm
          meeting={feedbackMeeting}
          role="MENTI"
          onClose={() => setFeedbackMeeting(null)}
        />
      )}
    </div>
  );
}
