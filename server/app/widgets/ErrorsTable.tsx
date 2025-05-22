import { useEffect, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "~/components/ui/card";
import { ScrollArea, ScrollBar } from "~/components/ui/scroll-area"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import CardLoading from "./CardLoading";
import { getColorListsFromKey } from "~/library/index/color";
import type { Error } from "@/types/api";

export default function CardTable({ className }: { className: string }) {
  const [data, setData] = useState<Error[] | null>(null);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    fetch(`/api/v1/errors/${offset}`)
      .then((res) => res.json())
      .then((res) => setData(res.data));
  }, [offset]);
  const handlePrev = () => setOffset((prev) => prev + 1);
  const handleNext = () => setOffset((prev) => Math.max(0, prev - 1));

  return (
    <Card className={`${className}`}>
      {data ? (
        <TableList
          data={data}
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
  data,
  offset,
  onPrev,
  onNext,
}: {
  data: Error[];
  offset: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const tableList = data.map((item, index) => {
    const {
      target_key,
      name,
      created_at,
      response_time,
      status_code,
      status_message,
      error_name,
      error_code,
    } = item;
    // 今日より前のデータか？
    const checkBeforeToday = (date: string) => {
      const checkedMs = Date.parse(String(date));
      const todayStartMs = new Date().setHours(0, 0, 0, 0);
      return checkedMs < todayStartMs;
    };
    const isBeforeToday = checkBeforeToday(created_at);
    return (
      <TableRow key={index} className={isBeforeToday ? "opacity-50" : ""}>
        <TableCell className="font-medium">
          {new Date(created_at).toLocaleTimeString("ja-JP", {
            timeZone: "Asia/Tokyo",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </TableCell>
        <TableCell>
          <Badge
            className={[
              getColorListsFromKey(target_key).bg,
              getColorListsFromKey(target_key).text,
            ].join(" ")}
          >
            {name}
          </Badge>
        </TableCell>
        <TableCell>{(Number(response_time) / 1000).toFixed(2)} 秒</TableCell>
        <TableCell>
          <div className="flex gap-2">
            <Badge variant="secondary" className="w-24 empty:hidden">
              {status_code}
            </Badge>
            <div>{status_message}</div>
          </div>
        </TableCell>
        <TableCell>
          <div className="flex gap-2">
            <Badge variant="secondary" className="w-24 empty:hidden">
              {error_code}
            </Badge>
            <div title={String(error_name)}>{error_name}</div>
          </div>
        </TableCell>
      </TableRow>
    );
  });
  return (
    <>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>サーバーダウン</span>
          <div className="space-x-2 ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={onPrev}
              disabled={tableList.length === 0}
              className="cursor-pointer"
            >
              前へ
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onNext}
              disabled={offset === 0}
              className="cursor-pointer"
            >
              次へ
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className=" relative pb-2 pr-2">
          <table className="w-full caption-bottom text-sm">
            <TableHeader className="sticky top-0 z-10 bg-white">
              <TableRow>
                <TableHead>日時</TableHead>
                <TableHead>環境</TableHead>
                <TableHead>読込速度</TableHead>
                <TableHead>ステータス</TableHead>
                <TableHead>エラー</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>{tableList}</TableBody>
          </table>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </CardContent>
    </>
  );
}
