export function computeOverheadPct(args: { baselineMs: number; profiledMs: number }): number {
  if (args.baselineMs <= 0) {
    return 0;
  }

  return ((args.profiledMs - args.baselineMs) / args.baselineMs) * 100;
}
