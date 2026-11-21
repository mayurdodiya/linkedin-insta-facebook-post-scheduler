'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { PanelLeftClose, PanelLeftOpen, Table2 } from 'lucide-react';
import { useAuth } from '../auth.tsx';
import { BoltIcon, CalendarIcon, DashboardIcon, LogOutIcon } from './Icons.tsx';
import { ThemeToggle } from '../theme.tsx';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

/** UI-only preference: whether the sidebar is collapsed to an icon rail (desktop). */
const COLLAPSE_KEY = 'lps_sidebar';

const initials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || 'U';

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  // read after mount so server and client markup match
  useEffect(() => {
    try {
      if (localStorage.getItem(COLLAPSE_KEY) === '1') setCollapsed(true);
    } catch {
      /* storage unavailable: stay expanded */
    }
  }, []);
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        /* the choice then lasts for this page only */
      }
      return next;
    });

  return (
    <TooltipProvider>
    <div className="shell" data-collapsed={collapsed ? 'true' : 'false'}>
      <aside className="sidebar">
        <Link href="/dashboard" className="brand-row" aria-label="in Scheduler dashboard">
          <span className="brand-mark">
            <BoltIcon />
          </span>
          <span>
            <span className="brand-name">in Scheduler</span>
            <span className="brand-sub">Social publishing studio</span>
          </span>
        </Link>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="side-collapse"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={collapsed}
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </Button>

        <nav className="side-nav" aria-label="Main">
          <span className="nav-label">Workspace</span>
          <Tooltip open={collapsed ? undefined : false}>
            <TooltipTrigger asChild>
              <Link
                href="/dashboard"
                aria-label="Dashboard"
                className={`nav-item${pathname.startsWith('/dashboard') ? ' active' : ''}`}
              >
                <DashboardIcon />
                <span>Dashboard</span>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">Dashboard</TooltipContent>
          </Tooltip>
          <Tooltip open={collapsed ? undefined : false}>
            <TooltipTrigger asChild>
              <Link
                href="/planner"
                aria-label="Plan posts"
                className={`nav-item${pathname.startsWith('/planner') ? ' active' : ''}`}
              >
                <CalendarIcon />
                <span>Plan posts</span>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">Plan posts</TooltipContent>
          </Tooltip>
          <Tooltip open={collapsed ? undefined : false}>
            <TooltipTrigger asChild>
              <Link
                href="/schedule"
                aria-label="Schedule"
                className={`nav-item${pathname.startsWith('/schedule') ? ' active' : ''}`}
              >
                <Table2 />
                <span>Schedule</span>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">Schedule</TooltipContent>
          </Tooltip>
        </nav>

        <div className="side-foot">
          <div className="user-card">
            <Avatar className="avatar">
              <AvatarFallback className="bg-transparent">{initials(user.name)}</AvatarFallback>
            </Avatar>
            <div className="user-meta">
              <strong>{user.name}</strong>
              <span>{user.email}</span>
            </div>
          </div>
          <ThemeToggle />
          <Button type="button" variant="glass" className="side-logout" onClick={logout}>
            <LogOutIcon />
            <span>Log out</span>
          </Button>
        </div>
      </aside>

      <main className="main">
        <div className="container">
          {children}
        </div>
      </main>
    </div>
    </TooltipProvider>
  );
}
