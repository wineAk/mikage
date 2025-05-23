import { useEffect, useState } from "react";
import type { KeyLog, Key, Error, Incident, Target } from "@/types/api";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "~/components/ui/accordion";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "~/components/ui/card";
import { ScrollArea, ScrollBar } from "~/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { Calendar, Check, Clock, Flame } from "lucide-react";

import SpinnerCircleLarge from "./SpinnerCircleLarge";
import { getColorListsFromKey } from "~/library/index/color";

type IncidentsTableProps = {
  className?: string;
  targets: Target[] | null;
};

type IncidentError = Incident & {
  errors: Error[];
};

type TimelineItem = {
  incident: IncidentError;
  groupedErrors: Record<string, Error[]>;
  created_date: string;
  updated_date: string;
  hours: number;
  minutes: number;
  is_closed: boolean;
  is_today: boolean;
  targetNames: Record<string, string | undefined>;
};

export default function IncidentsTable({
  className,
  targets,
}: IncidentsTableProps) {
  const [offset, setOffset] = useState(0);
  const handlePrev = () => setOffset((prev) => prev + 1);
  const handleNext = () => setOffset((prev) => Math.max(0, prev - 1));

  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  useEffect(() => {
    fetch(`/api/v1/incidents/${offset}`)
      .then((res) => res.json())
      .then((res) => setIncidents(res.data));
  }, [offset]);

  const [errors, setErrors] = useState<Error[] | null>(null);
  useEffect(() => {
    fetch(`/api/v1/errors/${offset}`)
      .then((res) => res.json())
      .then((res) => setErrors(res.data));
  }, [offset]);

  // incidentのデータをもとに、errorsのデータを取得する
  const [incidentsErrors, setIncidentsErrors] = useState<
    IncidentError[] | null
  >(null);
  useEffect(() => {
    if (!incidents || !errors) return;
    const incidentsErrors = incidents.map((incident) => {
      const { keyword, created_at, updated_at } = incident;
      const created_date = new Date(created_at);
      created_date.setSeconds(0, 0);
      const updated_date = new Date(updated_at);
      const filtered = errors.filter((error) => {
        const { target_key, created_at } = error;
        // keywordで始まるtarget_keyだけ抽出
        if (!target_key.startsWith(keyword)) return false;
        // 日付がincidentの日付の範囲内にあるものだけ抽出
        const error_date = new Date(created_at);
        return error_date >= created_date && error_date <= updated_date;
      });
      const incidentsError = { ...incident, errors: filtered };
      return incidentsError;
    });
    setIncidentsErrors(incidentsErrors);
  }, [incidents, errors]);

  // タイムライン用の配列を作成する
  const [timeline, setTimeline] = useState<TimelineItem[] | null>(null);
  useEffect(() => {
    if (!incidentsErrors || !targets) return;
    const timelineData = incidentsErrors.map((incidentErrors) => {
      const { keyword, created_at, updated_at, is_closed, errors } =
        incidentErrors;
      const createdDateObj = new Date(created_at);
      const updatedDateObj = is_closed ? new Date(updated_at) : new Date();
      const diffMs = updatedDateObj.getTime() - createdDateObj.getTime();
      const diffMinutes = Math.ceil(diffMs / 1000 / 60);
      const hours = Math.floor(diffMinutes / 60);
      const minutes = diffMinutes % 60;
      const groupedErrors = errors.reduce((acc, error) => {
        if (!acc[error.target_key]) acc[error.target_key] = [];
        acc[error.target_key].push(error);
        return acc;
      }, {} as Record<string, Error[]>);
      const targetNames = Object.fromEntries(
        Object.keys(groupedErrors).map((key) => [
          key,
          targets.find((t) => t.key === key)?.name,
        ])
      );
      return {
        incident: incidentErrors,
        groupedErrors,
        created_date: createdDateObj.toLocaleString("ja-JP", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        }),
        updated_date: updatedDateObj.toLocaleString("ja-JP", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        }),
        hours,
        minutes,
        is_closed: !!is_closed,
        is_today:
          createdDateObj.toLocaleDateString("ja-JP") ===
          new Date().toLocaleDateString("ja-JP"),
        targetNames,
      };
    });
    setTimeline(timelineData);
  }, [incidentsErrors, targets]);

  return (
    <Card className={`${className}`}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>サーバーダウン</span>
          <div className="space-x-2 ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrev}
              disabled={timeline?.length === 0}
              className="cursor-pointer"
            >
              前へ
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleNext}
              disabled={offset === 0}
              className="cursor-pointer"
            >
              次へ
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      {timeline && targets ? (
        <CardContent>
          <Timeline timeline={timeline} />
        </CardContent>
      ) : (
        <SpinnerCircleLarge className="border-red-800" />
      )}
    </Card>
  );
}

