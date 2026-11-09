import type { Route } from "./+types/index";
import { data, useSearchParams } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardHeader, CardTitle } from "~/components/ui/card";
import SpinnerCircleLarge from "~/components/SpinnerCircleLarge";
import ErrorTable from "./components/table";
import { createPageHeaders, getPageCacheRevision, readErrors } from "~/lib/pageQueries.server";
import { MAX_MONTH_OFFSET, readMonthOffset } from "~/lib/pageParams";
import { readConsistentPage } from "~/lib/pageSnapshot.server";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "エラー一覧 | サスケ監視ツール ミカゲ" },
    { name: "description", content: 'サスケを監視するツール"ミカゲ"です。' },
  ];
}

export function headers({ loaderHeaders }: Route.HeadersArgs) { return loaderHeaders; }

export async function loader({ request }: Route.LoaderArgs) {
  const offset = readMonthOffset(new URL(request.url).searchParams.get("offset"));
  try {
    const errors = await readConsistentPage(request, () => readErrors(request, offset));
    return data({ errors, offset, cacheRevision: getPageCacheRevision(request), loadError: null }, { headers: createPageHeaders(request) });
  } catch {
    return data({ errors: null, offset, cacheRevision: null, loadError: "エラー情報を取得できませんでした。ページを再読み込みしてください。" }, { status: 503, headers: createPageHeaders(request) });
  }
}

export default function ErrorsPage({ loaderData }: Route.ComponentProps) {
  const { errors: errorData, offset, loadError } = loaderData;
  const [, setSearchParams] = useSearchParams();
  const setOffset = (value: number) => setSearchParams(previous => {
    const next = new URLSearchParams(previous);
    next.set("offset", String(readMonthOffset(String(value))));
    return next;
  });
  const handlePrev = () => setOffset(offset + 1);
  const handleNext = () => setOffset(Math.max(0, offset - 1));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>サーバーダウン</span>
          <div className="space-x-2 ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrev}
              disabled={!errorData || errorData.previous_month_count === 0 || offset >= MAX_MONTH_OFFSET}
              className="cursor-pointer"
            >
              前月
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleNext}
              disabled={!errorData || errorData.next_month_count === 0 || offset === 0}
              className="cursor-pointer"
            >
              次月
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      {loadError && <p role="alert" className="px-6 text-red-700">{loadError}</p>}
      {errorData && errorData.logs ? (
        <ErrorTable data={errorData.logs} />
      ) : (
        <SpinnerCircleLarge className="border-red-800" />
      )}
    </Card>
  );
}
