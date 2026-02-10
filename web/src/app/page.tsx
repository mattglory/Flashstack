import { ProtocolStats } from "@/components/dashboard/ProtocolStats";
import { UserStats } from "@/components/dashboard/UserStats";

export default function DashboardPage() {
  return (
    <div className="max-w-5xl space-y-8">
      <ProtocolStats />
      <UserStats />
    </div>
  );
}
