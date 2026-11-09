import type { Route } from "./+types/index";
import IncidentsTable from "./components/table";
import { data, useNavigation, useSearchParams } from "react-router";
import { createPageHeaders, getPageCacheRevision, readErrors, readIncidents, readTargets } from "~/lib/pageQueries.server";
import { MAX_MONTH_OFFSET, readMonthOffset } from "~/lib/pageParams";
import { readConsistentPage } from "~/lib/pageSnapshot.server";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "インシデント | サスケ監視ツール ミカゲ" },
    { name: "description", content: 'サスケを監視するツール"ミカゲ"です。' },
  ];
}

export function headers({ loaderHeaders }: Route.HeadersArgs) { return loaderHeaders; }

export async function loader({ request }: Route.LoaderArgs) {
  const offset = readMonthOffset(new URL(request.url).searchParams.get("offset"));
  const checkedAt = new Date().toISOString();
  try {
    const [incidents, errors, targets] = await readConsistentPage(request, () => Promise.all([readIncidents(request, offset), readErrors(request, offset), readTargets(request)]));
    return data({ result: { incidents, errors, targets, checkedAt }, offset, cacheRevision: getPageCacheRevision(request), loadError: null }, { headers: createPageHeaders(request) });
  } catch {
    return data({ result: null, offset, cacheRevision: null, loadError: "インシデント情報を取得できませんでした。ページを再読み込みしてください。" }, { status: 503, headers: createPageHeaders(request) });
  }
}

export default function IncidentsPage({ loaderData }: Route.ComponentProps) {
  const { result, offset, loadError } = loaderData;
  const [, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const setOffset = (value: number) => setSearchParams(previous => {
    const next = new URLSearchParams(previous);
    next.set("offset", String(readMonthOffset(String(value))));
    return next;
  });
  return <>
    {loadError && <p role="alert" className="mb-2 text-red-700">{loadError}</p>}
    <IncidentsTable data={result} onPrevious={() => setOffset(offset + 1)} onNext={() => setOffset(Math.max(0, offset - 1))} canPrevious={offset < MAX_MONTH_OFFSET} canNext={offset > 0} isUpdating={navigation.state !== "idle"} />
  </>;
}
