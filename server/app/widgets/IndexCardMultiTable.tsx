import type { IndexCardMulti } from "@/types/indexCard";
import { getColorListsFromKey } from "~/library/index/color";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "~/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";

export default function IndexCardMultiTable({ data, rdsList, setRdsList, title }: { data: IndexCardMulti[]; rdsList: string[]; setRdsList: (value: string[]) => void; title: string }) {
  // 各rdsListごとに最大・最小・平均・中央値・パーセンタイルを計算するヨ！
  function calcStats(key: string) {
    const values = data
      .map(row => typeof row[key] === 'number' ? (row[key] as number) : null)
      .filter((v): v is number => v !== null);
    if (values.length === 0) return { max: 0, min: 0, avg: 0, median: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const max = Math.max(...values);
    const min = Math.min(...values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    return { max, min, avg, median };
  }

  return (
    <CardContent>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead></TableHead>
            <TableHead>キー</TableHead>
            <TableHead>最大</TableHead>
            <TableHead>最小</TableHead>
            <TableHead>平均</TableHead>
            <TableHead>中央値</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rdsList.map((key) => {
            const stats = calcStats(key);
            const bgColor = getColorListsFromKey(key).bg;
            return (
              <TableRow key={key}>
                <TableCell>
                  <span
                    className={`inline-block h-3 w-3 mt-1 rounded-sm ${bgColor}`}
                  />
                </TableCell>
                <TableCell>{key}</TableCell>
                <TableCell>{(Number(stats.max) / 1000).toFixed(2)} 秒</TableCell>
                <TableCell>{(Number(stats.min) / 1000).toFixed(2)} 秒</TableCell>
                <TableCell>{(Number(stats.avg) / 1000).toFixed(2)} 秒</TableCell>
                <TableCell>{(Number(stats.median) / 1000).toFixed(2)} 秒</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </CardContent>
  );
}