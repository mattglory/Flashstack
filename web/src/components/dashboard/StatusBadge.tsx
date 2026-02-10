interface StatusBadgeProps {
  paused: boolean;
}

export function StatusBadge({ paused }: StatusBadgeProps) {
  if (paused) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-400">
        <span className="w-2 h-2 rounded-full bg-red-400" />
        Paused
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-green-500/10 text-green-400">
      <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse-slow" />
      Active
    </span>
  );
}
