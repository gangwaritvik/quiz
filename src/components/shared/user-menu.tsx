'use client';

import { LogOut, ShieldCheck, User } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { apiFetch } from '@/lib/client/api';
import { initials } from '@/lib/utils';

interface UserMenuProps {
  user: {
    name: string;
    email: string;
    rollNumber?: string | null;
    department?: string | null;
    section?: string | null;
  };
  role: 'STUDENT' | 'ADMIN';
}

export function UserMenu({ user, role }: UserMenuProps) {
  const router = useRouter();
  const [signingOut, setSigningOut] = React.useState(false);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
      router.replace('/login');
      router.refresh();
    } catch {
      toast.error('We could not sign you out. Please try again.');
      setSigningOut(false);
    }
  };

  const subtitle =
    role === 'STUDENT'
      ? [user.rollNumber, user.section ? `Section ${user.section}` : null]
          .filter(Boolean)
          .join(' · ')
      : user.department ?? 'Faculty';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-10 min-w-10 gap-2.5 px-1.5 lg:pr-3"
          aria-label="Account menu"
        >
          <Avatar className="size-8">
            <AvatarFallback>{initials(user.name)}</AvatarFallback>
          </Avatar>
          <span className="hidden min-w-0 max-w-[11rem] text-left leading-tight lg:block">
            <span className="block truncate text-sm font-medium text-foreground">{user.name}</span>
            {subtitle ? (
              <span className="tabular block truncate text-xs font-normal text-muted-foreground">
                {subtitle}
              </span>
            ) : null}
          </span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="pb-2">
          <span className="block truncate text-sm font-semibold">{user.name}</span>
          <span className="block truncate text-xs font-normal text-muted-foreground">
            {user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {role === 'STUDENT' ? (
          <DropdownMenuItem asChild>
            <Link href="/profile">
              <User />
              Profile &amp; devices
            </Link>
          </DropdownMenuItem>
        ) : null}

        <DropdownMenuItem asChild>
          <Link href={role === 'STUDENT' ? '/history' : '/admin/integrity'}>
            <ShieldCheck />
            {role === 'STUDENT' ? 'Integrity status' : 'Integrity reports'}
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem destructive disabled={signingOut} onSelect={() => void signOut()}>
          <LogOut />
          {signingOut ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
