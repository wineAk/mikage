import type { Target } from "@/types/api";

import { useState, useEffect } from "react";
import { NavLink, Outlet } from "react-router";
import { getColorListsFromKey } from "~/library/index/color";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import SpinnerCircleLarge from "~/widgets/SpinnerCircleLarge";

export default function LoginLayout() {
  const [targets, setTargets] = useState<Target[] | null>(null);
  useEffect(() => {
    fetch("/api/v1/targets")
      .then((res) => res.json())
      .then((res) => {
        const targets = res.data;
        setTargets(targets);
      });
  }, []);
  const [isDarkMode, setIsDarkMode] = useState(true);

  return (
    <Card>
      <CardHeader>
        <CardTitle>ログイン</CardTitle>
      </CardHeader>
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
