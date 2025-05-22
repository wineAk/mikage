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

import CardLoading from "./CardLoading";
import { getColorListsFromKey } from "~/library/index/color";

type IncidentsTableProps = {
  className?: string;
  targets: Target[];
};

type IncidentError = Incident & {
  errors: Error[];
};

export default function IncidentsTable({
  className,
  targets,
}: IncidentsTableProps) {
  const [offset, setOffset] = useState(0);
  const handlePrev = () => setOffset((prev) => prev + 1);
  const handleNext = () => setOffset((prev) => Math.max(0, prev - 1));

  const [incidents, setIncidents] = useState<Incident[]>([]);
  useEffect(() => {
    fetch(`/api/v1/incidents/${offset}`)
      .then((res) => res.json())
      .then((res) => setIncidents(res.data));
  }, [offset]);

  const [errors, setErrors] = useState<Error[]>([]);
  useEffect(() => {
    fetch(`/api/v1/errors/${offset}`)
      .then((res) => res.json())
      .then((res) => setErrors(res.data));
  }, [offset]);

  // incidentのデータをもとに、errorsのデータを取得する
  const [incidentsErrors, setIncidentsErrors] = useState<IncidentError[]>([]);
  useEffect(() => {
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

  return (
    <Card className={`${className}`}>
      {incidentsErrors ? (
        <TableList
          incidentsErrors={incidentsErrors}
          targets={targets}
          offset={offset}
          onPrev={handlePrev}
          onNext={handleNext}
        />
      ) : (
        <CardLoading className="border-red-800" />
      )}
    </Card>
  );
}

function TableList({
  incidentsErrors,
  targets,
  offset,
  onPrev,
  onNext,
}: {
  incidentsErrors: IncidentError[];
  targets: Target[];
  offset: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>サーバーダウン</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Timeline incidentsErrors={incidentsErrors} targets={targets} />
      </CardContent>
    </>
  );
}

function Timeline({
  incidentsErrors,
  targets,
}: {
  incidentsErrors: IncidentError[];
  targets: Target[];
}) {
  return (
    <div className="space-y-12">
      {[...incidentsErrors].reverse().map((incidentErrors, incidentIndex) => {
        const { keyword, created_at, updated_at, is_closed, errors } =
          incidentErrors;
        const titles = {
          saaske: "サスケ",
          works: "Works",
          web: "ホームページ",
        };
        const bgColor = is_closed ? "bg-green-100" : "bg-red-100";
        const textColor = is_closed ? "text-green-800" : "text-red-800";
        const Icon = is_closed ? Check : Flame;

        // 日付を表示
        const created_date = new Date(created_at).toLocaleString("ja-JP", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });
        const updated_date = new Date(updated_at).toLocaleString("ja-JP", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });

        // 継続時間を計算
        const createdDateObj = new Date(created_at);
        const updatedDateObj = is_closed ? new Date(updated_at) : new Date();
        const diffMs = updatedDateObj.getTime() - createdDateObj.getTime();
        const diffMinutes = Math.floor(diffMs / 1000 / 60);
        const hours = Math.floor(diffMinutes / 60);
        const minutes = diffMinutes % 60;

        // ここでerrorsをグループ化！
        const groupedErrors = errors.reduce((acc, error) => {
          if (!acc[error.target_key]) acc[error.target_key] = [];
          acc[error.target_key].push(error);
          return acc;
        }, {} as Record<string, Error[]>);

        return (
          <div key={incidentIndex} className="">
            {/* Content */}
            <div className="space-y-4">
              <h3
                className={`text-lg sm:text-xl font-semibold flex items-center gap-2`}
              >
                <Badge className={`gap-1.5 ${bgColor}`}>
                  <Icon className={`${textColor}`} />
                  <span className={`${textColor}`}>
                    {is_closed ? "closed" : "down"}
                  </span>
                </Badge>
                <span>
                  {titles[keyword as keyof typeof titles]}
                </span>
              </h3>
              <div className="sm:flex sm:items-center sm:gap-4 sm:space-y-0 space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="h-4 w-4" />
                  <span>{created_date}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4" />
                  <span>
                    {hours > 0 && `${hours}時間`}
                    {minutes + 1}分間
                  </span>
                </div>
              </div>
              <Accordion type="multiple" className="max-w-lg my-4 w-full">
                {Object.entries(groupedErrors)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([target_key, errorList], index) => {
                    const bgColor = getColorListsFromKey(target_key).bg;
                    const textColor = getColorListsFromKey(target_key).text;
                    const target = targets.find(
                      (target) => target.key === target_key
                    );
                    const target_name = target?.name;

                    return (
                      <AccordionItem
                        key={index}
                        value={`item-${index}`}
                        className="border border-b-0 last:border-b first:rounded-t-md last:rounded-b-md"
                      >
                        <AccordionTrigger className="cursor-pointer px-4">
                          <div className="flex items-center gap-2">
                            <Badge className={`${bgColor} ${textColor}`}>{errorList.length}件</Badge>
                            {target_name}
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          {errorList.map((error, i) => (
                            <div key={i} className="px-4 py-2 space-y-2 border-t-1 border-neutral-200">
                              <div>
                                {new Date(error.created_at).toLocaleTimeString(
                                  "ja-JP",
                                  {
                                    timeZone: "Asia/Tokyo",
                                    year: "numeric",
                                    month: "2-digit",
                                    day: "2-digit",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    second: "2-digit",
                                  }
                                )}
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
  );
}
