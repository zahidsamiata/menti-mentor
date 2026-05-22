'use client';

import { useState } from 'react';
import { useSession } from '@/hooks/useSession';
import { useMeetings, useUpdateMeetingStatus } from '@/hooks/useMeetings';
import { MeetingTimeline } from '@/components/meeting/MeetingTimeline';
import { FeedbackForm } from '@/components/feedback/FeedbackForm';
import { Skeleton } from '@/components/ui/skeleton';
import type { Meeting } from '@/types/api';

export default function MentorMeetingsPage() {
  const { session, loading } = useSession('MENTOR');
  const { data, isLoading } = useMeetings({ mentorId: session?.userId });
  const updateStatus = useUpdateMeetingStatus();
  const [feedbackMeeting, setFeedbackMeeting] = useState<Meeting | null>(null);

  if (loading || isLoading) return <Skeleton className="h-64 w-full" />;
  if (!session) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Toplantılarım</h1>

      <MeetingTimeline
        meetings={data?.items ?? []}
        role="MENTOR"
        onUpdateStatus={(id, status) => updateStatus.mutate({ id, status })}
        onFeedback={(m) => setFeedbackMeeting(m)}
        updatingId={updateStatus.isPending ? undefined : undefined}
      />

      {feedbackMeeting && (
        <FeedbackForm
          meeting={feedbackMeeting}
          role="MENTOR"
          onClose={() => setFeedbackMeeting(null)}
        />
      )}
    </div>
  );
}
