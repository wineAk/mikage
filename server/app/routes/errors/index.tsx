import type { Route } from "./+types/index";
import type { Error } from "@/types/api";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardHeader, CardTitle } from "~/components/ui/card";
import SpinnerCircleLarge from "~/components/SpinnerCircleLarge";
import ErrorTable from "./components/table";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "エラー一覧 | サスケ監視ツール ミカゲ" },
    { name: "description", content: 'サスケを監視するツール"ミカゲ"です。' },
  ];
}

export default function ErrorsPage() {
  const [data, setData] = useState<Error | null>(null);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    fetch(`/api/v1/errors/${offset}`)
      .then((res) => res.json())
      .then((res) => {
        const { data, error } = res;
        if (error) {
          setData(null);
        } else {
          setData(data);
        }
      });
  }, [offset]);
  const handlePrev = () => setOffset((prev) => prev + 1);
  const handleNext = () => setOffset((prev) => Math.max(0, prev - 1));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>サーバーダウン</span>
          <div className="space-x-2 ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrev}
              disabled={!data || data.previous_month_count === 0}
              className="cursor-pointer"
            >
              前月
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleNext}
              disabled={!data || data.next_month_count === 0}
              className="cursor-pointer"
            >
              次月
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      {data && data.logs ? (
        <ErrorTable data={data.logs} />
      ) : (
        <SpinnerCircleLarge className="border-red-800" />
      )}
    </Card>
  );
}