import IndexLoading from "./indexLoading";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "~/components/ui/dialog";
import { Sun, Moon } from "lucide-react";
import { useEffect, useState } from "react";
import { getColorListsFromKey } from "~/library/index/color";

export default function IndexLogin({ className }: { className: string }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    fetch(`/api/v1/targets`)
      .then((res) => res.json())
      .then((res) => setData(res.data));
  }, []);
  return (
    <Card className={`${className}`}>
      {data ? (
        <List data={data} />
      ) : (
        <IndexLoading className="border-neutral-800" />
      )}
    </Card>
  );
}

function List({ data }: { data: any[] }) {
  const [isDarkMode, setIsDarkMode] = useState(true);

  return (
    <>
      <CardHeader>
        <CardTitle>ログイン</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 md:grid-cols-5 xl:grid-cols-10 gap-2">
        {data.map((data) => {
          const { name, key } = data;
          const colorLists = getColorListsFromKey(key);
          const { border, bg, text, hoverBg } = colorLists;
          return (
            <Dialog key={key}>
              <DialogTrigger>
                <Button
                  key={key}
                  className={`${border} ${bg} ${text} ${hoverBg} cursor-pointer w-full`}
                >
                  {name}
                </Button>
              </DialogTrigger>
              <DialogContent
                className="grid-rows-[auto_1fr]"
                style={{
                  height: "calc(100vh - 10rem)",
                  maxWidth: "calc(100vw - 10rem)",
                }}
              >
                <DialogHeader>
                  <DialogTitle>{name} の画面</DialogTitle>
                </DialogHeader>
                <div className="relative w-full h-full">
                  <iframe
                    src={`/${key}`}
                    className={`w-full h-full rounded-md border ${
                      isDarkMode ? "bg-black text-white" : "bg-white text-black"
                    }`}
                    title={`${name} プレビュー`}
                    sandbox="allow-same-origin allow-scripts allow-forms"
                  />
                  <div className="absolute inset-0 bg-black/50 rounded-md">
                    <div className="flex flex-col items-center justify-center h-full">
                      <div className="text-white text-2xl font-bold">
                        🔒 この画面は表示専用です（操作できません）
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    className="absolute top-4 left-4 z-10 cursor-pointer"
                    onClick={() => setIsDarkMode(!isDarkMode)}
                  >
                    {isDarkMode ? (
                      <Sun className="h-4 w-4" />
                    ) : (
                      <Moon className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          );
        })}
      </CardContent>
    </>
  );
}
