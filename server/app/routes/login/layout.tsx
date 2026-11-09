import type { Route } from "./+types/layout";

import { useState } from "react";
import { data, NavLink, Outlet } from "react-router";
import { getColorListsFromKey } from "~/library/index/color";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import SpinnerCircleLarge from "~/components/SpinnerCircleLarge";
import { createPageHeaders, getPageCacheRevision, readTargets } from "~/lib/pageQueries.server";
import { readConsistentPage } from "~/lib/pageSnapshot.server";

export function headers({ loaderHeaders }: Route.HeadersArgs) { return loaderHeaders; }

export function shouldRevalidate() { return true; }

export async function loader({ request }: Route.LoaderArgs) {
  try {
    const targets = await readConsistentPage(request, () => readTargets(request));
    return data({ targets, cacheRevision: getPageCacheRevision(request), loadError: null }, { headers: createPageHeaders(request) });
  } catch {
    return data({ targets: null, cacheRevision: null, loadError: "監視対象を取得できませんでした。ページを再読み込みしてください。" }, { status: 503, headers: createPageHeaders(request) });
  }
}

export default function LoginLayout({ loaderData }: Route.ComponentProps) {
  const { targets, loadError } = loaderData;
  const [isDarkMode, setIsDarkMode] = useState(true);

  return (
    <Card>
      <CardHeader>
        <CardTitle>ログイン</CardTitle>
      </CardHeader>
      {loadError && <p role="alert" className="px-6 text-red-700">{loadError}</p>}
      {targets ? (
        <CardContent className="space-y-6">
          <nav className="grid grid-cols-6 gap-2">
            {targets &&
              targets.map((target) => {
                const { name, key } = target;
                const colorLists = getColorListsFromKey(key);
                const { border, bg, text, hoverBg } = colorLists;
                return (
                  <Button key={key} asChild variant="secondary">
                    <NavLink
                      to={`/login/${key}`}
                      className="flex items-center gap-2 aria-[current=page]:bg-neutral-200"
                    >
                      <span className={`w-2 h-2 rounded-full ${bg}`} />
                      <span className="text-xs">{name}</span>
                    </NavLink>
                  </Button>
                );
              })}
          </nav>
          <Outlet context={{ isDarkMode, setIsDarkMode }} />
        </CardContent>
      ) : (
        <SpinnerCircleLarge className="border-neutral-800" />
      )}
    </Card>
  );
}
