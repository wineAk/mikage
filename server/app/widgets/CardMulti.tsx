import type { MargeLog } from "@/types/indexCard";
import type { Key, Target } from "@/types/api";

import { useState } from "react";

import { Button } from "~/components/ui/button";
import { CardHeader, CardTitle, Card } from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";

import CardMultiCharts from "./CardMultiCharts";
import SpinnerCircle from "./SpinnerCircle";
import SpinnerCircleLarge from "./SpinnerCircleLarge";
import { getColorListsFromKey } from "~/library/index/color";

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
          margeLogs.set(created_date_str, {
            created_at: created_date_str,
            [key]: response_time ?? 0,
          });
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
      <CardHeader>
        <CardTitle className="flex items-center justify-between h-8">
          <span>{title}</span>
          <Dialog>
            <DialogTrigger
              asChild
              className={title === "サスケ" ? "" : "hidden"}
            >
              <Button variant="outline" size="sm" className="cursor-pointer">
                設定
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>表示させる環境の設定</DialogTitle>
              </DialogHeader>
              {targets ? (
                <TargetsSetting
                  targets={targets}
                  defaultRdsList={defaultRdsList}
                  rdsList={rdsList}
                  setRdsList={setRdsList}
                />
              ) : (
                <SpinnerCircle className={colorLists.border} />
              )}
              <DialogFooter>
                <a
                  href="https://wiki.interpark.co.jp/67feee6d64ee9a19e3f75f44#envUsage"
                  target="_blank"
                  className="text-sm text-green-700 underline"
                >
                  ⚠️サスケが落ちた？ - インターパーク社内ナレッジ
                </a>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardTitle>
      </CardHeader>
      {margeLogs && targets ? (
        <CardMultiCharts
          targets={targets}
          margeLogs={margeLogs}
          rdsList={rdsList}
        />
      ) : (
        <SpinnerCircleLarge className={colorLists.border} />
      )}
    </Card>
  );
}

type TargetsSettingProps = {
  targets: Target[];
  defaultRdsList: string[];
  rdsList: string[];
  setRdsList: (rdsList: string[]) => void;
};

function TargetsSetting({ targets, defaultRdsList, rdsList, setRdsList }: TargetsSettingProps) {
  return (
    <>
      <div className="flex gap-2 mb-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            setRdsList(
              targets
                .filter(({ key }) => /^saaske/.test(key))
                .map((t) => t.key)
                .sort()
            )
          }
        >
          全選択
        </Button>
        <Button size="sm" variant="outline" onClick={() => setRdsList([])}>
          全解除
        </Button>
        <Button size="sm" variant="outline" onClick={() => setRdsList(defaultRdsList)} className="ml-auto">
          リセット
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 p-2">
        {targets.map(({ key, name }) => {
          if (!/^saaske/.test(key)) return null;
          const isChecked = rdsList.includes(key);
          return (
            <div className="flex items-center space-x-2" key={key}>
              <Switch
                id={key}
                checked={isChecked}
                onCheckedChange={() => {
                  if (isChecked) {
                    setRdsList(rdsList.filter((rds) => rds !== key).sort());
                  } else {
                    setRdsList([...rdsList, key].sort());
                  }
                }}
                className="cursor-pointer"
              />
              <Label htmlFor={key} className="cursor-pointer">
                {name}
              </Label>
            </div>
          );
        })}
      </div>
    </>
  );
}
