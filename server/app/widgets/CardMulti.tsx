import type { MargeLog } from "@/types/indexCard";
import type { Key, Target } from "@/types/api";

import { Card } from "~/components/ui/card";
import CardMultiCharts from "./CardMultiCharts";
import CardLoading from "./CardLoading";
import { getColorListsFromKey } from "~/library/index/color";
import { useState } from "react";

function mergeLogs(keys: string[], logs: Key[]): MargeLog[] {
  const margeLogs: Map<string, MargeLog> = new Map();
  for (const key of keys) {
    const findedLogs = logs.find((log) => log.key === key);
    if (findedLogs) {
      for (const log of findedLogs.logs) {
        const { created_at, response_time } = log;
        const created_date = new Date(created_at);
        created_date.setSeconds(0);
        created_date.setMilliseconds(0);
        const created_date_str = created_date.toISOString();
        if (margeLogs.has(created_date_str)) {
          margeLogs.get(created_date_str)![key] = response_time ?? 0;
        } else {
          margeLogs.set(created_date_str, { created_at: created_date_str, [key]: response_time ?? 0 });
        }
      }
    }
  }
  return Array.from(margeLogs.values());
}

type CardMultiProps = {
  title: string;
  className?: string;
  logs: Key[] | null;
  targets: Target[] | null;
  defaultRdsList: string[];
};

export default function CardMulti({
  title,
  className,
  logs,
  targets,
  defaultRdsList,
}: CardMultiProps) {  
  const [rdsList, setRdsList] = useState<string[]>(defaultRdsList);
  const colorLists = getColorListsFromKey(defaultRdsList[0]);
  const margeLogs = logs ? mergeLogs(rdsList, logs) : null;

  return (
    <Card className={`${className}`}>
      {margeLogs && targets ? (
        <CardMultiCharts
          targets={targets}
          margeLogs={margeLogs}
          rdsList={rdsList}
          setRdsList={setRdsList}
          title={title}
        />
      ) : (
        <CardLoading className={colorLists.border} />
      )}
    </Card>
  );
}
