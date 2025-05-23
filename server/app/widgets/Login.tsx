import type { Target } from "@/types/api";

import { useState } from "react";
import { Sun, Moon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";

import SpinnerCircleLarge from "./SpinnerCircleLarge";
import { getColorListsFromKey } from "~/library/index/color";

type CardLoginProps = {
  className?: string;
  targets: Target[] | null;
};

export default function CardLogin({ className, targets }: CardLoginProps) {
  return (
    <Card className={`${className}`}>
      <CardHeader>
        <CardTitle>ログイン</CardTitle>
      </CardHeader>
      {targets ? (
        <List targets={targets} />
      ) : (
        <SpinnerCircleLarge className="border-neutral-800" />
      )}
    </Card>
  );
}

function List({ targets }: { targets: Target[] }) {
  const [isDarkMode, setIsDarkMode] = useState(true);

  return (
    <CardContent className="">
      <Tabs defaultValue="web_interpark" className="">
        <TabsList className="flex-wrap h-auto gap-2 px-2 py-4 bg-neutral-50">
          {targets.map((target) => {
            const { name, key } = target;
            const colorLists = getColorListsFromKey(key);
            const { border, bg, text, hoverBg } = colorLists;
            return (
              <TabsTrigger
                key={key}
                value={key}
                className={`cursor-pointer data-[state=active]:shadow-none hover:bg-neutral-100 data-[state=active]:bg-neutral-200`}
              >
                <span className={`w-2 h-2 rounded-full ${bg}`} />
                <span className="text-xs">{name}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>
        {targets.map((target) => {
          const { name, key } = target;
          const colorLists = getColorListsFromKey(key);
          const { border, bg, text, hoverBg } = colorLists;
          return (
            <TabsContent key={key} value={key}>
              <Card className="w-full shadow-none pb-0 overflow-hidden">
                <CardHeader>
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <span className={`w-4 h-4 mt-1 rounded-full ${bg}`} />
                    <span>{name}</span>
                  </h3>
                </CardHeader>
                <CardContent className="p-0 border-t">
                  <div className="relative w-full bg-muted h-96">
                    <iframe
                      src={`/${key}`}
                      className={`w-full h-full ${
                        isDarkMode
                          ? "bg-black text-white"
                          : "bg-white text-black"
                      }`}
                      title={`${name} プレビュー`}
                      sandbox="allow-same-origin allow-scripts allow-forms"
                    />
                    <div className="absolute inset-0 bg-black/50">
                      <div className="flex flex-col items-center justify-center h-full">
                        <div className="text-white text-2xl font-bold">
                          🔒 この画面は表示専用です
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      className="absolute top-4 left-4 cursor-pointer"
                      onClick={() => setIsDarkMode(!isDarkMode)}
                    >
                      {isDarkMode ? (
                        <Sun className="h-4 w-4" />
                      ) : (
                        <Moon className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          );
        })}
      </Tabs>
    </CardContent>
  );
  /*
  return (
    <CardContent className="grid grid-cols-2 md:grid-cols-5 xl:grid-cols-10 gap-2">
      {targets.map((target) => {
        const { name, key } = target;
        const colorLists = getColorListsFromKey(key);
        const { border, bg, text, hoverBg } = colorLists;
        return (
          <Dialog key={key}>
            <DialogTrigger asChild>
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
  );
  */
}
