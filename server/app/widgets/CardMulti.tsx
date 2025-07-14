import type { MargeLog } from "@/types/indexCard";
import type { Key, Target } from "@/types/api";

import { useState, useEffect } from "react";

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

const SAASKE_SAVE_KEY = "saaske_rds_list";

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
  const [rdsList, setRdsList] = useState<string[]>([]);
  const colorLists = getColorListsFromKey(defaultRdsList[0]);
  const margeLogs = logs ? mergeLogs(rdsList, logs) : null;

  useEffect(() => {
    if (title === "サスケ") {
      const saaskeRdsList = localStorage.getItem(SAASKE_SAVE_KEY);
      setRdsList(saaskeRdsList ? JSON.parse(saaskeRdsList) : defaultRdsList);
    } else {
      setRdsList(defaultRdsList);
    }
  }, [title, defaultRdsList]);
  
  return (
    <Card className={`${className}`}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between h-8">
          <span>{title}</span>
          {title === "サスケ" && targets && (
            <TargetsSetting
              targets={targets}
              defaultRdsList={defaultRdsList}
              rdsList={rdsList}
              setRdsList={setRdsList}
            />
          )}
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

function TargetsSetting({
  targets,
  defaultRdsList,
  rdsList,
  setRdsList,
}: TargetsSettingProps) {
  // ボタン、Switchクリックで現在の値を利用＆保存
  const handleClick = (list: string[]) => {
    setRdsList(list);
    localStorage.setItem(SAASKE_SAVE_KEY, JSON.stringify(list));
  }
  
  return (
    <>
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="cursor-pointer">
            設定
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>表示させる環境の設定</DialogTitle>
          </DialogHeader>
          <div className="flex gap-2 mb-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                handleClick(
                  targets
                    .filter(({ key }) => /^saaske/.test(key))
                    .map((t) => t.key)
                    .sort()
                )
              }
            >
              全選択
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleClick([])}>
              全解除
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleClick(defaultRdsList)}
              className="ml-auto"
            >
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
                        const newList = rdsList.filter((rds) => rds !== key).sort();
                        handleClick(newList);
                      } else {
                        const newList = [...rdsList, key].sort();
                        handleClick(newList);
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
    </>
  );
}
