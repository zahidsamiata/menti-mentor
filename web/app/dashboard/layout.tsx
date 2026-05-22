import { Sidebar } from '@/components/layout/Sidebar';
import { MicroAssessmentWidget } from '@/components/assessment/MicroAssessmentWidget';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-4 lg:p-6">
        {children}
      </main>
      <MicroAssessmentWidget />
    </div>
  );
}
