import { CardHeader, CardTitle, CardContent } from "~/components/ui/card";

export default function IndexLoading({ className }: { className: string }) {
  return (
    <>
      <CardHeader>
        <CardTitle>Loading...</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-32 md:h-48 xl:h-64 w-full flex items-center justify-center">
          <div
            className={`animate-spin rounded-full h-16 w-16 border-8 ${className} border-t-gray-200`}
          />
        </div>
      </CardContent>
    </>
  );
}
