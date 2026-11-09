import { NavLink, Outlet, useNavigation, useRevalidator } from "react-router";
import { Button } from "~/components/ui/button";
import { usePageRevalidation } from "~/lib/usePageRevalidation";

const navLinks = [
  {
    to: "/",
    label: "ホーム",
  },
  {
    to: "/incidents",
    label: "インシデント",
  },
  {
    to: "/errors",
    label: "エラー",
  },
  {
    to: "/login",
    label: "ログイン",
  },
];

export default function Layout() {
  const refresh = usePageRevalidation();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const isUpdating = navigation.state !== "idle" || revalidator.state !== "idle";
  return (
    <>
      <header className="fixed z-2 w-full">
        <div className="max-w-screen-xl m-4 xl:mx-auto">
          <nav className="h-12 flex bg-background/95 border rounded-full">
            {navLinks.map((link) => (
              <Button key={link.to} asChild variant="ghost" className="flex-1">
                <NavLink
                  to={link.to}
                  className="
                    h-full rounded-none cursor-pointer
                    first:rounded-l-full last:rounded-r-full
                    hover:bg-neutral-100/50 aria-[current=page]:bg-neutral-200/50"
                >
                  {link.label}
                </NavLink>
              </Button>
            ))}
          </nav>
        </div>
      </header>
      <main className="pt-20 p-4 max-w-screen-xl mx-auto" aria-busy={isUpdating}>
        <div className="mb-2 flex min-h-8 items-center justify-end gap-3">
          {isUpdating && <p role="status" className="text-sm text-muted-foreground">最新データを取得しています……</p>}
          <Button variant="outline" size="sm" aria-label="最新データに更新" disabled={isUpdating} onClick={refresh}>更新</Button>
        </div>
        <Outlet />
      </main>
    </>
  );
}