function Timeline({ timeline }: { timeline: TimelineItem[] }) {
  return (
    <div className="">
      <div className="relative ml-3">
        <div className="absolute left-0 top-4 bottom-0 border-l-2" />
        {[...timeline].reverse().map((item, incidentIndex) => {
          const {
            incident,
            groupedErrors,
            created_date,
            updated_date,
            hours,
            minutes,
            is_closed,
            is_today,
            targetNames,
          } = item;
          const { keyword } = incident;
          const titles = {
            saaske: "サスケ",
            works: "Works",
            web: "ホームページ",
          };
          const bgColor = is_closed ? "bg-green-100" : "bg-red-100";
          const textColor = is_closed ? "text-green-800" : "text-red-800";
          const StatusIcon = is_closed ? Check : Flame;
          const StatusText = is_closed ? "closed" : "down";
          return (
            <div key={incidentIndex} className="relative pl-8 pb-12 last:pb-0">
              <div className="absolute h-3 w-3 -translate-x-1/2 left-px top-2 rounded-full border-2 border-primary bg-background" />
              <div className="space-y-4">
                <h3
                  className={`text-lg sm:text-xl font-semibold flex items-center gap-2`}
                >
                  <Badge className={`gap-1.5 ${bgColor}`}>
                    <StatusIcon className={`${textColor}`} />
                    <span className={`${textColor}`}>{StatusText}</span>
                  </Badge>
                  {is_today && (
                    <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                      New
                    </Badge>
                  )}
                  <span>{titles[keyword as keyof typeof titles]}</span>
                </h3>
                <div className="sm:flex sm:items-center sm:gap-4 sm:space-y-0 space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="h-4 w-4" />
                    <span>{created_date}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="h-4 w-4" />
                    <span>
                      {hours > 0 && `${hours}時間 ${minutes}分`}
                      {hours === 0 && `${minutes}分間`}
                    </span>
                  </div>
                </div>
                <Accordion type="multiple" className="max-w-lg w-full">
                  {Object.entries(groupedErrors)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([target_key, errorList], index) => {
                      const bgColor = getColorListsFromKey(target_key).bg;
                      const textColor = getColorListsFromKey(target_key).text;
                      const target_name = targetNames[target_key];
                      return (
                        <AccordionItem
                          key={index}
                          value={`item-${index}`}
                          className="border border-b-0 last:border-b first:rounded-t-md last:rounded-b-md"
                        >
                          <AccordionTrigger className="cursor-pointer px-4 hover:no-underline">
                            <div className="flex items-center gap-2">
                              <Badge className={`${bgColor} ${textColor}`}>
                                {errorList.length}件
                              </Badge>
                              {target_name}
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="p-0">
                            {errorList.map((error, i) => (
                              <div
                                key={i}
                                className="p-4 space-y-2 border-t-1 border-neutral-200"
                              >
                                <div>
                                  {new Date(
                                    error.created_at
                                  ).toLocaleTimeString("ja-JP", {
                                    timeZone: "Asia/Tokyo",
                                    year: "numeric",
                                    month: "2-digit",
                                    day: "2-digit",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    second: "2-digit",
                                  })}
                                </div>
                                <div className="flex gap-2">
                                  <Badge
                                    variant="secondary"
                                    className="w-24 empty:hidden"
                                  >
                                    {error.status_code}
                                  </Badge>
                                  <div>{error.status_message}</div>
                                </div>
                                <div className="flex gap-2">
                                  <Badge
                                    variant="secondary"
                                    className="w-24 empty:hidden"
                                  >
                                    {error.error_code}
                                  </Badge>
                                  <div title={String(error.error_name)}>
                                    {error.error_name}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </AccordionContent>
                        </AccordionItem>
                      );
                    })}
                </Accordion>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
