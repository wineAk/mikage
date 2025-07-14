import { CardContent } from "~/components/ui/card";

export default function SpinnerCircleLarge({ className }: { className: string }) {
  return (
    <CardContent>
      <div className="h-64 w-full flex items-center justify-center">
        <div className={`animate-spin rounded-full h-16 w-16 border-8 ${className} border-t-gray-200`}/>
      </div>
    </CardContent>
  );
}
