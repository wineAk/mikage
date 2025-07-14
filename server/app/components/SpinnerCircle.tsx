export default function SpinnerCircle({ className }: { className: string }) {
  return (
    <div className={`w-7 h-7 border-[3px] border-secondary border-t-primary rounded-full animate-spin ${className}`} />
  );
}
