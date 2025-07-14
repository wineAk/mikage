import { useOutletContext, useParams } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Sun, Moon } from "lucide-react";

type DarkModeContext = {
  isDarkMode: boolean;
  setIsDarkMode: (isDarkMode: boolean) => void;
};

export default function LoginCard() {
  const { key } = useParams();
  const { isDarkMode, setIsDarkMode } = useOutletContext<DarkModeContext>();

  return (
    <Card className="w-full shadow-none p-0 overflow-hidden">
      <CardContent className="p-0">
        <div className="relative w-full bg-muted h-96">
          {key && (
            <iframe
              src={`/${key}`}
              className={`w-full h-full ${
                isDarkMode ? "bg-black text-white" : "bg-white text-black"
              }`}
              title="プレビュー"
              sandbox="allow-same-origin allow-scripts allow-forms"
            />
          )}
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
  );
}
