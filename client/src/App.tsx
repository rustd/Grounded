import { Button, Sheet, SheetContent, SheetHeader, SheetTitle, useIsMobile } from '@databricks/appkit-ui/react';
import { HeartPulse, Menu } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createBrowserRouter, NavLink, Outlet, RouterProvider } from 'react-router';
import { LakebasePage } from './pages/lakebase/LakebasePage';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 text-sm font-medium transition-colors ${
    isActive
      ? 'bg-primary text-primary-foreground'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
  }`;

function NavLinks({ onClick }: { onClick?: () => void }) {
  return (
    <nav className="flex flex-col gap-1 md:flex-row">
      <NavLink to="/" end className={navLinkClass} onClick={onClick}>
        Decision Loop
      </NavLink>
    </nav>
  );
}

function Layout() {
  const isMobile = useIsMobile();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!isMobile) setMobileNavOpen(false);
  }, [isMobile]);

  return (
    <div className="flex min-h-screen flex-col bg-[#EEEDE9]">
      <header className="flex items-center gap-4 border-b px-4 py-3 md:px-6">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center bg-[#FF3621] text-white">
            <HeartPulse className="h-4 w-4" />
          </div>
          <h1 className="text-lg font-semibold tracking-normal text-[#0B2026]">HackEvent</h1>
        </div>
        <div className="hidden md:block">
          <NavLinks />
        </div>
        <div className="ml-auto md:hidden">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <Button variant="ghost" size="icon" onClick={() => setMobileNavOpen(true)}>
              <Menu className="h-5 w-5" />
              <span className="sr-only">Open navigation</span>
            </Button>
            <SheetContent side="left">
              <SheetHeader>
                <SheetTitle>HackEvent</SheetTitle>
              </SheetHeader>
              <NavLinks onClick={() => setMobileNavOpen(false)} />
            </SheetContent>
          </Sheet>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 md:px-6">
        <Outlet />
      </main>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [{ path: '/', element: <LakebasePage /> }],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
