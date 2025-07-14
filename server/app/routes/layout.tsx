import { NavLink, Outlet } from "react-router";
import { Button } from "~/components/ui/button";

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
  return (
    <>
      <header className="fixed z-2 w-full">
        <div className="max-w-screen-xl m-4 xl:mx-auto">
          <nav className="h-12 flex bg-background/50 backdrop-blur-sm border rounded-full">
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
      <main className="pt-20 p-4 max-w-screen-xl mx-auto">
        <Outlet />
      </main>
    </>
  );
}
