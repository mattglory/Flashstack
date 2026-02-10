interface StatCardProps {
  label: string;
  value: string;
  subtext?: string;
}

export function StatCard({ label, value, subtext }: StatCardProps) {
  return (
    <div className="bg-surface-card border border-surface-border rounded-xl p-5">
      <p className="text-sm text-slate-400 mb-1">{label}</p>
      <p className="text-2xl font-bold text-white">{value}</p>
      {subtext && (
        <p className="text-xs text-slate-500 mt-1">{subtext}</p>
      )}
    </div>
  );
}
