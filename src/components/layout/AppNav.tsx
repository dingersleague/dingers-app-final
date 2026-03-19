'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import {
  Trophy, Users, Calendar, TrendingUp, Search,
  Shuffle, ArrowLeftRight, Settings, LogOut, Menu, X, Zap, Home, Target, Palette
} from 'lucide-react'
import { SessionUser } from '@/types'

interface NavProps {
  user: SessionUser
  leagueStatus: string | null
}

const navItems = [
  { href: '/dashboard', label: 'Home', icon: Home },
  { href: '/matchup', label: 'Matchup', icon: Zap },
  { href: '/standings', label: 'Standings', icon: Trophy },
  { href: '/roster', label: 'My Team', icon: Users },
  { href: '/players/search', label: 'Players', icon: Search },
  { href: '/schedule', label: 'Schedule', icon: Calendar },
  { href: '/transactions', label: 'Transactions', icon: Shuffle },
  { href: '/trades', label: 'Trades', icon: ArrowLeftRight },
  { href: '/team/settings', label: 'Team Settings', icon: Palette },
]

// Bottom tab bar items (5 max for mobile)
const mobileTabItems = [
  { href: '/dashboard', label: 'Home', icon: Home },
  { href: '/matchup', label: 'Matchup', icon: Zap },
  { href: '/roster', label: 'Roster', icon: Users },
  { href: '/players/search', label: 'Players', icon: Search },
  { href: '/standings', label: 'Standings', icon: Trophy },
]

export default function AppNav({ user, leagueStatus }: NavProps) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <>
      {/* Desktop Sidebar */}
      <nav className="hidden lg:flex flex-col fixed left-0 top-0 h-screen w-56 bg-surface-1 border-r border-surface-border z-40">
        {/* Logo */}
        <div className="px-4 pt-6 pb-4 border-b border-surface-border">
          <Link href="/dashboard" className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-lg bg-brand flex items-center justify-center glow-brand">
              <span className="font-display font-black text-sm text-surface-0">HR</span>
            </div>
            <div>
              <div className="font-display font-black text-xl text-text-primary tracking-tight leading-none">DINGERS</div>
              <div className="text-xs text-text-muted font-mono tracking-wider">HR LEAGUE</div>
            </div>
          </Link>
        </div>

        {/* Nav links */}
        <div className="flex-1 px-3 py-4 flex flex-col gap-0.5 overflow-y-auto">
          {(leagueStatus === 'PREDRAFT' || leagueStatus === 'DRAFT') && (
            <Link
              href="/draft"
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 mb-1 ${
                pathname.startsWith('/draft')
                  ? 'bg-brand/10 text-brand shadow-brand-sm'
                  : 'bg-brand/5 text-brand hover:bg-brand/10 border border-brand/20'
              }`}
            >
              <Target size={16} />
              Draft Room
              {leagueStatus === 'DRAFT' && (
                <span className="ml-auto w-2 h-2 rounded-full bg-brand animate-pulse" />
              )}
            </Link>
          )}
          {navItems.map(item => {
            const active = pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
                  active
                    ? 'bg-brand/10 text-brand shadow-brand-sm'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface-3'
                }`}
              >
                <item.icon size={16} className={active ? 'text-brand' : ''} />
                {item.label}
              </Link>
            )
          })}

          {user.role === 'COMMISSIONER' && (
            <>
              <div className="mt-4 mb-2 px-3 text-xs text-text-muted uppercase tracking-widest">Commissioner</div>
              <Link
                href="/admin"
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  pathname.startsWith('/admin')
                    ? 'bg-accent-amber/10 text-accent-amber'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface-3'
                }`}
              >
                <Settings size={16} />
                Admin Panel
              </Link>
            </>
          )}
        </div>

        {/* User info */}
        <div className="px-3 py-4 border-t border-surface-border">
          {user.id ? (
            <>
              <div className="flex items-center gap-3 px-3 py-2">
                <div className="w-8 h-8 rounded-full bg-brand/20 border border-brand/30 flex items-center justify-center">
                  <span className="font-display font-bold text-sm text-brand">
                    {user.name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text-primary truncate">{user.name}</div>
                  <div className="text-xs text-text-muted capitalize">{user.role.toLowerCase()}</div>
                </div>
              </div>
              <form action="/api/auth/logout" method="POST">
                <button
                  type="submit"
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-text-muted hover:text-accent-red hover:bg-red-500/10 transition-all mt-1"
                >
                  <LogOut size={16} />
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <Link
              href="/login"
              className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold bg-brand/10 text-brand hover:bg-brand/20 transition-all"
            >
              Sign In
            </Link>
          )}
        </div>
      </nav>

      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-surface-1/95 backdrop-blur-md border-b border-surface-border">
        <div className="flex items-center justify-between px-4 h-12">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-brand flex items-center justify-center">
              <span className="font-display font-black text-[9px] text-surface-0">HR</span>
            </div>
            <span className="font-display font-black text-base text-text-primary tracking-tight">DINGERS</span>
          </Link>
          <div className="flex items-center gap-2">
            {user.role === 'COMMISSIONER' && (
              <Link href="/admin" className="p-1.5 text-accent-amber">
                <Settings size={18} />
              </Link>
            )}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="p-1.5 text-text-secondary hover:text-text-primary"
            >
              {mobileOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        {/* Expandable menu for secondary items */}
        {mobileOpen && (
          <div className="bg-surface-1 border-t border-surface-border px-4 py-3 flex flex-col gap-0.5">
            {(leagueStatus === 'PREDRAFT' || leagueStatus === 'DRAFT') && (
              <Link
                href="/draft"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium bg-brand/5 text-brand border border-brand/20"
              >
                <Target size={16} />
                Draft Room
                {leagueStatus === 'DRAFT' && <span className="ml-auto w-2 h-2 rounded-full bg-brand animate-pulse" />}
              </Link>
            )}
            {navItems.filter(i => !mobileTabItems.some(t => t.href === i.href)).map(item => {
              const active = pathname.startsWith(item.href)
              return (
                <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium ${active ? 'bg-brand/10 text-brand' : 'text-text-secondary'}`}>
                  <item.icon size={16} /> {item.label}
                </Link>
              )
            })}
            <form action="/api/auth/logout" method="POST">
              <button type="submit" className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-text-muted hover:text-accent-red">
                <LogOut size={16} /> Sign out
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Mobile bottom tab bar */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-surface-1/95 backdrop-blur-md border-t border-surface-border safe-bottom">
        <div className="flex items-center justify-around px-1 h-14">
          {mobileTabItems.map(item => {
            const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-1 transition-colors ${
                  active ? 'text-brand' : 'text-text-muted'
                }`}
              >
                <item.icon size={20} strokeWidth={active ? 2.5 : 1.5} />
                <span className="text-[10px] font-semibold">{item.label}</span>
              </Link>
            )
          })}
        </div>
      </div>
    </>
  )
}
