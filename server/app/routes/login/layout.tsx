import type { Route } from "./+types/layout";
import type { Target } from "@/types/api";

import { useState, useEffect } from "react";
import { NavLink, Outlet } from "react-router";
import { getColorListsFromKey } from "~/library/index/color";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

export async function loader() {
  const baseUrl = process.env.BASE_URL || "http://localhost:5173";
  const { data }: { data: Target[] } = await fetch(`${baseUrl}/api/v1/targets`).then((res) => res.json());
  return { targets: data };
}

export default function LoginLayout({ loaderData }: Route.ComponentProps) {
  const { targets } = loaderData;
  const [isDarkMode, setIsDarkMode] = useState(true);

  return (
    <Card>
      <CardHeader>
        <CardTitle>ログイン</CardTitle>
      </CardHeader>
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
    </Card>
  );
}
