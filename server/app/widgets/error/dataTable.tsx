import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  getFilteredRowModel,
} from "@tanstack/react-table";

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { ScrollArea, ScrollBar } from "~/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Badge } from "~/components/ui/badge";
import { Check, X, PlusCircle } from "lucide-react";

import { getColorListsFromKey } from "~/library/index/color";
import { useState, useMemo } from "react";

// --- Faceted Filter ---
type DataTableFacetedFilterProps = {
  selectedKeys: string[];
  setSelectedKeys: (keys: string[]) => void;
  title: string;
  data: any[];
};

function DataTableFacetedFilter({
  selectedKeys,
  setSelectedKeys,
  title,
  data,
}: DataTableFacetedFilterProps) {
  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  // target_keyごとにnameとcountを集計
  const options = useMemo(() => {
    const countMap = new Map<string, { name: string; count: number }>();
    data.forEach((item: any) => {
      const key = String(item.target_key);
      const name = String(item.name);
      if (!countMap.has(key)) {
        countMap.set(key, { name, count: 1 });
      } else {
        countMap.get(key)!.count++;
      }
    });
    return Array.from(countMap.entries()).map(([key, { name, count }]) => ({
      key,
      name,
      count,
    }));
  }, [data]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">
          <Badge className="rounded-full px-1 w-5 h-5 text-xs">
            {selectedSet.size}
          </Badge>
          {title}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0" align="start">
        <div className="p-2">
          {options.map((option) => {
            const isSelected = selectedSet.has(option.key);
            const bg = getColorListsFromKey(option.key).bg;
            return (
              <Button
                key={option.key}
                variant="ghost"
                className="w-full justify-start"
                onClick={() => {
                  const newSet = new Set(selectedSet);
                  isSelected
                    ? newSet.delete(option.key)
                    : newSet.add(option.key);
                  setSelectedKeys(Array.from(newSet));
                }}
              >
                <Check
                  className={`mr-2 h-4 w-4 ${
                    isSelected ? "opacity-100" : "opacity-0"
                  }`}
                />
                <span className={`w-2 h-2 rounded-full ${bg}`} />
                {option.name} ({option.count}件)
              </Button>
            );
          })}
        </div>
        {selectedSet.size > 0 && (
          <Button
            variant="ghost"
            className="w-full justify-start text-red-500"
            onClick={() => setSelectedKeys([])}
          >
            <X className="mr-2 h-4 w-4" />
            <span className="w-2 h-2 rounded-full bg-transparent" />
            クリア
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
}
export function DataTable<TData, TValue>({
  columns,
  data,
}: DataTableProps<TData, TValue>) {
  // 選択中の環境keyリスト
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  // フィルター済みデータ
  const filteredData = useMemo(
    () =>
      selectedKeys.length === 0
        ? data
        : data.filter((item: any) =>
            selectedKeys.includes(String(item.target_key))
          ),
    [data, selectedKeys]
  );

  const table = useReactTable({
    data: filteredData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const pageSize = table.getState().pagination.pageSize;
  const rowCount = table.getRowModel().rows.length;
  const emptyRows = pageSize - rowCount;

  return (
    <div className="space-y-4">
      <Header
        table={table}
        selectedKeys={selectedKeys}
        setSelectedKeys={setSelectedKeys}
        data={data}
      />
      <ScrollArea className=" relative pb-2 pr-2">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              <>
                {table.getRowModel().rows.map((row) => {
                  const original = row.original as any;
                  const { created_at } = original;
                  // 今日より前のデータか？
                  const checkBeforeToday = (date: string) => {
                    const checkedMs = Date.parse(String(date));
                    const todayStartMs = new Date().setHours(0, 0, 0, 0);
                    return checkedMs < todayStartMs;
                  };
                  const isBeforeToday = checkBeforeToday(created_at);
                  return (
                    <TableRow
                      key={row.id}
                      data-state={row.getIsSelected() && "selected"}
                      className={isBeforeToday ? "opacity-50" : ""}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} className="h-10">
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
                {/* 足りない分だけ空行を追加 */}
                {Array.from({ length: emptyRows > 0 ? emptyRows : 0 }).map(
                  (_, i) => (
                    <TableRow key={`empty-${i}`}>
                      {table.getAllColumns().map((col) => (
                        <TableCell key={col.id} className="h-10" />
                      ))}
                    </TableRow>
                  )
                )}
              </>
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
      <Footer table={table} />
    </div>
  );
}

interface HeaderProps {
  table: any;
  selectedKeys: string[];
  setSelectedKeys: (keys: string[]) => void;
  data: any[];
}

function Header({ table, selectedKeys, setSelectedKeys, data }: HeaderProps) {
  return (
    <div className="flex flex-wrap justify-between gap-4 w-full">
      <DataTableFacetedFilter
        selectedKeys={selectedKeys}
        setSelectedKeys={setSelectedKeys}
        title="環境"
        data={data}
      />
      <div className="flex items-center space-x-2">
        <p className="text-sm font-medium">表示</p>
        <Select
          value={`${table.getState().pagination.pageSize}`}
          onValueChange={(value) => {
            table.setPageSize(Number(value));
          }}
        >
          <SelectTrigger className="h-8 ">
            <SelectValue placeholder={table.getState().pagination.pageSize} />
          </SelectTrigger>
          <SelectContent side="top" align="end">
            {[10, 20, 30, 40, 50].map((pageSize) => (
              <SelectItem key={pageSize} value={`${pageSize}`}>
                {pageSize} 件
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

interface FooterProps {
  table: any;
}

function Footer({ table }: FooterProps) {
  return (
    <div className="flex justify-between gap-4 w-full">
      <div className="flex items-center space-x-2 w-full justify-end">
        <div className="flex items-center justify-center text-sm font-medium">
          {table.getState().pagination.pageIndex + 1} / {table.getPageCount()}{" "}
          ページ
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
          >
            <span className="sr-only">Go to first page</span>
            <ChevronsLeft />
          </Button>
          <Button
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <span className="sr-only">Go to previous page</span>
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <span className="sr-only">Go to next page</span>
            <ChevronRight />
          </Button>
          <Button
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
          >
            <span className="sr-only">Go to last page</span>
            <ChevronsRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
